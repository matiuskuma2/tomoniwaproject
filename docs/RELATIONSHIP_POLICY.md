# Relationship Policy（距離感と権限の設計方針）

**Version**: v1.0  
**Status**: 確定（Phase Next-8 Day1 実装対象）  
**更新日**: 2026-01-01

---

## 📌 目的

tomo.niwaでは、**距離感（relationship）**に応じて以下を制御する：

1. **カレンダー参照レベル**（free/busy → full detail）
2. **自動確定の条件**（team = 即確定 / work = 要承認）
3. **通知チャネル**（SMS・LINEを許可するか）
4. **同意の粒度**（Consent）

このドキュメントは、**データ設計と権限ロジック**を固定し、実装時の揉めポイントを解消する。

---

## 🔑 距離感（Relationship）の4レベル

| レベル | カレンダー参照 | 自動確定 | 通知チャネル | 同意取得 |
|--------|----------------|----------|--------------|----------|
| `external` | なし（link経由） | 不可（要確認） | email only | link同意のみ |
| `work` | free/busy のみ | 不可（要承認） | email + SMS（要同意） | 参照同意 + 通知同意 |
| `team` | full detail | **可能** | email + SMS + Slack（要同意） | 共有カレンダー同意 |
| `family` | full detail | **可能** | 全チャネル | 包括同意 |

### 原則

- **昇格には同意が必要**：`external → work` にはカレンダー参照同意、`work → team` には共有カレンダー同意
- **自動確定は team/family のみ**：work以下は **明示的な confirm が必要**
- **external は link 経由**：カレンダー参照なし、提案された候補から選択のみ

---

## 🗃️ データ設計（Phase Next-8 Day1）

### テーブル: `relationships`

```sql
CREATE TABLE relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('external', 'work', 'team', 'family')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, contact_id)
);

CREATE INDEX idx_relationships_user_contact ON relationships(user_id, contact_id);
```

### テーブル: `consents`

```sql
CREATE TABLE consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('calendar_read', 'calendar_write', 'notification_sms', 'notification_line', 'notification_slack')),
  granted BOOLEAN NOT NULL DEFAULT false,
  granted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, contact_id, consent_type)
);

CREATE INDEX idx_consents_user_contact ON consents(user_id, contact_id);
```

---

## 🔄 距離感の昇格フロー

### external → work

1. **トリガー**: 主催者が contact に `work` への変更を提案
2. **必要な同意**: `calendar_read`（free/busy参照）
3. **UI**: モーダルで説明 + 同意ボタン
4. **API**: `POST /api/contacts/:id/relationship` + `POST /api/contacts/:id/consent`

### work → team

1. **トリガー**: 主催者が contact に `team` への変更を提案
2. **必要な同意**: `calendar_read`（full detail） + 共有カレンダー同意
3. **前提条件**: team は「**共有カレンダーが成立しているメンバー集合**」
4. **UI**: 同意フロー + team説明
5. **API**: 同上

### team → family

1. **トリガー**: 主催者が contact に `family` への変更を提案
2. **必要な同意**: 包括同意（すべてのチャネル + full detail）
3. **UI**: 同意フロー
4. **API**: 同上

---

## 🔐 権限チェックのロジック

### カレンダー参照

```typescript
function canReadCalendar(user_id: string, contact_id: string): 'none' | 'free_busy' | 'full_detail' {
  const relationship = getRelationship(user_id, contact_id);
  const consent = getConsent(user_id, contact_id, 'calendar_read');

  if (relationship.level === 'external') return 'none';
  if (relationship.level === 'work' && consent.granted) return 'free_busy';
  if (relationship.level === 'team' && consent.granted) return 'full_detail';
  if (relationship.level === 'family') return 'full_detail';

  return 'none';
}
```

### 自動確定

```typescript
function canAutoConfirm(user_id: string, contact_id: string): boolean {
  const relationship = getRelationship(user_id, contact_id);
  return relationship.level === 'team' || relationship.level === 'family';
}
```

### 通知チャネル

```typescript
function canSendViaSMS(user_id: string, contact_id: string): boolean {
  const consent = getConsent(user_id, contact_id, 'notification_sms');
  return consent.granted && consent.revoked_at === null;
}
```

---

## 🚨 揉めポイント潰し

### Q1: external でも「今すぐ確定してほしい」は？

→ **不可**。external は link 経由で候補選択 → 主催者が最終確定（または締切で自動確定）。即確定は team/family のみ。

### Q2: team の定義が曖昧では？

→ **team = 共有カレンダー前提の集合**（free/busy以上）と明文化。Slack Workspace や Google Workspace の共有設定が前提。

### Q3: work で「一部の人だけfull detail見せたい」は？

→ **個別にteamに昇格**させるか、別の team を作る。work は free/busy のみ。

### Q4: 同意を後から取り消せる？

→ **可能**。`consents.revoked_at` を設定 → 以後そのチャネルは使用不可。監査ログに記録。

---

## 📋 Phase Next-8 Day1 DoD

- [ ] `relationships` テーブル作成
- [ ] `consents` テーブル作成
- [ ] `POST /api/contacts/:id/relationship` 実装
- [ ] `POST /api/contacts/:id/consent` 実装
- [ ] `GET /api/contacts/:id/relationship` 実装
- [ ] UI: 距離感変更フロー（モーダル + 説明）
- [ ] 監査ログ記録（audit_logs）
- [ ] 実機テスト（external → work → team の昇格フロー）

---

## 📚 参照文書

- [PRODUCT_VISION_OS.md](./PRODUCT_VISION_OS.md)（v1.2-final）: 全体像と距離感の定義
- [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md)（v1.0）: Next-8 Day1 の実装計画
- [INVITEE_UX_SPEC.md](./INVITEE_UX_SPEC.md): 誘われた側のUX（external link の体験）

---

## 更新履歴

| 日付 | バージョン | 変更内容 | 更新者 |
|------|------------|----------|--------|
| 2026-01-01 | v1.0 | 初版作成（Next-8 Day1 確定版） | 開発チーム |

# Superadmin Spec（管理者権限と運用設計）

**Version**: v1.0  
**Status**: 確定（Phase Next-10 実装対象）  
**更新日**: 2026-01-01

---

## 📌 目的

tomo.niwaでは、**Superadmin（システム管理者）**が以下を実行できる：

1. **ユーザー管理**（アカウント停止・削除・復旧）
2. **課金・制限管理**（プラン変更・制限値の調整）
3. **監査ログ閲覧**（セキュリティ・トラブルシューティング）
4. **システムメンテナンス**（データ削除・アーカイブ・バックアップ）

このドキュメントは、**権限範囲と実装方針**を固定し、セキュリティリスクを最小化する。

---

## 🔑 Superadmin の権限レベル

| 権限 | できること | できないこと |
|------|------------|--------------|
| **user_management** | アカウント停止・削除・復旧 | ユーザーのチャットを閲覧 |
| **billing_management** | プラン変更・制限値調整 | 勝手に無料プランに戻す |
| **audit_read** | 監査ログ閲覧・検索・エクスポート | ログの改ざん |
| **system_maintenance** | データアーカイブ・削除・バックアップ | 本番データを直接編集 |

### 原則

- **最小権限の原則**: 必要な権限のみ付与
- **監査ログ必須**: すべてのSuperadmin操作を記録
- **二段階認証必須**: Superadminアカウントは2FAを強制
- **本番データ直接編集禁止**: すべての操作はAPI経由

---

## 🗃️ データ設計

### テーブル: `superadmins`

```sql
CREATE TABLE superadmins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permissions TEXT[] NOT NULL, -- ['user_management', 'billing_management', 'audit_read', 'system_maintenance']
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(user_id)
);

CREATE INDEX idx_superadmins_user ON superadmins(user_id);
```

### テーブル: `admin_audit_logs`

```sql
CREATE TABLE admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL, -- 'user_suspend', 'user_delete', 'plan_change', etc.
  target_user_id UUID REFERENCES users(id),
  target_resource_type TEXT, -- 'user', 'thread', 'schedule', etc.
  target_resource_id UUID,
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_logs_admin ON admin_audit_logs(admin_user_id, created_at);
CREATE INDEX idx_admin_audit_logs_target ON admin_audit_logs(target_user_id, created_at);
```

---

## 🔐 権限チェックのロジック

### 権限確認

```typescript
function isSuperadmin(user_id: string, required_permission: string): boolean {
  const admin = db.query('SELECT permissions FROM superadmins WHERE user_id = $1 AND revoked_at IS NULL', [user_id]);
  if (!admin) return false;
  return admin.permissions.includes(required_permission);
}
```

### 監査ログ記録

```typescript
function logAdminAction(admin_user_id: string, action: string, target_user_id: string, details: object, req: Request) {
  db.query(`
    INSERT INTO admin_audit_logs (admin_user_id, action, target_user_id, details, ip_address, user_agent)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [admin_user_id, action, target_user_id, JSON.stringify(details), req.ip, req.headers['user-agent']]);
}
```

---

## 🛠️ Superadmin 機能

### 1. ユーザー管理

#### アカウント停止
```
POST /api/admin/users/:user_id/suspend
権限: user_management
効果: ユーザーのログインを無効化、既存セッションを破棄
監査ログ: action='user_suspend', details={ reason: 'spam' }
```

#### アカウント削除
```
POST /api/admin/users/:user_id/delete
権限: user_management
効果: ユーザーデータをソフトデリート（deleted_at設定）、30日後に完全削除
監査ログ: action='user_delete', details={ reason: 'gdpr_request' }
```

#### アカウント復旧
```
POST /api/admin/users/:user_id/restore
権限: user_management
効果: deleted_at をクリア、ログイン復旧
監査ログ: action='user_restore'
```

### 2. 課金・制限管理

#### プラン変更
```
POST /api/admin/users/:user_id/plan
権限: billing_management
Body: { plan: 'pro', reason: 'enterprise_trial' }
効果: ユーザーのプランを変更、entitlementsを更新
監査ログ: action='plan_change', details={ from: 'free', to: 'pro' }
```

#### 制限値調整
```
POST /api/admin/users/:user_id/limits
権限: billing_management
Body: { max_links: 50, max_contacts: 2000 }
効果: 個別に制限値をオーバーライド
監査ログ: action='limit_override', details={ max_links: 50 }
```

### 3. 監査ログ閲覧

#### ログ検索
```
GET /api/admin/audit-logs?user_id=xxx&action=user_suspend&from=2026-01-01&to=2026-01-31
権限: audit_read
Response: { logs: [...], cursor: 'next_page_token' }
```

#### ログエクスポート
```
POST /api/admin/audit-logs/export
権限: audit_read
Body: { user_id: 'xxx', from: '2026-01-01', to: '2026-01-31' }
Response: CSV download
```

### 4. システムメンテナンス

#### データアーカイブ
```
POST /api/admin/maintenance/archive
権限: system_maintenance
Body: { before_date: '2025-01-01' }
効果: 指定日以前の未アクセススレッドを要約化・アーカイブ
監査ログ: action='data_archive', details={ count: 1234 }
```

#### バックアップ作成
```
POST /api/admin/maintenance/backup
権限: system_maintenance
効果: 全データのバックアップをCloudflare R2に保存
監査ログ: action='backup_create', details={ size_mb: 5678 }
```

---

## 🚨 揉めポイント潰し

### Q1: Superadminが勝手にユーザーのチャットを見れる？

→ **不可**。監査ログ閲覧は可能だが、チャット内容の閲覧は**ユーザーの明示的な同意**が必要（サポート対応時のみ）。

### Q2: 誰がSuperadminになれる？

→ **創業者・CTO・セキュリティ担当のみ**。付与は既存Superadminが承認。

### Q3: Superadminを辞めたら？

→ **revoked_at を設定** → 以後すべての権限が無効化。監査ログは残る。

### Q4: 本番データベースに直接アクセスできる？

→ **禁止**。すべての操作はAPI経由。緊急時のみ、2人以上の承認を得てSQL実行（監査ログ記録）。

---

## 🔒 セキュリティ対策

### 二段階認証（2FA）必須
- Superadminアカウントは**2FAを強制**
- TOTPアプリ（Google Authenticator / Authy）を使用
- バックアップコードを安全に保管

### IPホワイトリスト
- Superadmin操作は**特定IPからのみ**許可（オフィスIP / VPN）
- Cloudflare Access で制御

### セッションタイムアウト
- Superadminセッションは**30分で自動ログアウト**
- 操作のたびにセッションを延長

### 監査ログの保持
- すべてのSuperadmin操作を**永久保存**
- Cloudflare R2に定期エクスポート

---

## 📋 Phase Next-10 DoD（実装時期：審査完了後）

- [ ] `superadmins` テーブル作成
- [ ] `admin_audit_logs` テーブル作成
- [ ] 権限チェックミドルウェア実装
- [ ] 監査ログ記録関数実装
- [ ] `/api/admin/users/:id/suspend` 実装
- [ ] `/api/admin/users/:id/delete` 実装
- [ ] `/api/admin/users/:id/restore` 実装
- [ ] `/api/admin/users/:id/plan` 実装
- [ ] `/api/admin/audit-logs` 実装
- [ ] 2FA強制実装
- [ ] IPホワイトリスト設定（Cloudflare Access）
- [ ] 実機テスト（権限確認・監査ログ記録）

---

## 📚 参照文書

- [PRODUCT_VISION_OS.md](./PRODUCT_VISION_OS.md)（v1.2-final）: 全体像と管理者の役割
- [BILLING_AND_LIMITS.md](./BILLING_AND_LIMITS.md)（v1.0）: 課金プランと制限値
- [LOGGING_AND_RETENTION.md](./LOGGING_AND_RETENTION.md)（v1.0）: 監査ログの設計
- [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md)（v1.0）: Next-10 の実装計画

---

## 更新履歴

| 日付 | バージョン | 変更内容 | 更新者 |
|------|------------|----------|--------|
| 2026-01-01 | v1.0 | 初版作成（Next-10 確定版） | 開発チーム |

# 通知システム設計書（NOTIFICATION_SYSTEM_PLAN.md）

最終更新日: 2026-02-05
ステータス: 設計中（SSOT対応）

---

## 1. 概要

本ドキュメントは、ToMoniWaoの通知システム全体を以下の観点で整理する：

1. **現状の実装状況**（API / DB / FE）
2. **トポロジー別の通知タイミング**（1:1 / 1:N / N:1 / N:N）
3. **通知チャネル設計**（チャット / ベル / メール）
4. **既知の問題と修正計画**

---

## 2. 現状の実装状況

### 2.1 DBスキーマ

```sql
-- db/migrations/0028_inbox_table.sql
CREATE TABLE inbox (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,           -- 通知を受け取るユーザー
  type TEXT NOT NULL,              -- 通知タイプ（下記参照）
  title TEXT NOT NULL,             -- 通知タイトル
  message TEXT,                    -- 通知本文（任意）
  action_type TEXT,                -- アクション種別
  action_target_id TEXT,           -- アクション対象ID
  action_url TEXT,                 -- クリック時の遷移先URL
  priority TEXT DEFAULT 'normal',  -- low / normal / high / urgent
  is_read INTEGER DEFAULT 0,       -- 既読フラグ
  read_at DATETIME,                -- 既読日時
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2.2 API エンドポイント

| Method | Path | 説明 | 実装状況 |
|--------|------|------|----------|
| GET | `/api/inbox` | 通知一覧取得 | ✅ 実装済み |
| GET | `/api/inbox/unread-count` | 未読件数取得 | ✅ 実装済み |
| GET | `/api/inbox/:id` | 単一通知取得 | ✅ 実装済み |
| PATCH | `/api/inbox/:id/read` | 既読にする | ✅ 実装済み |
| PATCH | `/api/inbox/:id/unread` | 未読に戻す | ✅ 実装済み |
| POST | `/api/inbox/mark-all-read` | 全て既読 | ✅ 実装済み |
| DELETE | `/api/inbox/:id` | 通知削除 | ✅ 実装済み |
| DELETE | `/api/inbox/clear-read` | 既読を全削除 | ✅ 実装済み |

### 2.3 フロントエンド実装

| コンポーネント | ファイル | 状況 |
|--------------|---------|------|
| NotificationBell | `components/chat/NotificationBell.tsx` | ✅ 表示のみ |
| inboxApi | `core/api/inbox.ts` | ⚠️ markAsRead 未実装 |
| inboxCache | `core/cache/inboxCache.ts` | ✅ TTL 10秒 |

### 2.4 通知タイプ一覧

| type | 説明 | 実装状況 |
|------|------|----------|
| `relationship_request` | 仕事仲間/家族申請 | ✅ |
| `relationship_accepted` | 申請承認 | ✅ |
| `relationship_declined` | 申請辞退 | ✅ |
| `scheduling_request_received` | 日程調整依頼受信 | ✅ |
| `scheduling_request_confirmed` | 日程調整確定 | ✅ |
| `scheduling_request_declined` | 日程調整辞退 | ✅ |
| `thread_invite` | スレッド招待 | ❌ 未実装 |
| `pool_booking` | プール予約通知 | ❌ 未実装 |

---

## 3. トポロジー別 通知タイミング設計

### 3.1 1:1（一対一）

**シナリオ**: AさんがBさんと日程調整

| イベント | 主催者(A)への通知 | 参加者(B)への通知 |
|---------|------------------|------------------|
| スレッド作成 | - | 招待メール |
| 招待承認 | ベル + チャット | - |
| 招待辞退 | ベル + チャット | - |
| 日程確定 | チャット | メール + ベル |
| リマインド送信 | チャット（確認） | メール |

### 3.2 1:N（一対多 / グループ調整）

**シナリオ**: AさんがB,C,D...さんとグループ日程調整

| イベント | 主催者(A)への通知 | 参加者(B,C,D)への通知 |
|---------|------------------|---------------------|
| スレッド作成 | - | 各自に招待メール |
| 招待承認（各自） | ベル（誰が承認）| - |
| 全員承認 | チャット（全員揃った） | - |
| 投票完了（各自） | ベル（投票状況） | - |
| 日程確定 | チャット | 各自にメール + ベル |
| 追加候補提案 | チャット（確認） | メール |

### 3.3 N:1（多対一 / プール予約）

**シナリオ**: A,B,Cさんが管理者Xのプールから予約

| イベント | 管理者(X)への通知 | 予約者(A,B,C)への通知 |
|---------|------------------|---------------------|
| プール作成 | チャット（確認） | - |
| 予約申請 | ベル（誰が申請） | - |
| 予約確定 | ベル（予約完了） | チャット + メール |
| 予約キャンセル | ベル | チャット（キャンセル確認） |

### 3.4 N:N（多対多）

**シナリオ**: グループAとグループBの合同日程調整

| イベント | グループAへの通知 | グループBへの通知 |
|---------|------------------|------------------|
| 調整開始 | 各自にベル | 各自にベル |
| 投票（各自） | 管理者にベル | 管理者にベル |
| 日程確定 | 各自にチャット + ベル | 各自にチャット + ベル |

---

## 4. 通知チャネル設計（NOTIFICATION_CHANNEL_RULES.md準拠）

### 4.1 チャネル優先度

```
チャット（秘書との会話）> ベル（お知らせ）> メール（外部向け）
```

### 4.2 関係性 × チャネル マトリクス

| 関係性 | 相手の状態 | 通知先 |
|--------|----------|--------|
| 家族 | 利用者 | チャット（結果のみ） |
| 仕事仲間 | 利用者 | チャット |
| 他人 | 登録済 | メール + ベル |
| 他人 | 未登録 | メール |

### 4.3 禁止事項

- ❌ 他人の通知をチャットに出す
- ❌ 同じ内容を複数チャネルに乱発
- ❌ 再調整通知を無制限に送る

---

## 5. 既知の問題と修正計画

### 5.1 既読ロジックが動作しない

**問題**: 通知をクリックしても既読にならない

**原因**:
1. `inboxApi.markAsRead()` がコメントアウトされている
2. `NotificationBell.handleNotificationClick()` で既読APIを呼んでいない

**修正計画**:
```typescript
// 1. inboxApi.ts - markAsRead を有効化
async markAsRead(id: string): Promise<{ success: boolean }> {
  return api.patch(`/api/inbox/${id}/read`, {});
}

// 2. NotificationBell.tsx - クリック時に既読化
const handleNotificationClick = async (notification: InboxNotification) => {
  // 既読APIを呼ぶ
  if (!isNotificationRead(notification)) {
    try {
      await inboxApi.markAsRead(notification.id);
      await refreshInbox(); // キャッシュ更新
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  }
  // ... 既存のナビゲーション処理
};
```

### 5.2 通知作成のトリガーが不足

**問題**: 以下のイベントで通知が作成されていない

| イベント | 現状 | あるべき姿 |
|---------|------|-----------|
| スレッド作成 | ❌ | inbox に通知作成 |
| 招待承認 | ✅ | OK |
| 招待辞退 | ✅ | OK |
| 日程確定 | ⚠️ メールのみ | inbox + メール |
| プール予約 | ❌ | inbox に通知作成 |
| プールキャンセル | ❌ | inbox に通知作成 |

**修正計画**: 各APIハンドラーで `InboxRepository.create()` を呼ぶ

### 5.3 リアルタイム通知がない

**問題**: 通知はポーリング（10秒TTL）でしか更新されない

**将来対応**: WebSocket / Server-Sent Events の導入

---

## 6. 実装優先度

### P0（即時対応）

1. ✅ ~~既読ロジック修正~~（本ドキュメント作成後に実装）
2. 通知クリック時の既読化

### P1（次フェーズ）

1. 日程確定時の inbox 通知作成
2. プール予約/キャンセル時の inbox 通知作成
3. 通知の一括既読機能（UI）

### P2（将来）

1. WebSocket によるリアルタイム通知
2. プッシュ通知（PWA / ネイティブ）
3. 通知設定（オン/オフ切り替え）

---

## 7. テスト計画

### 7.1 E2E テスト

```typescript
// 1. 既読テスト
test('clicking notification marks it as read', async () => {
  // 未読通知を作成
  // ベルクリック → 通知クリック
  // 未読カウントが減ることを確認
});

// 2. 通知作成テスト（トポロジー別）
test('1:1 - invite creates notification', async () => {});
test('1:N - group invite creates notifications', async () => {});
test('N:1 - pool booking creates notification', async () => {});
```

---

## 8. 関連ドキュメント

- `NOTIFICATION_CHANNEL_RULES.md` - 通知チャネルのUXルール
- `DATABASE_SCHEMA.md` - DBスキーマ全体
- `FRONTEND_ARCHITECTURE.md` - FEアーキテクチャ

---

## 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-02-05 | 初版作成（通知システム調査結果） |

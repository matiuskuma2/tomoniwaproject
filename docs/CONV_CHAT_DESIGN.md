# CONV-CHAT: AI秘書の雑談対応設計

> **目的**: AI秘書として自然な会話ができるようにする。予定調整以外の話題にも応答し、会話を記録しつつ、コストを最小限に抑える。

---

## 1. 体験イメージ

### Before (現状)
```
ユーザー: こんにちは
AI: 理解できませんでした。以下のような指示ができます... ❌
```

### After (目標)
```
ユーザー: こんにちは
AI: こんにちは！今日は何かお手伝いできることはありますか？ ✅

ユーザー: 最近忙しくて疲れてるんだよね
AI: お疲れ様です。無理せず、調整が必要な予定があれば
    いつでも言ってくださいね。何かお手伝いできることはありますか？ ✅

ユーザー: 来週の空き教えて
AI: [通常のfreebusy処理] ✅
```

---

## 2. 設計原則

### 2.1 絶対ルール（既存原則を継承）
1. **AIは解釈+提案のみ** - 外部送信/DB書き込みは必ず確認
2. **実行は既存intent経由** - 雑談中も機能呼び出しは既存ルートを通す
3. **状態はDBが真実** - 会話履歴もDBに永続化

### 2.2 雑談固有ルール
1. **最小コスト** - 雑談は短い履歴で応答（直近3-5ターン）
2. **機能優先** - 機能に該当しそうなら雑談より機能を優先
3. **自然な誘導** - 雑談でも「何かお手伝いできることは？」で機能へ誘導

---

## 3. アーキテクチャ

### 3.1 フロー

```
User Input
    │
    ▼
┌─────────────────────────────────────┐
│  classifyIntentChain (既存)        │
│  - pendingDecision                  │
│  - confirmCancel                    │
│  - lists / calendar / preference    │
│  - propose / remind / thread        │
└─────────────────────────────────────┘
    │
    │ マッチなし → unknown
    ▼
┌─────────────────────────────────────┐
│  executeUnknownWithNlRouter (既存) │
│  - calendar系のみ再実行             │
└─────────────────────────────────────┘
    │
    │ calendar系でもない
    ▼
┌─────────────────────────────────────┐
│  executeChatFallback (NEW)         │
│  - /api/chat/message を呼び出し     │
│  - 雑談応答を生成                   │
│  - 会話履歴を保存                   │
└─────────────────────────────────────┘
```

### 3.2 Backend API

#### POST /api/chat/message

```typescript
// Request
{
  text: string;              // ユーザー入力
  context?: {
    thread_id?: string;      // スレッドID（任意）
  };
}

// Response
{
  message: string;           // AI応答
  intent_detected?: string;  // もし機能意図を検出した場合
  should_execute?: boolean;  // 機能を実行すべきか
}
```

### 3.3 DB設計

#### chat_messages テーブル

```sql
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  thread_id TEXT,  -- スレッドに紐づく場合
  metadata JSONB,  -- 将来の拡張用
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- インデックス
CREATE INDEX idx_chat_messages_user_recent 
  ON chat_messages(user_id, created_at DESC);

CREATE INDEX idx_chat_messages_workspace_recent 
  ON chat_messages(workspace_id, created_at DESC);
```

---

## 4. コスト最適化

### 4.1 履歴の圧縮戦略

| レベル | 保持期間 | 内容 |
|--------|---------|------|
| Hot | 直近5ターン | 全文保持（雑談応答用） |
| Warm | 直近1週間 | 要約のみ（コンテキスト用） |
| Cold | 1ヶ月以上 | 削除 or アーカイブ |

### 4.2 API呼び出し制限

```typescript
// コスト制御パラメータ
const CHAT_CONFIG = {
  max_history_turns: 5,      // 直近5ターンのみLLMに送信
  max_tokens_response: 150,  // 応答は短く
  model: 'gpt-4o-mini',      // 低コストモデル
  temperature: 0.7,          // やや創造的
};
```

### 4.3 キャッシュ戦略

- 同じ挨拶（こんにちは等）は定型応答でLLM呼び出しスキップ
- 直近の応答はメモリキャッシュ（同一セッション内）

---

## 5. 実装ToDo

### Phase 1: 基本実装（CONV-CHAT-1）

| ID | タスク | ファイル |
|----|--------|----------|
| 1.1 | DBマイグレーション追加 | `db/migrations/0079_create_chat_messages.sql` |
| 1.2 | Backend API実装 | `apps/api/src/routes/chat.ts` |
| 1.3 | Frontend API クライアント | `frontend/src/core/api/chat.ts` |
| 1.4 | apiExecutor 統合 | `frontend/src/core/chat/apiExecutor.ts` |
| 1.5 | E2E テスト | `frontend/e2e/chat.spec.ts` |

### Phase 2: コスト最適化（CONV-CHAT-2）

| ID | タスク | 内容 |
|----|--------|------|
| 2.1 | 定型応答キャッシュ | 挨拶パターンの静的応答 |
| 2.2 | 履歴圧縮ジョブ | 古い会話の要約化 |
| 2.3 | TTL設定 | 1ヶ月以上の会話削除 |

### Phase 3: 体験向上（CONV-CHAT-3）

| ID | タスク | 内容 |
|----|--------|------|
| 3.1 | ペルソナ設定 | AI秘書の性格定義 |
| 3.2 | コンテキスト活用 | 過去の会話を踏まえた応答 |
| 3.3 | プロアクティブ提案 | 「そろそろ○○の確認いかがですか？」 |

---

## 6. プロンプト設計

### System Prompt

```
あなたは「ともにわ」のAI秘書です。

## 役割
- ユーザーの予定調整をサポートする秘書
- 雑談にも自然に応答し、親しみやすい存在

## 応答ルール
1. 簡潔に応答する（2-3文以内）
2. 雑談でも「何かお手伝いできることはありますか？」で誘導
3. 予定調整に関する話題が出たら、具体的な機能を案内

## 禁止事項
- 予定の確定や送信を勝手に行う約束をしない
- 個人情報や機密情報について言及しない
- 医療・法律・金融のアドバイスをしない

## できること案内
- 今日の予定確認
- 来週の空き時間確認
- 日程調整の送信
- 好みの時間帯設定
```

---

## 7. 次のステップ

1. **即実行**: CONV-CHAT-1 の基本実装
2. **検証**: E2Eで「こんにちは」→応答を確認
3. **最適化**: コスト監視しながら Phase 2 へ

---

## 8. 関連ドキュメント

- [AI会話化ロードマップ](./AI_CONVERSATIONAL_ROADMAP.md)
- [統合動作確認チェックリスト](./INTEGRATION_TEST_CHECKLIST.md)

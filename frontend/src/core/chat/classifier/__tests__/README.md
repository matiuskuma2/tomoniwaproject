# Intent Classifier テスト

## 概要

TD-003 で intentClassifier を分割した際の回帰テストです。
**挙動を1ミリも変えない**ことを保証します。

## テストファイル

| ファイル | 内容 | ケース数 |
|---------|------|---------|
| `intentClassifier.regression.test.ts` | 優先順位・pending・キーワード回帰 | 28 |
| `intentClassifier.golden.test.ts` | ゴールデンファイル回帰 | 52 |
| `fixtures/intents.json` | スナップショット定義 | 50 |

## 実行方法

```bash
cd frontend
npm test          # 全テスト実行
npm run test:watch # watch モード
```

## 新しい intent を追加するときの手順

### 1. `fixtures/intents.json` にテストケースを追加

```json
{
  "id": "new-feature-1",
  "input": "新機能のテスト入力",
  "context": { "hasThreadId": true },
  "expected": { "intent": "new.feature.intent" }
}
```

### 2. 必須フィールド

| フィールド | 説明 | 例 |
|-----------|------|-----|
| `id` | 一意のID（重複禁止） | `"list-create-1"` |
| `input` | ユーザー入力文字列 | `"営業部リストを作って"` |
| `context.hasThreadId` | threadId の有無 | `true` / `false` |
| `expected.intent` | 期待する intent | `"list.create"` |
| `expected.params` | 期待するパラメータ（任意） | `{ "slotNumber": 1 }` |
| `expected.needsClarification` | clarification の有無（任意） | `true` |
| `note` | メモ（任意） | `"特殊ケースの説明"` |

### 3. テスト実行して確認

```bash
npm test
```

## 優先順位（固定）

分類器は以下の順序で評価されます。**順序を変更すると挙動が変わります**。

1. **pendingDecision** - `pending.action` が存在 → 送る/キャンセル/別スレッドで
2. **confirmCancel** - はい/いいえ → split > notify > remind > remind_need_response > auto_propose
3. **lists** - リスト作成/一覧/メンバー/追加/招待
4. **calendar** - 今日の予定/今週の予定/空き時間
5. **propose** - 追加候補/確定通知/自動調整
6. **remind** - 再回答必要者リスト/リマインド
7. **thread** - スレッド作成/メール入力/確定/状況確認

## CI

GitHub Actions で push/PR 時に自動実行されます。

- `.github/workflows/test.yml`
- テスト失敗時はマージをブロック

## トラブルシューティング

### テストが失敗する場合

1. **意図した変更の場合**: `fixtures/intents.json` を新しい挙動に合わせて更新
2. **意図しない変更の場合**: コードを修正して元の挙動に戻す

### 新しいキーワードが既存の intent にマッチしてしまう

- 優先順位の高い分類器が先にマッチしている可能性
- 正規表現のパターンを確認
- 必要に応じて分類器の順序を調整（ただし他のテストが壊れないか確認）

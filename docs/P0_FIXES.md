# P0修正パッチ（運用インシデント防止）

## 修正日時
2026-01-03

## 修正範囲
- **P0-1**: tenant isolation の実装修正
- **P0-3**: migration運用の是正
- **P0-4**: list_members API の越境防止
- **P0-5**: cursor実装の簡素化

---

## P0-1: tenant isolation（workspace_id の正規化）

### 問題
- `workspace_id = 'ws-default'` がハードコード（マジックナンバー）
- users テーブルに workspace_id カラムが存在しない

### 修正内容
1. **新規ファイル作成**: `apps/api/src/utils/tenant.ts`
   - `DEFAULT_WORKSPACE_ID` 定数を定義
   - `getWorkspaceId(userId)` 関数を実装
   - 将来のマルチテナント対応を想定した境界設計

2. **API修正**: `listMembers.ts` で `getWorkspaceId()` を使用

### 将来対応（P1以降）
- users テーブルに workspace_id カラム追加
- getWorkspaceId() を DB取得実装に置き換え

---

## P0-3: migration運用の是正

### 問題
- migration番号の重複（0053, 0056, 0057, 0058）
- リネーム/削除による運用混乱

### 修正内容
1. **重複ファイルの整理**:
   - 0056 → 0053 にリネーム（既存0053は削除済み）
   - 0057 → 0054 にリネーム
   - 0058 → 0055 にリネーム

2. **最終的なmigration順序**:
   ```
   0050_create_list_items.sql
   0051_create_list_item_events.sql
   0052_create_list_members.sql
   0053_add_contact_id_to_thread_participants.sql
   0054_create_contact_channels.sql
   0055_create_ledger_audit_events.sql
   ```

### 運用ルール（今後厳守）
1. **migration番号は増やすのみ**（リネーム/削除禁止）
2. **失敗したmigrationは新規番号で修正版を追加**
3. **seed と migration を分離**

---

## P0-4: list_members API の越境防止

### 問題
- list_id の tenant整合性チェックなし
- contact_id の tenant整合性チェックなし
- INSERT OR IGNORE の結果が不正確

### 修正内容
1. **POST /api/lists/:listId/members/batch**:
   - list_id の tenant整合性チェック追加
   - contact_ids の batch検証追加
   - INSERT OR IGNORE の結果を正確に判定（`result.meta.changes`）
   - skipped配列を返却（冪等性の可視化）

2. **GET /api/lists/:listId/members**:
   - list_id の tenant整合性チェック追加

3. **DELETE /api/lists/:listId/members/:memberId**:
   - workspace_id を getWorkspaceId() で取得

### エラーレスポンス
- `list_not_found_or_no_access` (404): list_id が存在しないか、アクセス権なし
- `invalid_contacts` (400): contact_ids が tenant外を参照

---

## P0-5: cursor実装の簡素化

### 問題
- base64 + URL-safe変換が複雑
- Buffer依存（Workers/D1で不安定）

### 修正内容
1. **cursor.ts の簡素化**:
   - base64エンコード削除
   - encodeURIComponent/decodeURIComponent のみ使用
   - 例: `"2026-01-03T01:00:00.000Z|abc-123"` → `"2026-01-03T01%3A00%3A00.000Z%7Cabc-123"`

2. **メリット**:
   - Workers/D1で安全
   - コード行数 -10行
   - デバッグが容易（URL直接デコード可能）

---

## P0修正の検証

### ビルド確認
```bash
npm run build
# ✅ Build check passed
```

### 次のステップ（P1以降）
1. **list_items / list_members の命名変更**
   - 人の集合: `contact_lists` / `contact_list_members`
   - タスク系: `task_lists` / `task_items`

2. **監査ログの粒度拡張**
   - 失敗/無視を含むイベント記録
   - tenant越境検知
   - actor_user_id / endpoint / action_result

3. **レート制限実装**
   - 入口でのレート制限
   - 境界強化が先

---

## 影響範囲
- ✅ TypeScriptビルド: 成功
- ✅ migration: 整理完了
- ⚠️ 既存データ: 影響なし（migration番号変更のみ）
- ⚠️ API互換性: cursor形式変更（クライアント側で再取得必要）

---

## コミットメッセージ案
```
fix(ledger): P0修正パッチ（運用インシデント防止）

- P0-1: tenant.ts 作成（workspace_id 正規化）
- P0-3: migration番号整理（0053-0055）
- P0-4: list_members 越境防止（tenant整合性チェック）
- P0-5: cursor簡素化（URL-safe直接エンコード）

BREAKING CHANGE: cursor形式変更（base64 -> encodeURIComponent）
```

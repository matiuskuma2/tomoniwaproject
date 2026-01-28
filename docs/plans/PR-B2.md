# PR-B2: 主催者freebusy → 候補生成（R0: 他人）

> **Version**: 2026-01-28  
> **Status**: PR-B2-API ✅ 完了 (PR #47)  
> **依存**: PR-B1（✅ 完了）

---

## 1. 目的（B-2で実現する体験）

ユーザーが「来週の空いてるところから3つ候補を送って」と言うだけで、

1. **主催者（自分）のGoogleカレンダーから空き時間を抽出**
2. **候補3つを生成**（時間帯/期間/所要時間の制約つき）
3. **相手（他人）には `/i/:token` の候補選択UIで選んでもらう**
4. 承諾 → thank-you → リマインド予約 → cron送信（既存フロー）

> **重要**: 他人（R0）なので **相手のカレンダーは見ない**。相手の空きは「選ばせる」で解決。

---

## 2. 前提（既存資産）

| 資産 | ファイル | 状態 |
|------|---------|------|
| B-1 candidates3 | 全体 | ✅ 完了 |
| freebusy取得 | `apps/api/src/routes/calendar.ts` | ✅ 既存 |
| 空き枠生成 | `apps/api/src/utils/slotGenerator.ts` | ✅ 既存 |
| 候補選択UI | `apps/api/src/routes/invite.ts` (`multiSlotUI`) | ✅ 既存 |
| DB拡張 | `slot_policy`, `constraints_json` (0082) | ✅ 適用済み |
| E2E fixture | `testFixtures.ts` | ✅ 安定化済み (#46) |

---

## 3. 仕様（B-2の最小スコープ）

### 3-1. 入力（ユーザー自然言語で想定する制約）

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| `time_min` / `time_max` | 検索期間 | 来週木曜〜日曜 |
| `prefer` | 時間帯 | 午前 / 午後 / 夕方 / 指定なし |
| `duration` | 所要時間 | 60分（デフォルト） |
| `candidate_count` | 候補数 | 3（固定） |

### 3-2. デフォルト条件

| パラメータ | デフォルト値 | 理由 |
|-----------|-------------|------|
| `time_min` | 翌営業日 09:00 | 当日は避ける |
| `time_max` | 2週間後 | 十分な選択肢を確保 |
| `prefer` | `afternoon`（午後優先） | ビジネスミーティングの標準 |
| `duration` | 60分 | 標準的な会議時間 |
| `candidate_count` | 3 | B-1と統一 |
| `days` | 月〜金（平日） | 週末除外がデフォルト |

### 3-3. 出力

| フィールド | 説明 |
|-----------|------|
| `share_url` | `/i/:token` |
| `slots` | 3件（scheduling_slots に保存済み） |
| `message_for_chat` | コピペ用文面 |

---

## 4. PR分割

### PR-B2-DB（原則なし）

B-2は **基本DB変更なし**（0082の `constraints_json` を使用）。

必要になった場合のみ：
- `constraints_json` に `source: 'freebusy'` を追加

**DoD**:
- [ ] DB変更なし、または migration が最小で明確

---

### PR-B2-API（主催者freebusy → candidates 生成）

#### 新API

```
POST /api/one-on-one/freebusy/prepare
```

#### Request

```typescript
interface FreebusyPrepareRequest {
  invitee: {
    name: string;
    email?: string;
    contact_id?: string;
  };
  constraints?: {
    time_min?: string;      // ISO8601, デフォルト: 翌営業日09:00
    time_max?: string;      // ISO8601, デフォルト: 2週間後
    prefer?: 'morning' | 'afternoon' | 'evening' | 'any';  // デフォルト: afternoon
    days?: string[];        // ['mon','tue','wed','thu','fri'], デフォルト: 平日
    duration?: number;      // 分, デフォルト: 60
  };
  candidate_count?: number; // デフォルト: 3, 最大: 5
  title?: string;           // デフォルト: '打ち合わせ'
  message_hint?: string;
  send_via?: 'email' | 'share_link';  // デフォルト: share_link
}
```

#### Response（B-1と統一）

```typescript
interface FreebusyPrepareResponse {
  success: boolean;
  thread_id: string;
  invite_token: string;
  share_url: string;
  slots: Array<{ slot_id: string; start_at: string; end_at: string }>;
  message_for_chat: string;
  mode: 'email' | 'share_link';
  email_queued?: boolean;
  // B-2追加
  constraints_used: {
    time_min: string;
    time_max: string;
    prefer: string;
    duration: number;
  };
}
```

#### 実装方針

1. **freebusy取得**: 主催者のみ（`calendar.ts` の既存ロジック流用）
2. **空き枠生成**: `slotGenerator.generateAvailableSlots()` を使用
3. **候補選出**: 
   - `prefer` に基づいてスコアリング（午後優先など）
   - 上位3件を選出
4. **DB保存**:
   - `scheduling_slots` に3枠 INSERT
   - `scheduling_threads.slot_policy = 'freebusy_multi'`
   - `constraints_json` に constraints を保存
5. **invite生成**: B-1と同じフロー

#### エラーハンドリング

| ケース | レスポンス |
|--------|-----------|
| freebusy取得失敗 | `{ error: 'calendar_unavailable', message: 'カレンダーに接続できませんでした' }` |
| 候補0件 | `{ error: 'no_available_slots', message: '指定期間に空きが見つかりませんでした。期間を広げてお試しください' }` |
| 認証なし | `{ error: 'unauthorized', message: 'ログインが必要です' }` |

**DoD**:
- [x] curl で `freebusy/prepare` を叩くと `slots.length === 3` になる
- [x] 0件の場合はユーザー向けエラーメッセージを返す
- [x] 既存 `multiSlotUI` で表示できる（slot形式が一致）
- [x] `slot_policy = 'freebusy_multi'` がセットされる
- [x] `constraints_json` に constraints が保存される
- [x] CI green (PR #47 merged)

---

### PR-B2-SSOT（intent_catalog追加）

#### 追加Intent

```json
{
  "intent": "schedule.1on1.freebusy",
  "category": "schedule.1on1",
  "description": "主催者の空き時間から候補3つを生成して1対1で送る（R0: 他人）",
  "side_effect": "write_local",
  "requires_confirmation": false,
  "topology": "1:1",
  "params_schema": {
    "invitee": { "type": "object", "required": true },
    "constraints": {
      "type": "object",
      "properties": {
        "time_min": { "type": "string", "format": "date-time" },
        "time_max": { "type": "string", "format": "date-time" },
        "prefer": { "type": "string", "enum": ["morning", "afternoon", "evening", "any"] },
        "days": { "type": "array", "items": { "type": "string" } },
        "duration": { "type": "number" }
      }
    },
    "title": { "type": "string", "optional": true },
    "send_via": { "type": "string", "enum": ["share_link", "email"], "optional": true }
  },
  "executor": "frontend:executors/oneOnOne.ts::executeOneOnOneFreebusy",
  "api": "POST /api/one-on-one/freebusy/prepare",
  "clarify_rules": {
    "time_range_missing": "いつ〜いつの範囲で候補を出しますか？（例: 来週木〜日）",
    "prefer_missing": "時間帯の希望はありますか？（午前/午後/夕方/指定なし）"
  },
  "examples": [
    "来週の空いてるところから3つ候補を送って",
    "田中さんに空き時間から候補を出して",
    "私の空いてる時間で打ち合わせの候補を作って",
    "来週木〜日の午後で空いてるところから候補出して"
  ]
}
```

**DoD**:
- [ ] SSOT (`docs/intent_catalog.json`) に追加済み
- [ ] examples が3つ以上
- [ ] `params_schema` が B-2 API と一致

---

### PR-B2-FE（frontend classifier/executor）

#### Classifier 拡張

**検出キーワード**:
- `空いてるところから`, `空き時間から`, `freebusy`, `空いてる時間帯`
- `私の空き`, `自分の空き`, `カレンダーから`

**抽出パラメータ**:
- `time_min` / `time_max`: 期間表現から抽出
- `prefer`: 「午後」「午前」「夕方」
- `duration`: 「1時間」「30分」「2時間」
- `invitee`: 人名/メールアドレス

**分岐ロジック**:
```
IF (freebusy keywords detected)
  AND (invitee extracted)
  → schedule.1on1.freebusy
ELSE IF (freebusy keywords detected)
  AND (invitee NOT extracted)
  → needsClarification: "誰に送りますか？"
ELSE IF (range NOT extracted)
  → needsClarification: "いつ〜いつの範囲で候補を出しますか？"
```

#### Executor 追加

```typescript
// executors/oneOnOne.ts
export async function executeOneOnOneFreebusy(
  intentResult: IntentResult,
  rawInput: string
): Promise<ExecutionResult> {
  // 1. トークン検証
  // 2. 入力検証（invitee必須）
  // 3. constraints組み立て（デフォルト値適用）
  // 4. API呼び出し: POST /api/one-on-one/freebusy/prepare
  // 5. ExecutionResult 返却
}
```

#### apiExecutor.ts 分岐追加

```typescript
case 'schedule.1on1.freebusy':
  return executeOneOnOneFreebusy(intentResult, rawInput);
```

**DoD**:
- [ ] 「来週木曜以降の午後で空いてる時間から3つ候補出して」→ intent が `schedule.1on1.freebusy` になる
- [ ] range 不足 → clarify が出る
- [ ] invitee 不足 → clarify が出る
- [ ] TypeScript build pass
- [ ] lint pass
- [ ] 単体テスト追加

---

### PR-B2-E2E（fixtureで「揺れ」を吸収）

#### 方針

freebusy の結果は現実のカレンダーに依存して揺れるので、**E2E は fixture で freebusy 結果を固定する**。

#### 追加 Fixture

```
POST /test/fixtures/freebusy-context
```

**役割**: 主催者のカレンダーに「固定の予定」を入れて、slotGenerator の結果を決定論化する。

**実装案**:
1. テスト用カレンダーIDに固定busy区間を設定
2. または: `slotGenerator` に mock モードを追加して、fixture から決定論的な空き枠を返す

#### Playwright テスト

```typescript
// frontend/e2e/one-on-one.freebusy.spec.ts

test('freebusy候補3つで招待→選択→承諾→thank-you', async ({ page }) => {
  // 1. fixture準備（freebusy context）
  // 2. チャット入力: 「来週の空いてるところから3つ候補を田中さんに送って」
  // 3. API → candidates生成確認
  // 4. /i/:token で3候補表示
  // 5. 選択 → 承諾
  // 6. thank-you ページ確認
  // 7. cleanup
});
```

**DoD**:
- [ ] CI で常に安定して通る（日時は未来固定）
- [ ] cleanup（fixture delete）あり
- [ ] 候補が必ず3件表示される

---

## 5. リスクとガード

| リスク | 対策 |
|--------|------|
| freebusy取得失敗（Google API） | エラーメッセージ + retry案内 |
| 候補が0件 | constraints の緩和を促す（期間拡張/時間帯変更） |
| 生成が偏る | scorer 導入 or 固定ロジック（午後優先）で安定化 |
| 他人の予定漏洩 | **R0なので相手のカレンダーは扱わない**（情報漏洩ゼロ） |

---

## 6. B-2 完了の定義（DoD）

- [ ] `schedule.1on1.freebusy` が SSOT / FE / API 全て揃っている
- [ ] 候補3つが作られ、相手が選べる（multiSlotUI）
- [ ] E2E が CI で安定 pass（fixture で揺れ吸収）
- [ ] production で `LOG_LEVEL=warn` でも運用に必要なログは warn/error で追える
- [ ] ドキュメント（`ONE_ON_ONE_DIFF_CHECKLIST.md`）更新

---

## 7. 実装順序

1. **PR-B2-API**: 主催者freebusy → candidates 生成 API
2. **PR-B2-SSOT**: intent_catalog に `schedule.1on1.freebusy` 追加
3. **PR-B2-FE**: classifier / executor 実装
4. **PR-B2-E2E**: fixture + Playwright テスト

---

## 8. 参照ファイル

| 用途 | ファイル |
|------|---------|
| API実装 | `apps/api/src/routes/oneOnOne.ts` |
| freebusy取得 | `apps/api/src/routes/calendar.ts` |
| 空き枠生成 | `apps/api/src/utils/slotGenerator.ts` |
| UI | `apps/api/src/routes/invite.ts` |
| SSOT | `docs/intent_catalog.json` |
| Classifier | `frontend/src/core/chat/classifier/oneOnOne.ts` |
| Executor | `frontend/src/core/chat/executors/oneOnOne.ts` |
| E2E Fixture | `apps/api/src/routes/testFixtures.ts` |

# PR-B3: 1対1（R0: 他人）別日希望 → 再提案フロー（最大2回）

> **Version**: 2026-01-28  
> **Status**: 🚧 実装中  
> **依存**: PR-B2（✅ 完了）

---

## 1. 目的（B-3で実現する体験）

「断られたら終わり」ではなく、**秘書らしく2回まで再調整できる体験**を完成させる。

1. 相手が **「別日を希望」** を選択できる
2. 希望条件を **最小入力で受け取れる**（選択式＋補足自由記述）
3. AIが条件を解釈して **再度候補を提示できる**
4. **最大2回まで再提案**し、それ以上は **Open Slots（B-4）へ誘導**

---

## 2. 前提（B-3で扱う関係値）

| 項目 | 値 |
|------|-----|
| 対象関係 | R0: 他人 |
| カレンダー共有 | なし（相手のカレンダーは見ない） |
| 調整方式 | URLベース |
| 再利用資産 | 主催者 freebusy（B-2）or 固定候補（B-1） |

---

## 3. 既存資産（B-3でフル活用）

| 資産 | 状態 | 備考 |
|------|------|------|
| `proposal_version` | ✅ 既存 | 世代管理 |
| `additional_propose_count` | ✅ 既存 | 再提案回数 |
| `constraints_json` | ✅ 既存 | 希望条件保存 |
| `multiSlotUI()` | ✅ 既存 | 再提案UIも流用 |
| `slotGenerator` | ✅ 既存 | 再候補生成 |
| `schedule.1on1.candidates3` | ✅ 既存 | 再提案の基本 |

👉 **新しいDBテーブルは不要**

---

## 4. B-3 フロー全体像

```
候補提示（B-1 / B-2）
        ↓
相手が「別日を希望」
        ↓
希望条件を入力（簡易）
        ↓
再提案①（proposal_version +1）
        ↓
再度「別日希望」
        ↓
再提案②（proposal_version +1）
        ↓
3回目は自動的に
Open Slots（B-4）へ誘導
```

---

## 5. PR分割計画（B-3）

### PR-B3-UI

**別日希望フォーム（invite UI）**

**対象ファイル**: `apps/api/src/routes/invite.ts`

**変更点**:
1. 既存の「辞退する」「別の日程を希望する」を **「別日を希望する」に統一**
2. モーダルUIを追加

**フォーム入力項目（最小・選択式）**:

```
📅 希望期間
[ ] 来週（デフォルト）
[ ] 再来週
[ ] 指定なし

🕒 時間帯
[ ] 午前
[ ] 午後（デフォルト）
[ ] 夕方
[ ] 指定なし

📝 補足（任意・1行）
[                    ]

[この条件で再提案する] [やっぱりやめる]
```

**DoD**:
- [ ] multiSlotUI / singleSlotUI で「別日を希望する」ボタンが統一
- [ ] モーダルUIが表示され、期間・時間帯・補足が入力可能
- [ ] 送信で `/i/:token/request-alternate` を呼び出す

---

### PR-B3-API

**別日希望受付 + 再提案生成**

**新API**:
```
POST /i/:token/request-alternate
```

**Request**:
```typescript
interface RequestAlternateBody {
  range: 'next_week' | 'next_next_week' | 'any';
  prefer: 'morning' | 'afternoon' | 'evening' | 'any';
  comment?: string;  // 補足（任意）
}
```

**Response（成功時）**:
```typescript
interface RequestAlternateResponse {
  success: true;
  new_proposal_version: number;
  slots: Array<{ slot_id: string; start_at: string; end_at: string }>;
  message: string;  // "新しい候補を3件生成しました"
}
```

**Response（上限到達時）**:
```typescript
interface RequestAlternateMaxReachedResponse {
  success: true;
  max_reached: true;
  message: string;  // "候補を2回出しました。空いている枠一覧から選べるリンクを作りますか？"
  open_slots_url?: string;  // B-4で使用
}
```

**処理内容**:
1. `additional_propose_count` を確認
2. 2回未満なら:
   - `constraints_json` を上書き
   - `proposal_version += 1`
   - `additional_propose_count += 1`
   - 新しい `scheduling_slots` を生成
3. 2回以上なら:
   - `max_reached: true` を返す

**DoD**:
- [ ] `/i/:token/request-alternate` が動作
- [ ] 再提案で `proposal_version` と `additional_propose_count` が増加
- [ ] 2回超過で `max_reached` レスポンス
- [ ] 新スロットがDBに保存される

---

### PR-B3-SSOT

**intent_catalog 追加**

```json
{
  "intent": "schedule.1on1.request_alternate",
  "category": "schedule.1on1",
  "description": "別日希望を受けて再提案を行う",
  "side_effect": "write_local",
  "requires_confirmation": false,
  "topology": "1:1",
  "executor": "frontend:executors/oneOnOne.ts::executeOneOnOneReproposal",
  "api": "POST /i/:token/request-alternate"
}
```

**DoD**:
- [ ] `docs/intent_catalog.json` に追加
- [ ] executor パス明記

---

### PR-B3-FE

**Frontend executor**

**追加処理**:
- `executeOneOnOneReproposal()`
- 成功時: 「新しい候補を送りました」
- 回数超過時: 「空き時間一覧をお送りします」→ B-4へ

**DoD**:
- [ ] executor が追加されている
- [ ] apiExecutor.ts に分岐追加

---

### PR-B3-E2E

**E2Eテスト（fixture使用）**

**fixture**: 既存 `testFixtures.ts` を流用（`proposal_version` / `additional_propose_count` を操作）

**テストケース**:
1. 別日希望 → 再提案①
2. 再度別日希望 → 再提案②
3. 3回目 → Open Slots誘導
4. UI文言とslot数確認

**DoD**:
- [ ] CIで安定pass
- [ ] 全分岐をカバー

---

## 6. ガードルール（重要）

| ルール | 理由 |
|--------|------|
| 再提案は最大2回 | 無限ループ禁止（UX事故防止） |
| 3回目は自動的にOpen Slots | 明示的な出口 |
| 履歴は `proposal_version` で追跡 | デバッグ・監査可能 |

---

## 7. B-3 完了条件（最終DoD）

- [ ] 別日希望フォームがUIに出る
- [ ] 再提案が最大2回まで動作
- [ ] 3回目でOpen Slotsに遷移
- [ ] E2Eで全分岐確認
- [ ] `docs/ONE_ON_ONE_DIFF_CHECKLIST.md` 更新

---

## 8. 実装順序

1. **PR-B3-UI**: invite.ts に別日希望モーダル
2. **PR-B3-API**: POST /i/:token/request-alternate
3. **PR-B3-SSOT**: intent_catalog追加
4. **PR-B3-FE**: executor追加
5. **PR-B3-E2E**: fixture + Playwright

---

## 9. 参照ファイル

| 用途 | ファイル |
|------|---------|
| Invite UI | `apps/api/src/routes/invite.ts` |
| API実装 | `apps/api/src/routes/invite.ts` (同ファイル) |
| スロット生成 | `apps/api/src/utils/slotGenerator.ts` |
| SSOT | `docs/intent_catalog.json` |
| Executor | `frontend/src/core/chat/executors/oneOnOne.ts` |
| E2E Fixture | `apps/api/src/routes/testFixtures.ts` |

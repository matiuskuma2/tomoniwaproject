# Phase B-5: 再提案3回目で自動 Open Slots 誘導

> **Version**: 2026-01-28  
> **Status**: 計画中  
> **依存**: B-1〜B-4 完了済み

---

## 概要

**再提案3回目で自動的に Open Slots を生成してURL送付**

### Before（現状）

```
再提案 1回目 → 新しい候補を生成
再提案 2回目 → 新しい候補を生成
再提案 3回目 → メッセージだけ表示（"Open Slotsをご利用ください"）
              → 人が自分で判断する必要あり
```

### After（B-5）

```
再提案 1回目 → 新しい候補を生成
再提案 2回目 → 新しい候補を生成
再提案 3回目 → 自動で Open Slots を生成
              → URL送付（判断不要）
```

---

## 設計思想

**「判断をAIに任せる」**

- 3回も調整がうまくいかない = 候補提示型では解決困難
- この時点で「好きに選んでもらう」に切り替えるのが最善
- 人間が「Open Slots使おう」と考える手間を省く

---

## 実装詳細

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `apps/api/src/routes/invite.ts` | `POST /i/:token/request-alternate` に自動 Open Slots 生成ロジック追加 |

### 変更ロジック（疑似コード）

```typescript
// POST /i/:token/request-alternate 内

// 現在の再提案回数を取得
const currentCount = thread.additional_propose_count || 0;

if (currentCount >= 2) {
  // 3回目（0, 1, 2 → 次は3回目）
  // → 自動で Open Slots を生成
  
  const openSlotsResult = await createOpenSlots({
    thread,
    invitee: { name: invite.invitee_name, email: invite.invitee_email },
    constraints: {
      range: body.range,
      prefer: body.prefer,
      // 既存の constraints_json からも継承
    },
    title: thread.title,
  });
  
  return c.json({
    success: true,
    max_reached: true,
    auto_open_slots: true,
    open_slots_url: openSlotsResult.share_url,
    open_slots_token: openSlotsResult.token,
    message: '何度も調整ありがとうございます。空き時間から直接選んでいただけるようにしました。',
  });
}

// 2回目以下は従来どおり新候補生成
// ...existing logic...
```

### API レスポンス変更

**Before（max_reached=true 時）**
```json
{
  "success": true,
  "max_reached": true,
  "message": "再提案は最大2回までです。OpenSlotsをご利用ください。"
}
```

**After（max_reached=true 時）**
```json
{
  "success": true,
  "max_reached": true,
  "auto_open_slots": true,
  "open_slots_url": "https://app.tomoniwao.jp/open/abc123",
  "open_slots_token": "abc123",
  "slots_count": 24,
  "expires_at": "2026-02-11T23:59:59Z",
  "message": "何度も調整ありがとうございます。空き時間から直接選んでいただけるようにしました。"
}
```

### UI 変更

| ファイル | 変更内容 |
|---------|---------|
| `apps/api/src/routes/invite.ts` | `showMaxReachedUI()` で Open Slots URL を表示 |

**Before**
```html
<div class="text-center p-8">
  <p>再提案は最大2回までとなっております。</p>
  <p>OpenSlotsのご利用をお願いします。</p>
</div>
```

**After**
```html
<div class="text-center p-8">
  <p>何度も調整ありがとうございます。</p>
  <p>空き時間から直接お選びいただけるようにしました。</p>
  <a href="/open/abc123" class="btn btn-primary">
    空き時間を確認する
  </a>
</div>
```

---

## 内部関数の流用

### Open Slots 生成に必要な処理

すべて既存コードを流用：

| 処理 | 既存コード |
|------|-----------|
| freebusy 取得 | `apps/api/src/routes/calendar.ts` |
| 空き枠生成 | `apps/api/src/utils/slotGenerator.ts::generateAvailableSlots()` |
| open_slots 保存 | `apps/api/src/routes/oneOnOne.ts::POST /open-slots/prepare` の内部ロジック |

### 実装方針

**方針A**: oneOnOne.ts の `/open-slots/prepare` を内部呼び出し
- メリット: コード重複なし
- デメリット: HTTP オーバーヘッド

**方針B**: 共通関数を切り出して両方から呼ぶ（推奨）
- `createOpenSlotsInternal()` を作成
- `/open-slots/prepare` と `request-alternate` から呼ぶ
- コード重複なし + オーバーヘッドなし

```typescript
// apps/api/src/services/openSlotsService.ts（新規）

export async function createOpenSlotsInternal(params: {
  env: Env;
  userId: string;
  workspaceId: string;
  threadId: string;
  invitee: { name: string; email?: string };
  constraints?: { time_min?: string; time_max?: string; prefer?: string; days?: string[]; duration?: number };
  title?: string;
  expiresInDays?: number;
}): Promise<OpenSlotsResult> {
  // 1. freebusy 取得
  // 2. slotGenerator で枠生成
  // 3. open_slots / open_slot_items に保存
  // 4. 結果を返す
}
```

---

## PR 分割

| PR | 内容 | 依存 | DoD |
|----|------|------|-----|
| **PR-B5-API** | `createOpenSlotsInternal` 切り出し + `request-alternate` 統合 | なし | curl で 3回目リクエスト → Open Slots URL 取得 |
| **PR-B5-E2E** | Playwright: 再提案3回 → 自動 Open Slots 遷移 | PR-B5-API | CI green |

---

## E2E テストケース

### 新規テストケース

| テスト | 説明 |
|--------|------|
| 再提案3回目で自動 Open Slots | `request-alternate` を3回呼ぶと `auto_open_slots=true` で Open Slots URL が返る |
| 自動生成された Open Slots ページ表示 | 返された URL にアクセスして枠が表示される |
| Open Slots から選択完了 | 枠選択 → thank-you まで |

### Fixture 拡張

既存の `one-on-one-candidates` fixture を使用し、`additional_propose_count` を 2 に設定した状態を作る。

```typescript
// POST /test/fixtures/one-on-one-near-max
{
  "invitee_name": "テスト太郎",
  "additional_propose_count": 2  // 次の request-alternate で max 到達
}
```

---

## DoD（完了定義）

- [ ] `createOpenSlotsInternal()` が `/open-slots/prepare` と `request-alternate` から共用される
- [ ] 再提案3回目で自動的に Open Slots が生成される
- [ ] レスポンスに `auto_open_slots`, `open_slots_url`, `open_slots_token` が含まれる
- [ ] UI に「空き時間を確認する」ボタンが表示される
- [ ] E2E テストが CI green
- [ ] docs/ONE_ON_ONE_DIFF_CHECKLIST.md に B-5 完了を追記

---

## 工数見積もり

| PR | 見積もり |
|----|---------|
| PR-B5-API | 2-3時間 |
| PR-B5-E2E | 1-2時間 |
| **合計** | **3-5時間（0.5日）** |

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-01-28 | 初版作成 |

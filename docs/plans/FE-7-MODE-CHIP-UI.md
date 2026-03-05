# FE-7 実装PRD：Mode Chip UI（スケジューリングモード明示選択）

## ステータス: 📋 PRD確定 / 未実装

> **起案日**: 2026-03-05
> **PRD確定日**: 2026-03-05
> **起案者**: モギモギ（関屋紘之）
> **優先度**: Phase 1（UX改善 — コア機能仕上げ）
> **見積り合計**: ~8h
> **方式**: A案（Mode Chip — チャット入力上部の最小UI）

---

## 1. 課題（なぜこれが必要か）

### 現状の問題

現在の Classifier Chain はユーザーの自然言語入力だけでスケジューリングモードを決定している：

```
「佐藤さんと来週木曜17時、予定調整」    → Fixed
「田中さんに候補出して」                → Candidates3
「Aさんと空いてるところから調整」        → FreeBusy
「Bさんに選んでもらう」                 → Open Slots
「社長にご都合伺い」                    → Reverse Availability
```

**問題点：**

1. **モード認知ギャップ**: ユーザーは5種類のモードの存在を知らない
2. **キーワード依存**: 「空いてるところから」を言わないと FreeBusy にならない
3. **意図のズレ**: 「日程調整して」だけでは Fixed になり、本来 Candidates3 が適切だったケースが多い
4. **学習コスト**: パワーユーザーでないとキーワードを覚えられない

### あるべき体験

> チャット入力欄の上に小さな Chip UI。タップすると5モードが表示。
> 選択すると classifierChain のルーティングがオーバーライドされ、
> 確実にそのモードで発動する。

---

## 2. 設計方針

### A案（採用）: Mode Chip — チャット入力上部の最小UI

```
┌─────────────────────────────────────┐
│                                     │
│    [チャットメッセージ表示エリア]       │
│                                     │
├─────────────────────────────────────┤
│ 🤖 Auto │ 📌 Fixed │ 📋 候補 │ 🔍 空き │ 📨 公開枠 │ 🙏 ご都合伺い │
├─────────────────────────────────────┤
│ [テキスト入力欄]          [送信ボタン]  │
└─────────────────────────────────────┘
```

**特徴：**
- 横スクロール可能な Chip 行（6個）
- デフォルト: `Auto`（従来どおり NL で分類）
- 選択するとハイライト + classifier にヒントを渡す
- 新しいAPI/DBは不要（フロントエンドだけで完結）
- pending が active な間は disabled

### B案（不採用）: 「What Next?」メニュー統合

- ChatPane のメッセージとして「次に何をしますか？」を表示
- ボタンクリックで分岐
- ❌ 不採用理由: UIが重い、チャット履歴が汚れる、実装コスト2倍

---

## 3. データモデル

### 3.1 `IntentContext.preferredMode` の追加

```typescript
// classifier/types.ts
export interface IntentContext {
  selectedThreadId?: string;
  selectedSlotId?: string;
  pendingForThread?: PendingState | null;
  globalPendingAction?: PendingState | null;
  // ★ FE-7: ユーザーが明示的に選択したモード
  preferredMode?: SchedulingMode | null;
}

// ★ FE-7: スケジューリングモード型
export type SchedulingMode =
  | 'auto'                    // 従来どおり NL で分類
  | 'fixed'                   // schedule.1on1.fixed
  | 'candidates'              // schedule.1on1.candidates3
  | 'freebusy'                // schedule.1on1.freebusy
  | 'open_slots'              // schedule.1on1.open_slots
  | 'reverse_availability';   // schedule.1on1.reverse_availability
```

### 3.2 DB変更: なし

Mode Chip はフロントエンドのみで完結。ステートは `useChatReducer` の `ChatState` に保持し、localStorage で永続化しない（セッション内のみ）。

---

## 4. Classifier Chain への影響

### 4.1 classifyOneOnOne への override 注入

`preferredMode` が `auto` 以外のとき、oneOnOne classifier に到達した時点で強制的にそのモードの intent を返す。

**変更箇所**: `classifier/oneOnOne.ts`

```typescript
export const classifyOneOnOne: ClassifierFn = (
  input, _normalizedInput, context, activePending
) => {
  if (activePending) return null;
  if (!hasTriggerWord(input)) return null;
  const person = extractPerson(input);
  if (!person) return null;

  // ★ FE-7: preferredMode オーバーライド
  const mode = context?.preferredMode;
  if (mode && mode !== 'auto') {
    return buildForcedModeResult(mode, input, person, extractDuration(input), extractTitle(input));
  }

  // ... 既存ロジック（freebusy / open_slots / candidates3 / fixed の判定）
};
```

### 4.2 classifyReverseAvailability への override 注入

`preferredMode === 'reverse_availability'` のとき、逆アベイラビリティ classifier で REVERSE_KEYWORDS チェックをスキップして即 match。

**変更箇所**: `classifier/reverseAvailability.ts`

```typescript
export const classifyReverseAvailability: ClassifierFn = (
  input, _normalizedInput, context, activePending
) => {
  if (activePending) return null;

  // ★ FE-7: preferredMode が reverse_availability ならキーワード不要
  const forcedRA = context?.preferredMode === 'reverse_availability';

  if (!forcedRA && !hasReverseKeyword(input)) return null;

  // ... person/email 抽出以降は同じ
};
```

### 4.3 classifyOneToMany への影響

1対N classifier は「2名以上」を条件としているため、Mode Chip が 1対1 モードの場合でも影響なし。oneToMany は引き続き NL の人数判定で分類される。

### 4.4 チェーン全体の変更方針

| # | Classifier | FE-7 変更 |
|---|-----------|-----------|
| 1 | pendingDecision | 変更なし（最優先のまま） |
| 2 | contactImport | 変更なし |
| 3 | confirmCancel | 変更なし |
| 4 | lists | 変更なし |
| 5 | calendar | 変更なし |
| 6 | preference | 変更なし |
| 7 | oneToMany | 変更なし（2名以上のみ） |
| 8 | reverseAvailability | ★ `preferredMode` スキップ対応 |
| 9 | oneOnOne | ★ `preferredMode` オーバーライド対応 |
| 10-14 | propose〜thread | 変更なし |

**安全設計**: pending がある場合は全ての override がスキップされるため、既存フローに一切影響しない。

---

## 5. UI仕様

### 5.1 Mode Chip コンポーネント

**ファイル**: `frontend/src/components/chat/ModeChip.tsx`（新規）

```tsx
// 表示データ
const MODES: Array<{
  id: SchedulingMode;
  label: string;
  icon: string;
  description: string;
}> = [
  { id: 'auto',                 label: 'Auto',      icon: '🤖', description: 'AIが自動判定' },
  { id: 'fixed',                label: 'Fixed',     icon: '📌', description: '確定日時で招待' },
  { id: 'candidates',           label: '候補',       icon: '📋', description: '候補日を提示' },
  { id: 'freebusy',             label: '空き',       icon: '🔍', description: 'カレンダーから自動生成' },
  { id: 'open_slots',           label: '公開枠',     icon: '📨', description: '相手に選んでもらう' },
  { id: 'reverse_availability', label: 'ご都合伺い', icon: '🙏', description: '相手の空きに合わせる' },
];
```

### 5.2 表示ルール

| 状態 | 表示 |
|------|------|
| pending が active | Chip 行全体を `opacity-50` + `pointer-events-none` |
| モード未選択 | `Auto` がデフォルトでハイライト |
| モード選択後 | 選択した Chip がハイライト（blue ring） |
| 送信後 | Auto にリセット**しない**（同モードで連続操作を想定） |
| スレッド切替後 | Auto にリセット |

### 5.3 レスポンシブ

- **PC** (≥768px): 6 Chip が1行に全表示
- **SP** (<768px): 横スクロール（`overflow-x-auto`, `flex-nowrap`）

---

## 6. フォールバック設計

### 6.1 Mode と NL の競合

| preferredMode | NL判定 | 最終結果 |
|---------------|--------|----------|
| `auto` | Fixed | Fixed（NL勝ち） |
| `fixed` | FreeBusy キーワードあり | Fixed（Mode勝ち） |
| `candidates` | Fixed（日時1つ）| Candidates3（Mode勝ち、clarification で日時追加要求） |
| `freebusy` | Candidates3 | FreeBusy（Mode勝ち） |
| `reverse_availability` | OpenSlots | ReverseAvailability（Mode勝ち） |

### 6.2 エッジケース

1. **モード選択 + 人名なし** → 通常の clarification を返す
2. **モード選択 + pending active** → Mode Chip disabled → 既存 pending フローが優先
3. **モード選択 + 1対N 入力** → oneToMany classifier が先に match → Mode 無視（安全）

---

## 7. テスト計画

### 7.1 Unit Tests（classifier）

| ID | テスト | 対象 |
|----|--------|------|
| FE7-1 | `preferredMode='fixed'` + 人名 → `schedule.1on1.fixed` (clarification あり) | oneOnOne.ts |
| FE7-2 | `preferredMode='candidates'` + 人名 → `schedule.1on1.candidates3` | oneOnOne.ts |
| FE7-3 | `preferredMode='freebusy'` + 人名 → `schedule.1on1.freebusy` | oneOnOne.ts |
| FE7-4 | `preferredMode='open_slots'` + 人名 → `schedule.1on1.open_slots` | oneOnOne.ts |
| FE7-5 | `preferredMode='reverse_availability'` + 人名 → `schedule.1on1.reverse_availability` | reverseAvailability.ts |
| FE7-6 | `preferredMode='auto'` → 従来どおり NL 判定 | oneOnOne.ts |
| FE7-7 | `preferredMode='fixed'` + pending active → null（スキップ） | oneOnOne.ts |
| FE7-8 | `preferredMode='fixed'` + トリガーワードなし → null | oneOnOne.ts |
| FE7-9 | `preferredMode='fixed'` + 人名なし → null | oneOnOne.ts |
| FE7-10 | `preferredMode='reverse_availability'` + RA キーワードなし + 人名 → match | reverseAvailability.ts |
| FE7-11 | `preferredMode='reverse_availability'` + RA キーワードなし + 人名なし → clarification | reverseAvailability.ts |
| FE7-12 | 回帰: Auto モードで全既存テスト pass (42+52+13) | regression |

### 7.2 Component Tests（ModeChip UI）

| ID | テスト | 対象 |
|----|--------|------|
| FE7-C1 | 6つの Chip が描画される | ModeChip.tsx |
| FE7-C2 | クリックで selectedMode が変更される | ModeChip.tsx |
| FE7-C3 | pending active 時に disabled になる | ModeChip.tsx |
| FE7-C4 | デフォルトが Auto | ModeChip.tsx |

### 7.3 回帰テスト

- **全 410 テスト pass** を維持
- `intentClassifier.regression.test.ts` (42) → 全 pass（context に `preferredMode` なし = 既存動作）
- `intentClassifier.golden.test.ts` (52) → 全 pass

---

## 8. 変更ファイルリスト

| # | ファイル | 変更種別 | 内容 |
|---|---------|----------|------|
| 1 | `frontend/src/core/chat/classifier/types.ts` | **修正** | `IntentContext` に `preferredMode` 追加, `SchedulingMode` 型追加 |
| 2 | `frontend/src/core/chat/classifier/oneOnOne.ts` | **修正** | `preferredMode` override ロジック追加（`buildForcedModeResult` 関数） |
| 3 | `frontend/src/core/chat/classifier/reverseAvailability.ts` | **修正** | `preferredMode` による keyword スキップ |
| 4 | `frontend/src/components/chat/ModeChip.tsx` | **新規** | Mode Chip UI コンポーネント |
| 5 | `frontend/src/components/chat/useChatReducer.ts` | **修正** | `ChatState` に `selectedMode` 追加, `SET_MODE` action 追加 |
| 6 | `frontend/src/core/chat/apiExecutor.ts` | **修正** | `classifyIntent` 呼び出し時に `preferredMode` を context に渡す |
| 7 | `frontend/src/core/chat/classifier/__tests__/modeChip.test.ts` | **新規** | FE7-1〜FE7-12 テスト |
| 8 | `docs/plans/FE-7-MODE-CHIP-UI.md` | **新規** | このPRD |
| 9 | `docs/CURRENT_STATUS.md` | **修正** | 進行中に FE-7 追加 |

---

## 9. タスク分解 & PR戦略

### 安全順序（事故ゼロ）

| # | タスク | 見積り | PR |
|---|--------|--------|-----|
| **FE7-T1** | `types.ts` に `SchedulingMode` 型 + `IntentContext.preferredMode` 追加 | 0.5h | PR-FE7-a |
| **FE7-T2** | `oneOnOne.ts` に `buildForcedModeResult` + override ロジック | 1.5h | PR-FE7-a |
| **FE7-T3** | `reverseAvailability.ts` に keyword スキップ | 0.5h | PR-FE7-a |
| **FE7-T4** | Unit tests: FE7-1〜FE7-12 (classifier override) | 2h | PR-FE7-a |
| **FE7-T5** | 回帰テスト確認（410/410 pass） | 0.5h | PR-FE7-a |
| **FE7-T6** | `ModeChip.tsx` UI コンポーネント作成 | 1.5h | PR-FE7-b |
| **FE7-T7** | `useChatReducer.ts` に `selectedMode` state 追加 | 0.5h | PR-FE7-b |
| **FE7-T8** | ChatLayout / apiExecutor 統合（context に preferredMode 渡し） | 0.5h | PR-FE7-b |
| **FE7-T9** | Component tests (FE7-C1〜C4) + ドキュメント更新 | 0.5h | PR-FE7-b |

### PR分割

| PR | 内容 | 見積り | リスク |
|----|------|--------|--------|
| **PR-FE7-a** | Classifier override + Unit tests（UI不問、ロジックのみ） | ~5h | 低（型追加のみ） |
| **PR-FE7-b** | Mode Chip UI + Reducer + 統合 | ~3h | 低（UI追加のみ、ロジックはPR-aで完了） |

---

## 10. 将来拡張

| 拡張 | 説明 | Phase |
|------|------|-------|
| **1対N Mode Chip** | `1toN.candidates` / `1toN.freebusy` を追加 | Phase 2 |
| **モード記憶** | ユーザーごとにデフォルトモードを DB 保存 | Phase 2 |
| **AI推薦** | 相手の役職/関係性から最適モードを推薦 | Phase 3 |
| **モード切替アニメーション** | Chip 選択時のアニメーション | Phase 2 |

---

## 11. 安全チェックリスト

- [ ] `preferredMode` がない場合（undefined / null / auto）→ 従来動作と完全同一
- [ ] pending active 時は全 override スキップ → 既存フローに一切影響なし
- [ ] oneToMany (2名以上) は Mode Chip と独立 → 安全
- [ ] calendar / list / preference 等の非スケジューリング intent は影響なし
- [ ] 全 410 既存テスト pass 維持
- [ ] TypeScript strict mode 全通過

---

*このPRDは FE-7 実装の唯一の設計書です。変更時はこのファイルを更新してください。*

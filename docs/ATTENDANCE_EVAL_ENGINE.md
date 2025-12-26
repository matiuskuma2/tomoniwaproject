# Attendance Evaluation Engine (擬似コード / 確定版)

本ドキュメントは Attendance Rule に基づき、
- どの Slot が成立可能か
- 現時点で確定できるか
- 誰が未回答/不足か

を判定する「評価エンジン」の仕様と擬似コードを定義する。

## 0. 入力/出力

### 入力（DBから取得して渡す）
- `rule`: AttendanceRule JSON（`thread_attendance_rules.rule_json`）
- `slots[]`: `scheduling_slots`（thread_idで絞る）
- `invites[]`: `thread_invites`（thread_idで絞る）
  - invitee_key, status
- `selections[]`: `thread_selections`（thread_idで絞る）
  - invite_id, invitee_key, status, selected_slot_id

### 出力（評価結果）

```typescript
type EvalResult = {
  thread_id: string;

  // slotごとの成立状況
  slot_results: Array<{
    slot_id: string;
    is_valid: boolean;
    score: number; // 例: accepted数、優先順位、時間近さなど
    counts: {
      selected: number;
      declined: number;
      pending: number;
    };
    satisfied: {
      // ルールごとに意味が異なる
      required_ok?: boolean;
      quorum_ok?: boolean;
      k_ok?: boolean;
      group_ok?: boolean;
      all_ok?: boolean;
      any_ok?: boolean;
    };
    missing_invitee_keys: string[]; // 成立に必要で未達の人
  }>;

  // 現時点の推奨確定slot
  recommendation: {
    can_finalize: boolean;
    recommended_slot_id: string | null;
    reason: string;
    finalize_policy: "EARLIEST_VALID" | "BEST_SCORE" | "MANUAL";
  };

  // 追いかけ対象（未回答/不足）
  followups: {
    pending_invitee_keys: string[];
    required_missing_invitee_keys: string[];
    suggested_remind_invitee_keys: string[];
  };
};
```

## 1. 前処理（正規化）

### 1.1 invitee_keyの対応表

```
inviteeKeys = invites.map(i => i.invitee_key).filter(Boolean)
```

### 1.2 selection集計（slot別）

```
bySlot = Map<slot_id, {selectedKeys:Set, declinedKeys:Set, pendingKeys:Set}>
init each slot with empty sets
for each invitee_key in inviteeKeys:
  status = latestSelectionStatus(invitee_key) // selected/declined/pending
  if status == selected: add to bySlot[selected_slot_id].selectedKeys
  if status == declined: add to declinedKeys
  if status == pending: add to pendingKeys
```

`latestSelectionStatus`は `thread_selections.created_at` の最新を採用する。

## 2. ルール評価（slotごと）

### 2.1 共通: 対象者集合の確定

```
TARGET = include_invitee_keys - exclude_invitee_keys
REQUIRED = rule.required_invitee_keys (存在すれば) else []
OPTIONAL = TARGET - REQUIRED
```

### 2.2 ALL

```
valid(slot):
  return (selectedKeys(slot) contains all TARGET)
missing = TARGET - selectedKeys(slot)
score = size(selectedKeys(slot))
```

### 2.3 ANY

```
valid(slot):
  return size(selectedKeys(slot) ∩ TARGET) >= 1
missing = [] (ANYは「未達でも成立ではない」ので空でも良い)
score = size(selectedKeys(slot) ∩ TARGET)
```

### 2.4 K_OF_N

```
K = rule.k
valid(slot):
  return size(selectedKeys(slot) ∩ TARGET) >= K
missing = (K - count) を満たすために必要な人数（pendingから優先）
score = size(selectedKeys(slot) ∩ TARGET)
```

### 2.5 REQUIRED_PLUS_QUORUM

```
minAdditional = rule.min_additional
valid(slot):
  required_ok = REQUIRED subset of selectedKeys(slot)
  additional_count = size(selectedKeys(slot) ∩ OPTIONAL)
  quorum_ok = additional_count >= minAdditional
  return required_ok && quorum_ok

missing_required = REQUIRED - selectedKeys(slot)
missing_optional_needed = max(0, minAdditional - additional_count)
missing_invitee_keys = missing_required + pick(pending OPTIONAL, missing_optional_needed)
score = 1000*required_ok + additional_count // required達成を優先
```

### 2.6 GROUP_ANY

```
groups = rule.groups[]
valid(slot):
  for each g in groups:
     ok = size(selectedKeys(slot) ∩ g.any_of_invitee_keys) >= g.min
     if ok: return true
  return false

missing:
  // 成立に最短なグループを選び、その不足分を pendingから提案
score = max over groups (size(selectedKeys(slot) ∩ groupKeys))
```

## 3. 推奨確定slot選定

### 3.1 finalize_policy適用

```
validSlots = slot_results.filter(is_valid)

if validSlots empty:
  can_finalize = false
  recommended_slot_id = null
else:
  if policy == EARLIEST_VALID:
     recommended = earliest(start_at)
  if policy == BEST_SCORE:
     recommended = max(score), tie_breaker apply
  if policy == MANUAL:
     recommended = null (UIで選ばせる)
```

### 3.2 自動確定する条件

```
if finalize_policy.auto_finalize == true AND can_finalize == true:
  if now >= created_at + auto_finalize_delay_seconds:
     finalize(thread, recommended_slot_id)
```

## 4. リマインド対象の抽出

```
pending = inviteeKeys where latestSelectionStatus(invitee_key) == pending
required_missing = REQUIRED where status != selected
suggested_remind = required_missing + (pending - required_missing) limited by config
```

## 5. 注意点（実装ルール）

- **判定は常に"slotごと"**に行う（合算しない）
- `declined` は slot成立に寄与しないが、進捗計算には必要
- `expired` は `pending` と同等に扱うか、別枠（運用で決める）。MVPは `pending` 扱い推奨
- すでに `thread_finalize` が存在する場合は、評価は参照専用（再確定は原則不可）

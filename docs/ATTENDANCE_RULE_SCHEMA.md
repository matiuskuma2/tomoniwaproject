# Attendance Rule Schema (確定版)

本ドキュメントは、予定調整（スレッド）における「参加条件（Attendance Rule）」の **確定JSONスキーマ** と **代表例** を定義する。

## 0. 用語

- **Thread**: 日程調整の単位（DB: `scheduling_threads`）
- **Slot**: 候補枠（日時の候補）（DB: `scheduling_slots`）
- **Invitee**: 招待対象（内部ユーザー・外部メール等を含む）  
- **InviteeKey**: 招待対象の識別子（DB: `thread_invites.invitee_key`）
  - `u:<user_id>` 内部ユーザー
  - `e:<sha256_16(email_lowercase)>` 外部メール（推奨最終形）
  - `lm:<list_member_id>` リスト会員（将来）
- **Selection**: 招待者の回答（DB: `thread_selections`）
  - `status = selected | declined | pending | expired`
  - `selected_slot_id`（selectedの場合）

## 1. AttendanceRule JSON (Root)

### 1.1 JSON Schema（概念スキーマ）

```json
{
  "version": "1.0",
  "type": "ALL | ANY | K_OF_N | REQUIRED_PLUS_QUORUM | GROUP_ANY",
  "slot_policy": {
    "conflict_policy": "NONE | SOFT | HARD",
    "timezone": "Asia/Tokyo",
    "allow_multiple_slots_per_invitee": false
  },
  "invitee_scope": {
    "include_invitee_keys": ["u:...", "e:..."],
    "exclude_invitee_keys": []
  },
  "rule": {
    "required_invitee_keys": ["u:...", "e:..."],
    "k": 3,
    "n": 10,
    "min_additional": 4,
    "groups": [
      {
        "name": "Group-A",
        "any_of_invitee_keys": ["u:...", "e:..."],
        "min": 1
      }
    ]
  },
  "finalize_policy": {
    "mode": "EARLIEST_VALID | BEST_SCORE | MANUAL",
    "tie_breaker": "EARLIEST | MOST_ACCEPTED | RANDOM",
    "auto_finalize": false,
    "auto_finalize_delay_seconds": 0
  }
}
```

**注意**: `type` に応じて `rule` の必須フィールドは異なる（下記参照）

## 2. type別の確定仕様

### 2.1 ALL（全員一致）

**意味**: `invitee_scope.include_invitee_keys` の全員が、同一slotを selected した場合に成立。

**必須フィールド**
- `type = "ALL"`
- `invitee_scope.include_invitee_keys[]`（対象者）

**option**
- `rule.required_invitee_keys[]`（ALL対象のうち、必須を明示したい場合）
  - 省略時は include 全員必須扱い。

### 2.2 ANY（誰か1人で成立）

**意味**: 対象者のうち「誰か1人」が selected したら成立。  
募集枠（例：参加者が集まったら開催、1人でもOK）に使う。

**必須フィールド**
- `type = "ANY"`
- `invitee_scope.include_invitee_keys[]`

**option**
- `rule.k`（ANYなのに k>1 を要求したい場合は K_OF_N を使うこと）

### 2.3 K_OF_N（K人以上で成立）

**意味**: 対象者Nのうち K人以上 が同一slotを selected したら成立。

**必須フィールド**
- `type = "K_OF_N"`
- `invitee_scope.include_invitee_keys[]`
- `rule.k`（>=1）

### 2.4 REQUIRED_PLUS_QUORUM（必須メンバー + 任意クオラム）

**意味**:
- `required_invitee_keys` 全員が selected し
- かつ（required以外の）追加参加者が `min_additional` 以上
- 同一slotを選んでいる場合に成立。

**必須フィールド**
- `type = "REQUIRED_PLUS_QUORUM"`
- `invitee_scope.include_invitee_keys[]`
- `rule.required_invitee_keys[]`
- `rule.min_additional`（>=0）

### 2.5 GROUP_ANY（グループ条件のいずれかで成立）

**意味**: 複数グループを定義し、いずれかのグループが条件を満たしたら成立。  
例：A&B or C&D or E&F のどれかが成立なら開催。

**必須フィールド**
- `type = "GROUP_ANY"`
- `rule.groups[]`
  - `groups[i].any_of_invitee_keys[]`
  - `groups[i].min`（>=1）

**option**
- `rule.required_invitee_keys[]` を併用して「この人は常に必須」を表現可能  
  （ただし仕様が複雑になるため、原則は REQUIRED_PLUS_QUORUM を推奨）

## 3. 代表例（コピペ用）

### 3.1 例：家族（ALL）「全員が来れる日」

```json
{
  "version": "1.0",
  "type": "ALL",
  "slot_policy": {
    "conflict_policy": "HARD",
    "timezone": "Asia/Tokyo",
    "allow_multiple_slots_per_invitee": false
  },
  "invitee_scope": {
    "include_invitee_keys": ["u:father", "u:mother", "u:child"],
    "exclude_invitee_keys": []
  },
  "rule": {},
  "finalize_policy": {
    "mode": "EARLIEST_VALID",
    "tie_breaker": "EARLIEST",
    "auto_finalize": true,
    "auto_finalize_delay_seconds": 0
  }
}
```

### 3.2 例：募集（ANY）「誰か1人でも参加したら開催」

```json
{
  "version": "1.0",
  "type": "ANY",
  "slot_policy": {
    "conflict_policy": "SOFT",
    "timezone": "Asia/Tokyo",
    "allow_multiple_slots_per_invitee": false
  },
  "invitee_scope": {
    "include_invitee_keys": ["lm:customer-001", "lm:customer-002", "lm:customer-003"],
    "exclude_invitee_keys": []
  },
  "rule": {},
  "finalize_policy": {
    "mode": "EARLIEST_VALID",
    "tie_breaker": "EARLIEST",
    "auto_finalize": true,
    "auto_finalize_delay_seconds": 0
  }
}
```

### 3.3 例：チーム（K_OF_N）「10人中5人集まればOK」

```json
{
  "version": "1.0",
  "type": "K_OF_N",
  "slot_policy": {
    "conflict_policy": "SOFT",
    "timezone": "Asia/Tokyo",
    "allow_multiple_slots_per_invitee": false
  },
  "invitee_scope": {
    "include_invitee_keys": ["u:a","u:b","u:c","u:d","u:e","u:f","u:g","u:h","u:i","u:j"],
    "exclude_invitee_keys": []
  },
  "rule": {
    "k": 5
  },
  "finalize_policy": {
    "mode": "BEST_SCORE",
    "tie_breaker": "MOST_ACCEPTED",
    "auto_finalize": false,
    "auto_finalize_delay_seconds": 0
  }
}
```

### 3.4 例：必須2名 + 任意4名（REQUIRED_PLUS_QUORUM）

「CさんとEさんは必須、それ以外で4人以上集まったら開催」

```json
{
  "version": "1.0",
  "type": "REQUIRED_PLUS_QUORUM",
  "slot_policy": {
    "conflict_policy": "HARD",
    "timezone": "Asia/Tokyo",
    "allow_multiple_slots_per_invitee": false
  },
  "invitee_scope": {
    "include_invitee_keys": ["u:a","u:b","u:c","u:d","u:e","u:f","u:g","u:h","u:i","u:j"],
    "exclude_invitee_keys": []
  },
  "rule": {
    "required_invitee_keys": ["u:c","u:e"],
    "min_additional": 4
  },
  "finalize_policy": {
    "mode": "EARLIEST_VALID",
    "tie_breaker": "MOST_ACCEPTED",
    "auto_finalize": false,
    "auto_finalize_delay_seconds": 0
  }
}
```

### 3.5 例：グループ成立（GROUP_ANY）

「A&B か C&D か E&F のどれかが揃えばOK」

```json
{
  "version": "1.0",
  "type": "GROUP_ANY",
  "slot_policy": {
    "conflict_policy": "SOFT",
    "timezone": "Asia/Tokyo",
    "allow_multiple_slots_per_invitee": false
  },
  "invitee_scope": {
    "include_invitee_keys": ["u:a","u:b","u:c","u:d","u:e","u:f"],
    "exclude_invitee_keys": []
  },
  "rule": {
    "groups": [
      { "name": "A&B", "any_of_invitee_keys": ["u:a","u:b"], "min": 2 },
      { "name": "C&D", "any_of_invitee_keys": ["u:c","u:d"], "min": 2 },
      { "name": "E&F", "any_of_invitee_keys": ["u:e","u:f"], "min": 2 }
    ]
  },
  "finalize_policy": {
    "mode": "EARLIEST_VALID",
    "tie_breaker": "EARLIEST",
    "auto_finalize": true,
    "auto_finalize_delay_seconds": 0
  }
}
```

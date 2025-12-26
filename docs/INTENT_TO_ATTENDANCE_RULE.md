# Intent to Attendance Rule Transformation

## 概要

自然言語の意図表現（"3人以上集まったら成立"、"全員必須"、"山田さんと田中さんは必須、あと2人"など）を `AttendanceRule` JSON 形式に変換する仕様を定義します。

AI秘書が日程調整の文脈でユーザーの発言を受け取り、`thread_attendance_rules` テーブルに保存する `rule_json` を生成します。

---

## Core Concepts

### Thread（日程調整スレッド）
- 識別子: `thread_id`（`scheduling_threads.id`）
- 主催者が作成し、複数の候補日時（Slots）と招待者（Invites）を持つ

### Slot（候補日時）
- 識別子: `slot_id`（`scheduling_slots.id`）
- 各候補は `start_time`, `end_time`, `timezone` を持つ

### Invite（招待）
- 識別子: `invitee_key`（`thread_invites.invitee_key`）
- 形式:
  - `u:<user_id>` : 登録ユーザー
  - `e:<sha256_16(lowercase_email)>` : 外部メール招待
  - `lm:<list_member_id>` : 顧客リストメンバー

### Selection（回答）
- 招待者が各Slotに対して行う選択
- ステータス: `selected`, `declined`, `pending`
- `thread_selections` テーブルに記録

### Finalize（確定）
- 条件を満たしたSlotが確定される
- `thread_finalize` テーブルに記録
- 確定後、カレンダー登録やビデオ会議URL生成が行われる

---

## InviteeKey Schemes

| 種別 | 形式 | 説明 | 例 |
|------|------|------|-----|
| 登録ユーザー | `u:<user_id>` | 内部システムのユーザーID | `u:123` |
| 外部メール | `e:<sha256_16(email_lowercase)>` | メールアドレスのハッシュ | `e:a3f2b8c9d1e4f5a6` |
| 顧客リスト | `lm:<list_member_id>` | リストメンバーの識別子 | `lm:456` |

**重要**: メールアドレスは小文字化してからSHA256でハッシュし、最初の16文字を使用します。これにより、メールアドレスを平文で保存せずにプライバシーを保護します。

---

## Transformation Output Structure

```json
{
  "attendance_rule": {
    "version": "1.0",
    "type": "K_OF_N",
    "slot_policy": {
      "conflict_policy": "first_selected",
      "timezone": "Asia/Tokyo",
      "allow_multiple_slots_per_invitee": false
    },
    "invitee_scope": {
      "include_invitee_keys": ["u:1", "u:2", "u:3"],
      "exclude_invitee_keys": []
    },
    "rule": {
      "k": 3,
      "n": 5
    },
    "finalize_policy": {
      "mode": "EARLIEST_VALID",
      "tie_breaker": "earliest_slot",
      "auto_finalize": true,
      "auto_finalize_delay_seconds": 3600
    }
  },
  "finalize_policy": {
    "mode": "EARLIEST_VALID",
    "auto_finalize": true,
    "auto_finalize_delay_seconds": 3600
  },
  "invitee_sets": {
    "target": ["u:1", "u:2", "u:3"],
    "required": [],
    "optional": []
  },
  "slot_generation_hint": {
    "count": 3,
    "preferred_days": ["weekday"],
    "preferred_hours": [10, 11, 14, 15, 16],
    "duration_minutes": 60
  },
  "share_intent": {
    "room_id": null,
    "list_ids": [],
    "individual_emails": ["yamada@example.com"]
  },
  "confidence": 0.95,
  "needs_clarification": [],
  "missing": []
}
```

---

## Supported Rule Types

### 1. ALL（全員必須）
**意図表現例**:
- "全員参加必須"
- "全員が同じ日時に集まれる日を探して"
- "全員が揃わないと成立しない"

**JSON出力例**:
```json
{
  "type": "ALL",
  "invitee_scope": {
    "include_invitee_keys": ["u:1", "u:2", "u:3"]
  },
  "rule": {},
  "finalize_policy": {
    "mode": "BEST_SCORE",
    "tie_breaker": "earliest_slot",
    "auto_finalize": false
  }
}
```

---

### 2. ANY（誰か1人）
**意図表現例**:
- "誰か1人でも参加できればOK"
- "最低1人参加すれば開催"
- "参加者がいれば実施"

**JSON出力例**:
```json
{
  "type": "ANY",
  "invitee_scope": {
    "include_invitee_keys": ["u:1", "u:2", "u:3"]
  },
  "rule": {},
  "finalize_policy": {
    "mode": "EARLIEST_VALID",
    "tie_breaker": "earliest_slot",
    "auto_finalize": true,
    "auto_finalize_delay_seconds": 3600
  }
}
```

---

### 3. K_OF_N（N人中K人以上）
**意図表現例**:
- "5人中3人以上が参加できればOK"
- "最低3人集まれば開催"
- "10人招待して、5人以上参加できる日を探して"

**JSON出力例**:
```json
{
  "type": "K_OF_N",
  "invitee_scope": {
    "include_invitee_keys": ["u:1", "u:2", "u:3", "u:4", "u:5"]
  },
  "rule": {
    "k": 3,
    "n": 5
  },
  "finalize_policy": {
    "mode": "EARLIEST_VALID",
    "tie_breaker": "highest_score",
    "auto_finalize": true,
    "auto_finalize_delay_seconds": 7200
  }
}
```

---

### 4. REQUIRED_PLUS_QUORUM（必須メンバー + 追加参加者）
**意図表現例**:
- "山田さんと田中さんは必須、あと2人以上参加できればOK"
- "佐藤さんは必須、プラス1人以上"
- "リーダー必須、メンバーは3人以上集まれば"

**JSON出力例**:
```json
{
  "type": "REQUIRED_PLUS_QUORUM",
  "invitee_scope": {
    "include_invitee_keys": ["u:1", "u:2", "u:3", "u:4", "u:5"]
  },
  "rule": {
    "required_invitee_keys": ["u:1", "u:2"],
    "min_additional": 2
  },
  "finalize_policy": {
    "mode": "BEST_SCORE",
    "tie_breaker": "highest_score",
    "auto_finalize": false
  }
}
```

---

### 5. GROUP_ANY（複数グループのいずれか成立）
**意図表現例**:
- "Aチームから2人 または Bチームから3人"
- "営業部から2人以上、または開発部から1人以上"
- "シフトAから3人、またはシフトBから4人"

**JSON出力例**:
```json
{
  "type": "GROUP_ANY",
  "invitee_scope": {
    "include_invitee_keys": ["u:1", "u:2", "u:3", "u:4", "u:5", "u:6"]
  },
  "rule": {
    "groups": [
      {
        "name": "Team A",
        "min": 2,
        "any_of_invitee_keys": ["u:1", "u:2", "u:3"]
      },
      {
        "name": "Team B",
        "min": 3,
        "any_of_invitee_keys": ["u:4", "u:5", "u:6"]
      }
    ]
  },
  "finalize_policy": {
    "mode": "EARLIEST_VALID",
    "tie_breaker": "highest_score",
    "auto_finalize": true,
    "auto_finalize_delay_seconds": 3600
  }
}
```

---

## Ambiguity Handling

曖昧な表現は `ANY` にマッピングし、`needs_clarification` フィールドで不明点を返します。

**例**:
- 入力: "みんなで集まりたい"（具体的な人数や必須条件が不明）
- 出力:
```json
{
  "attendance_rule": {
    "type": "ANY",
    ...
  },
  "needs_clarification": [
    "「みんな」の具体的な対象者を教えてください",
    "全員必須ですか？それとも一部でもOKですか？"
  ],
  "confidence": 0.6
}
```

---

## Finalize Policy Mapping

| Rule Type | デフォルトFinalize Mode | 理由 |
|-----------|------------------------|------|
| ANY | `EARLIEST_VALID` | 最初に条件を満たしたSlotで確定 |
| ALL | `BEST_SCORE` (MVP: `MANUAL`) | 全員の都合を考慮し、最適なSlotを選択 |
| K_OF_N | `EARLIEST_VALID` | 条件を満たしたら早めに確定 |
| REQUIRED_PLUS_QUORUM | `BEST_SCORE` | 必須メンバーの都合を最優先 |
| GROUP_ANY | `EARLIEST_VALID` | いずれかのグループ条件を満たしたら確定 |

**Tie Breaker**:
- `earliest_slot`: 最も早い日時を優先
- `highest_score`: 最も多くの参加者が集まるSlotを優先

---

## Examples of Rule Expressions

### Example 1: シンプルな多数決
**入力**: "5人招待して、3人以上OKなら開催"

**出力**:
```json
{
  "attendance_rule": {
    "type": "K_OF_N",
    "rule": { "k": 3, "n": 5 }
  },
  "confidence": 0.95
}
```

---

### Example 2: 必須メンバー指定
**入力**: "山田さんと佐藤さんは必須、あと2人以上"

**出力**:
```json
{
  "attendance_rule": {
    "type": "REQUIRED_PLUS_QUORUM",
    "rule": {
      "required_invitee_keys": ["u:yamada_id", "u:sato_id"],
      "min_additional": 2
    }
  },
  "confidence": 0.9
}
```

---

### Example 3: 複数グループ
**入力**: "営業部から2人 または 開発部から3人"

**出力**:
```json
{
  "attendance_rule": {
    "type": "GROUP_ANY",
    "rule": {
      "groups": [
        {
          "name": "営業部",
          "min": 2,
          "any_of_invitee_keys": ["u:sales1", "u:sales2", "u:sales3"]
        },
        {
          "name": "開発部",
          "min": 3,
          "any_of_invitee_keys": ["u:dev1", "u:dev2", "u:dev3", "u:dev4"]
        }
      ]
    }
  },
  "confidence": 0.85
}
```

---

## Summary

このドキュメントは、自然言語の意図を `AttendanceRule` JSON に変換する際の仕様を確定したものです。

**Key Points**:
1. **5つのルールタイプ**: ALL, ANY, K_OF_N, REQUIRED_PLUS_QUORUM, GROUP_ANY
2. **InviteeKey統一**: `u:`, `e:`, `lm:` 形式で全招待者を統一管理
3. **Finalize Policy**: 自動確定の条件とタイミングを明確化
4. **曖昧性対応**: 不明点は `needs_clarification` で返す
5. **拡張性**: 将来的なルール追加に対応可能な構造

次のステップは、この変換ロジックを実装する AI パーサーの開発と、Phase B API (`/i/:token/respond`, `/api/threads/:id/status` など) への統合です。

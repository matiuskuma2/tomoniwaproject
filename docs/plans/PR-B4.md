# PR-B4 計画書：1対1（R0: 他人）TimeRex型 Open Slots

## 目的

「候補3つ」ではなく、主催者の空き枠（予定は見えない）を一定期間分"公開"し、相手が**好きな1枠を選んで確定できる**体験を実装する。

B-3の再提案2回上限を超えた場合の公式な誘導先にもする。

---

## ユーザー体験（R0: 他人）

### 主催者側（チャット）
- 「Aさんに、来週木曜以降の空いてる時間を出しておいて。都合いいの選んでもらって」
- AI：Open Slotsリンクを発行 → 「このリンクを送ってください」

### 相手側（招待ページ）
- カレンダー/時間枠一覧（予定は見えない）から1枠を選択
- 「この枠で確定」→ Thank you（Googleカレンダー追加＋成長導線）
- 確定後：主催者側に通知（既存の確定通知があればそれを利用）

---

## デフォルト条件

| 項目 | デフォルト値 | 備考 |
|------|-------------|------|
| 期間 | 翌営業日 09:00 〜 2週間後 | time_min / time_max |
| 曜日 | Mon–Fri | 平日のみ |
| 時間帯 | afternoon（午後優先） | 表示順のヒント |
| 所要時間 | 60分 | duration_minutes |
| 枠の粒度 | 30分刻み | slot_interval |
| 1日あたり公開上限 | 8枠 | 多すぎ防止 |
| 全体公開上限 | 40枠 | 2週間×平日の暴走防止 |

---

## PR分割

### PR-B4-DB（スキーマ）

**目的**：Open Slotsを「再生成できる」「再利用できる」「失効できる」形で保存する。

#### テーブル設計

**1. open_slots（公開設定）**
```sql
CREATE TABLE open_slots (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,           -- scheduling_threads への参照
  token TEXT UNIQUE NOT NULL,        -- 公開URL用トークン
  workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  
  -- 条件
  time_min TEXT NOT NULL,            -- ISO8601
  time_max TEXT NOT NULL,            -- ISO8601
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  prefer TEXT DEFAULT 'afternoon',   -- morning/afternoon/evening/any
  days_json TEXT DEFAULT '["mon","tue","wed","thu","fri"]',
  slot_interval_minutes INTEGER DEFAULT 30,
  
  -- メタ
  title TEXT,
  invitee_name TEXT,
  invitee_email TEXT,
  
  -- 状態
  status TEXT NOT NULL DEFAULT 'active',  -- active/expired/cancelled/completed
  constraints_json TEXT,             -- 将来拡張用
  
  -- タイムスタンプ
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  
  FOREIGN KEY (thread_id) REFERENCES scheduling_threads(id)
);

CREATE INDEX idx_open_slots_token ON open_slots(token);
CREATE INDEX idx_open_slots_status_expires ON open_slots(status, expires_at);
CREATE INDEX idx_open_slots_owner ON open_slots(owner_user_id);
```

**2. open_slot_items（公開枠の実体）**
```sql
CREATE TABLE open_slot_items (
  id TEXT PRIMARY KEY,
  open_slots_id TEXT NOT NULL,
  
  -- 枠の時間
  start_at TEXT NOT NULL,            -- ISO8601
  end_at TEXT NOT NULL,              -- ISO8601
  
  -- 状態
  status TEXT NOT NULL DEFAULT 'available',  -- available/selected/disabled
  selected_at TEXT,                  -- 選択された日時
  selected_by TEXT,                  -- 選択者情報（invitee_key等）
  
  created_at TEXT NOT NULL,
  
  FOREIGN KEY (open_slots_id) REFERENCES open_slots(id) ON DELETE CASCADE
);

CREATE INDEX idx_open_slot_items_open_slots_id ON open_slot_items(open_slots_id);
CREATE INDEX idx_open_slot_items_status ON open_slot_items(status);
```

**DoD**
- [ ] ローカルD1適用
- [ ] 本番D1適用
- [ ] index追加（status+expires_at, token）

---

### PR-B4-API（公開枠の作成＆取得）

**目的**：主催者が「期間＋条件」で公開枠を生成し、相手が一覧を取得・選択できる。

#### 新API

**1. POST /api/one-on-one/open-slots/prepare**
- 入力：
  ```typescript
  {
    invitee: { name: string; email?: string };
    title?: string;
    send_via?: 'share_link' | 'email';
    constraints?: {
      time_min?: string;      // ISO8601
      time_max?: string;      // ISO8601
      prefer?: 'morning' | 'afternoon' | 'evening' | 'any';
      days?: string[];        // ['mon','tue',...] 
      duration?: number;      // minutes
      slot_interval?: number; // minutes (default 30)
    };
  }
  ```
- 内部処理：
  1. 主催者freebusy取得
  2. slotGenerator.generateAvailableSlots() で空き枠生成
  3. open_slots + open_slot_items 保存
- 出力：
  ```typescript
  {
    success: boolean;
    open_slots_id: string;
    token: string;
    share_url: string;        // /open/:token
    slots_count: number;
    time_range: { min: string; max: string };
    message_for_chat: string;
  }
  ```

**2. GET /open/:token（公開ページ - HTML）**
- 新規 route: `apps/api/src/routes/openSlots.ts`
- 認証不要（public）
- 返す内容：
  - 枠一覧（日付ごと、時間帯ボタン）
  - 予定は見えない（空き枠のみ）
  - 選択済み枠はdisabled表示

**3. POST /open/:token/select**
- 入力：`{ slot_id: string; name?: string; email?: string }`
- 処理：
  1. open_slot_items.status を selected に更新
  2. scheduling_threads に selection 記録
  3. 他の枠を disabled に（オプション：1枠確定なら）
- 出力：`{ success: boolean; redirect_url: string }` → `/open/:token/thank-you`

**4. GET /open/:token/thank-you（サンキューページ - HTML）**
- Googleカレンダー追加ボタン
- 成長導線（アプリDL等）

**DoD**
- [ ] Open Slotsリンクを発行できる
- [ ] 公開ページで枠一覧が見える（予定は見えない）
- [ ] 1枠選択で確定（Thank youへ）
- [ ] 競合（二重選択）を排除（1枠先着）
- [ ] 失効チェック（expires_at）

---

### PR-B4-SSOT（intent_catalog）

**追加インテント**

```json
{
  "intent": "schedule.1on1.open_slots",
  "category": "schedule.1on1",
  "description": "主催者の空き枠を公開し、相手が好きな時間を選べるリンクを発行（TimeRex型）- Phase B-4",
  "side_effect": "write_local",
  "requires_confirmation": false,
  "topology": "1:1",
  "params_schema": {
    "invitee": {
      "type": "object",
      "required": true,
      "properties": {
        "name": { "type": "string", "required": true },
        "email": { "type": "string", "format": "email", "optional": true }
      }
    },
    "constraints": {
      "type": "object",
      "optional": true,
      "properties": {
        "time_min": { "type": "string", "format": "date-time", "optional": true },
        "time_max": { "type": "string", "format": "date-time", "optional": true },
        "prefer": { "type": "string", "enum": ["morning", "afternoon", "evening", "any"], "optional": true },
        "days": { "type": "array", "items": { "type": "string" }, "optional": true },
        "duration": { "type": "number", "optional": true }
      }
    },
    "title": { "type": "string", "optional": true, "default": "打ち合わせ" },
    "send_via": { "type": "string", "enum": ["share_link", "email"], "default": "share_link" }
  },
  "clarify_rules": {
    "invitee_name_missing": "誰との予定ですか？相手の名前を教えてください。",
    "time_range_too_narrow": "期間が短すぎます。もう少し広い期間を指定してください。",
    "calendar_unavailable": "カレンダー連携が使えません。Google連携状態を確認してください。",
    "no_available_slots": "指定条件で空きが見つかりませんでした。期間を広げるか、時間帯/曜日を変えてください。"
  },
  "outputs": {
    "share_url": "公開リンク（/open/:token）",
    "message_for_chat": "AI秘書がユーザーに返す文章",
    "open_slots_id": "作成されたOpen Slots ID",
    "token": "公開トークン",
    "slots_count": "生成された枠数"
  },
  "executor": "frontend:executors/oneOnOne.ts::executeOneOnOneOpenSlots",
  "api": "POST /api/one-on-one/open-slots/prepare",
  "examples": [
    "田中さんに来週の空いてる時間を見せて、好きなところ選んでもらって",
    "佐藤さんに2週間分の空き枠を共有して",
    "山田さんに空きカレンダーのリンクを送って"
  ],
  "ui_flow": {
    "open_page": "/open/:token - 空き枠一覧UI（TimeRex型）",
    "thank_you_page": "/open/:token/thank-you - 選択後（Googleカレンダー追加 + 成長導線）"
  },
  "notes": "Phase B-4: TimeRex型。相手が空き枠から好きな時間を選ぶ。B-3の3回目誘導先。"
}
```

**DoD**
- [ ] SSOTにparams_schema/例/clarify_rules/endpointが揃う

---

### PR-B4-FE（Frontend classifier/executor）

**classifier**
- トリガーワード：
  - 「空いてる時間を見せて」「空き枠を共有」「カレンダー形式」「TimeRexみたいに」
  - 「好きなところ選んで」「選んでもらって」
- intent: `schedule.1on1.open_slots`
- params：期間/prefer/duration/invitee

**executor**
- POST /api/one-on-one/open-slots/prepare
- message_for_chat：リンク＋送信用テンプレ文言

**DoD**
- [ ] fixed / candidates3 / freebusy / open_slots が自然言語で分岐
- [ ] 未入力はclarifyが出る

---

### PR-B4-E2E（fixture + Playwright）

**方針**：freebusy揺れはfixtureで吸収（B-2と同じ）

**fixture追加**
- POST /test/fixtures/open-slots-context
  - 決定論の枠一覧を作る
  - busy_pattern: standard / all_busy / all_free

**テストケース**
1. 公開枠ページが表示される
2. 1枠選択 → thank-you へ
3. 二重選択防止（2回目は失敗 or "埋まりました"）
4. 失効（expires_at）表示

**DoD**
- [ ] CI green（Smoke + Authenticated）
- [ ] フレークなし（未来日固定）

---

## B-3との接続点

B-3で `max_reached=true` の場合：
- 現状：「主催者にOpen Slotsを作ってもらってください」メッセージ
- 理想：その場でOpen Slotsを生成して誘導

→ B-4完了後に「B-3追補PR」として入れる（小PR）

---

## 実装順序

1. **PR-B4-DB**（テーブル/失効設計）
2. **PR-B4-API**（prepare + open page + select）
3. **PR-B4-E2E**（fixtureで決定論）
4. **PR-B4-SSOT**
5. **PR-B4-FE**

---

## 公開ページURL

**決定**: `/open/:token`

理由：
- inviteの既存UIと責務を分離
- 将来の拡張（N対N公開枠など）がしやすい
- URLから「公開枠選択」という意図が明確

---

## 関連ファイル

- DB: `migrations/XXXX_open_slots.sql`
- API: `apps/api/src/routes/openSlots.ts`（新規）
- API: `apps/api/src/routes/oneOnOne.ts`（prepare追加）
- SSOT: `docs/intent_catalog.json`
- Classifier: `frontend/src/core/chat/classifier/oneOnOne.ts`
- Executor: `frontend/src/core/chat/executors/oneOnOne.ts`
- E2E Fixture: `apps/api/src/routes/testFixtures.ts`
- E2E Test: `frontend/e2e/one-on-one.open-slots.spec.ts`

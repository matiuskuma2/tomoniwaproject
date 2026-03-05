# PR-B6 実装PRD：逆アベイラビリティ（Reverse Availability）

## ステータス: ✅ Phase 1 & Phase 2 実装完了

> **起案日**: 2026-02-23
> **PRD確定日**: 2026-03-05
> **Phase 1 完了日**: 2026-03-05
> **Phase 2 完了日**: 2026-03-05
> **起案者**: モギモギ（関屋紘之）
> **優先度**: Phase 1-2（1対1拡張）
> **見積り**: Phase 1: ~13h, Phase 2: ~9h
> **Phase 2 PRD**: [PR-B6-PHASE2-GUEST-OAUTH-FREEBUSY.md](./PR-B6-PHASE2-GUEST-OAUTH-FREEBUSY.md)

---

## 1. 課題（なぜこれが必要か）

### ビジネス文化上の問題

現在の1対1スケジューリングは、すべて**主催者が候補を提示 → 相手が選ぶ**という一方向フロー。

**目上の人（クライアント、上司、取引先の偉い人）** に対しては:

> 「こっちが予定開けてやってるのに、日程調整のリンク送りつけてくるやつ何なの？」

**「私の空いてる日から選んでください」は目下→目上では失礼になる**。

### あるべき体験

> 「お忙しいところ恐縮ですが、ご都合の良い日時を教えていただければ、
> こちらが合わせます」

---

## 2. ユーザーフロー（確定版）

### Phase 1: カレンダー認証なし（手動候補選択）★ 最初に実装

ゲストのGoogle OAuth認証は **後回し**。まずは「相手が手動で候補を選ぶ」ことで価値を出す。

#### 理由:
- ゲスト用OAuth = redirect_uri追加 + consent画面カスタム + token管理 → 重い
- 手動でも十分「ご都合伺い」の価値は出せる
- Phase 2でカレンダー自動取得を追加すれば差分実装で済む

### 2.1 主催者（誘う側 = 目下）のチャット

```
ユーザー: 「佐藤部長にご都合を伺って日程調整したい」

AI: 🙏 ご都合伺いモードで日程調整を開始します。
    佐藤部長 (sato@company.com) にご都合伺いのメールをお送りします。

    ━━━━━━━━━━━━━━━━━━━
    件名: 日程調整のお願い — ご都合の良い日時をお知らせください

    佐藤様

    お忙しいところ恐れ入ります。
    打ち合わせのお時間をいただきたく、
    ご都合の良い日時をお知らせいただけますでしょうか。

    ▶ こちらからご都合の良い日をお選びください
    [リンク]

    ※ 1分程度で完了します
    ━━━━━━━━━━━━━━━━━━━

    📧 送信しますか？
```

### 2.2 相手側（目上）の体験

リンクをクリックすると `/ra/:token` ページ:

```
Step 1: カレンダー表示（2週間分）
  → 日付ごとに時間帯ボタンを表示
  → 09:00〜18:00の間、1時間刻み
  → 「2〜3つ、ご都合の良い日時をお選びください」

  ☐ 3/10(月) 10:00〜11:00
  ☐ 3/10(月) 14:00〜15:00
  ☐ 3/11(火) 11:00〜12:00
  ...

Step 2: 候補選択 → 送信
  → 2〜3つ選んで「この候補を送る」
  → Thank you画面:
    「ご回答ありがとうございます。
     〇〇がご都合に合わせてお返事いたします。」

Step 3: （オプション）成長導線
  → 「Tomoniwaoで日程調整をもっと簡単に → サインアップ」
```

### 2.3 主催者に候補が届く

```
通知: 📬 佐藤部長からご都合の候補が届きました！

    1. 3/10(月) 10:00〜11:00
    2. 3/11(火) 15:00〜16:00
    3. 3/12(水) 10:00〜11:00

    どの日時で確定しますか？

ユーザー: 1番で
AI: ✅ 3/10(月) 10:00〜11:00 で確定しました。
    📅 Google Meet リンクとカレンダー招待を送信しました。
```

---

## 3. 技術設計

### 3.1 既存インフラの再利用マップ

| 既存パーツ | 再利用方法 | 新規or改修 |
|-----------|----------|-----------|
| `/i/:token` 招待ページパターン | → `/ra/:token` ゲストページに同じパターン | 新規ルート |
| `/open/:token` Open Slotsパターン | → 時間枠選択UIの参考 | 参考のみ |
| `openSlots.ts` のHTML生成 | → getHtmlHead, renderErrorPage 等のユーティリティ | コピー&改修 |
| `GoogleCalendarService` | → finalize時のMeet生成+Calendar登録 | そのまま使用 |
| `scheduling_threads` テーブル | → thread_kind='reverse_availability' で区別 | 改修不要 |
| `thread_invites` + `thread_selections` | → 逆方向だが同じ構造 | そのまま使用 |
| `threadsFinalize.ts` | → 確定→Meet→Calendar生成 | そのまま使用 |
| Inbox通知 | → 候補到着通知 | そのまま使用 |

### 3.2 DB マイグレーション (0093)

```sql
-- 0093_create_reverse_availability.sql

-- 逆アベイラビリティ（ご都合伺い）設定
CREATE TABLE IF NOT EXISTS reverse_availability (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  workspace_id TEXT NOT NULL,
  
  -- 主催者（依頼する側 = 目下）
  requester_user_id TEXT NOT NULL,
  
  -- 相手（都合を聞かれる側 = 目上）
  target_email TEXT NOT NULL,
  target_name TEXT,
  
  -- 条件
  time_min TEXT NOT NULL,           -- ISO8601: 選択範囲の開始
  time_max TEXT NOT NULL,           -- ISO8601: 選択範囲の終了
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  preferred_slots_count INTEGER NOT NULL DEFAULT 3,  -- 何候補選んでもらうか
  slot_interval_minutes INTEGER NOT NULL DEFAULT 60,  -- 枠の刻み幅
  
  -- メタ
  title TEXT DEFAULT '打ち合わせ',
  
  -- 状態
  -- pending → responded → finalized → expired
  status TEXT NOT NULL DEFAULT 'pending',
  
  responded_at TEXT,
  finalized_at TEXT,
  expires_at TEXT NOT NULL,         -- 72時間後
  
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 相手が選んだ候補日時
CREATE TABLE IF NOT EXISTS reverse_availability_responses (
  id TEXT PRIMARY KEY,
  reverse_availability_id TEXT NOT NULL 
    REFERENCES reverse_availability(id) ON DELETE CASCADE,
  slot_start TEXT NOT NULL,         -- ISO8601
  slot_end TEXT NOT NULL,           -- ISO8601
  label TEXT,                       -- 表示用ラベル
  rank INTEGER,                     -- 希望順位（1=最希望）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ra_token ON reverse_availability(token);
CREATE INDEX IF NOT EXISTS idx_ra_status ON reverse_availability(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_ra_thread ON reverse_availability(thread_id);
CREATE INDEX IF NOT EXISTS idx_ra_responses_ra_id ON reverse_availability_responses(reverse_availability_id);
```

### 3.3 API 設計

#### 3.3.1 POST /api/reverse-availability/prepare (認証必要)

主催者がチャットから起動。スレッド作成 + RA設定 + メール送信。

```typescript
// Request
{
  target: { name: string; email: string };
  title?: string;         // default: '打ち合わせ'
  duration_minutes?: number;  // default: 60
  time_range?: {
    time_min?: string;    // default: 翌営業日 09:00
    time_max?: string;    // default: 2週間後
  };
  preferred_slots_count?: number;  // default: 3
  send_email?: boolean;   // default: true
}

// Response
{
  success: true;
  thread_id: string;
  reverse_availability_id: string;
  token: string;
  share_url: string;       // /ra/:token
  expires_at: string;
  message_for_chat: string;
}
```

#### 3.3.2 GET /ra/:token (認証不要 = public)

ゲスト向けページ。時間枠一覧 → 2-3候補選択UI。

- 失効チェック (expires_at)
- status チェック (pending でなければエラー)
- 2週間分のカレンダーUIを表示
- 時間枠は `slot_interval_minutes` 刻み
- `time_min` 〜 `time_max` の範囲内
- 平日のみ (Mon-Fri)、09:00-18:00

#### 3.3.3 POST /ra/:token/respond (認証不要)

ゲストが候補を送信。

```typescript
// Request
{
  slots: Array<{
    start: string;   // ISO8601
    end: string;     // ISO8601
  }>;
  responder_name?: string;
}

// Response
{ success: true; slots_count: number }
```

- reverse_availability_responses に INSERT
- reverse_availability.status → 'responded'
- 主催者にInbox通知 + チャットメッセージ

#### 3.3.4 POST /api/reverse-availability/:id/finalize (認証必要)

主催者が候補の1つを選んで確定。

```typescript
// Request
{ slot_index: number }  // 0-based index

// Response
{
  success: true;
  thread_id: string;
  finalized_slot: { start: string; end: string };
  meet_url?: string;
  calendar_event_id?: string;
}
```

- 既存の `threadsFinalize` ロジックを再利用
- Google Meet + Calendar イベント作成
- 相手に確定通知メール送信

### 3.4 フロントエンド

#### Classifier: `classifier/reverseAvailability.ts`

```typescript
const REVERSE_KEYWORDS = [
  'ご都合', 'お伺い', '都合を聞', '都合に合わせ',
  '空いてる日に合わせ', '先方の予定', '相手の空き',
  '相手に合わせ', '目上', 'reverse',
  'ご都合伺い', '伺いモード',
];

// Classifier Chain position: 8 (between oneToMany and oneOnOne)
// Intent: 'schedule.1on1.reverse_availability'
// 条件: トリガーワード + 1名の相手
```

#### Executor: `executors/reverseAvailability.ts`

1. POST /api/reverse-availability/prepare を呼ぶ
2. share_url をチャットに表示
3. 確認フロー (pending.action) でメール送信前に確認

#### apiExecutor case 追加

```typescript
case 'schedule.1on1.reverse_availability':
  return executeReverseAvailability(intentResult);
```

#### Classifier Chain 順序

```
7. oneToMany        → 2名以上
8. reverseAvailability → ご都合伺いキーワード + 1名  ★NEW
9. oneOnOne          → 1名 (fixed/candidates/freebusy/open_slots)
```

### 3.5 ゲストページ (`/ra/:token`)

Open Slotsのパターンを踏襲:

```
/ra/:token          → 時間枠選択ページ
/ra/:token/respond  → 候補送信API
/ra/:token/thank-you → サンキューページ
```

UIレイアウト:
- ヘッダー: 「{主催者名}さんからのご都合伺い」
- サブ: 「打ち合わせ（約60分）のご都合の良い日時を2〜3つお選びください」
- カレンダーグリッド: 日付ごと × 時間帯ボタン
- 選択表示: 選択済みスロットのサマリー
- 送信ボタン: 「この候補を送る」
- 敬語トーン全体に

### 3.6 メールテンプレート

**依頼メール（主催者→相手）:**

```
件名: 日程調整のお願い — {主催者名}より

{相手名}様

いつもお世話になっております。
{主催者名}です。

{タイトル}のお時間をいただきたく、
ご都合の良い日時をお知らせいただけますと幸いです。

下記のリンクから、候補日を簡単にお選びいただけます（1分程度で完了します）。

▶ ご都合の良い日時を選ぶ
{share_url}

お忙しいところ恐れ入りますが、
何卒よろしくお願いいたします。

{主催者名}
```

**確定通知（→相手）:**

```
件名: 日程確定のお知らせ — {タイトル}

{相手名}様

ご都合をお知らせいただきありがとうございます。
以下の日時で確定いたしました。

📅 {確定日時}
🔗 Google Meet: {meet_url}

カレンダー招待をお送りしましたのでご確認ください。

当日はよろしくお願いいたします。

{主催者名}
```

---

## 4. 実装タスク分解（確定版）

| ID | タスク | ファイル | 見積り | 依存 |
|----|--------|---------|--------|------|
| B6-1 | DB マイグレーション (0093) | `db/migrations/0093_create_reverse_availability.sql` | 30m | - |
| B6-2 | API: prepare エンドポイント | `apps/api/src/routes/reverseAvailability.ts` | 1.5h | B6-1 |
| B6-3 | ゲストページ: /ra/:token (枠選択UI) | 同上 | 2h | B6-2 |
| B6-4 | API: respond エンドポイント | 同上 | 1h | B6-3 |
| B6-5 | API: finalize エンドポイント | 同上 | 1h | B6-4 |
| B6-6 | Classifier: reverseAvailability.ts | `frontend/src/core/chat/classifier/reverseAvailability.ts` | 1h | - |
| B6-7 | Executor: reverseAvailability.ts | `frontend/src/core/chat/executors/reverseAvailability.ts` | 1h | B6-2 |
| B6-8 | classifier/index.ts 統合 + types.ts + apiExecutor | 既存ファイル改修 | 30m | B6-6,7 |
| B6-9 | Inbox通知 (候補到着) | 既存通知インフラ利用 | 30m | B6-4 |
| B6-10 | Unit tests (classifier + executor) | `__tests__/` | 1.5h | B6-6,7 |
| B6-11 | 結合テスト + TypeScript check | - | 1h | 全体 |
| B6-12 | ドキュメント更新 + コミット | `docs/` | 30m | 全体 |
| **合計** | | | **~13h** | |

### 推奨実装順序

```
B6-1 (DB) → B6-2 (prepare API) → B6-6+B6-7 (FE classifier/executor)
  → B6-8 (統合) → B6-3 (ゲストUI) → B6-4 (respond API)
  → B6-5 (finalize) → B6-9 (通知) → B6-10+11 (テスト) → B6-12
```

**PRは3分割推奨:**
- **PR-B6-a**: DB + API(prepare) + FE(classifier/executor) — チャットから起動できる
- **PR-B6-b**: ゲストUI + respond + finalize — 相手が候補を出せる
- **PR-B6-c**: テスト + ドキュメント + 微調整

---

## 5. Phase 2: カレンダー自動取得（✅ 実装完了 2026-03-05）

ゲストのGoogle OAuth認証を追加:

- `/ra/:token` ページにカレンダー認証ステップを追加
- `calendar.freebusy` スコープ（最小権限、読み取り専用）
- 認証後、自動でfreebusyを取得して空き枠を表示
- 認証スキップも可能（手動選択にフォールバック）

**実装ファイル:**
- `db/migrations/0094_add_guest_oauth_for_reverse_availability.sql` — `guest_google_tokens` テーブル + RA カラム追加
- `apps/api/src/routes/raOAuth.ts` — OAuth start, callback, skip, FreeBusy filtering
- `apps/api/src/routes/reverseAvailability.ts` — ゲストページUI拡張
- `apps/api/src/routes/__tests__/raOAuth.test.ts` — 12テスト

**詳細PRD:** [PR-B6-PHASE2-GUEST-OAUTH-FREEBUSY.md](./PR-B6-PHASE2-GUEST-OAUTH-FREEBUSY.md)

---

## 6. 応用展開（将来）

| 展開 | 説明 | Phase |
|------|------|-------|
| 1対N | 複数名にRA送信、共通空きを自動検出 | Phase 2 |
| N対N | 両サイドにRA送信、全員の共通空き | Phase 3 |
| 定期設定 | 毎週の空き曜日を自動提案 | Phase 2 |
| 自動確定 | coworker/family は操作なしで確定 | Phase 2 |

---

## 7. セキュリティ・プライバシー

| 項目 | 対策 |
|------|------|
| Token | crypto.getRandomValues(32bytes), URL safe |
| 期限 | 72時間で自動失効 |
| 二重回答 | status='responded' で2回目をブロック |
| XSS | HTMLエスケープ、CSP設定 |
| CSRF | SameSite cookie + state パラメータ |

---

## 8. Definition of Done

- [ ] `schedule.1on1.reverse_availability` intent が正しく分類される
- [ ] POST /api/reverse-availability/prepare でスレッド+RA作成+メール送信
- [ ] /ra/:token で2週間分の時間枠選択UIが表示される
- [ ] 相手が2-3候補を選んで送信できる
- [ ] 主催者のInboxに候補到着通知が届く
- [ ] 主催者が番号選択で確定 → Meet + Calendar 自動生成
- [ ] 72時間で自動失効
- [ ] Unit tests pass, TypeScript clean
- [ ] SCHEDULING_COVERAGE_MATRIX.md, CURRENT_STATUS.md 更新

---

## 9. 既存モードとの比較

```
1対1モード一覧:
┌─────────────────────────┬─────────────────────────────────────────┐
│ モード                   │ 方向                                     │
├─────────────────────────┼─────────────────────────────────────────┤
│ Fixed                   │ 主催者 → 確定日時を通知                    │
│ Candidates3             │ 主催者の候補 → 相手が選ぶ                   │
│ FreeBusy                │ 主催者のカレンダー空き → 候補生成 → 相手選択  │
│ Open Slots              │ 主催者の空き枠公開 → 相手が選ぶ              │
│ ★ Reverse Availability  │ 相手が候補を出す → 主催者が合わせる          │
│   (Phase 1: 手動)       │ (ゲストが時間枠から2-3候補を手動選択)        │
│   (Phase 2: カレンダー)  │ (ゲストのカレンダーから自動空き取得)          │
└─────────────────────────┴─────────────────────────────────────────┘
```

---

*PRD確定版。B6-1 (DBマイグレーション) から着手可能。*

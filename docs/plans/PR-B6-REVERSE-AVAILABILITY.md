# PR-B6 計画書：逆アベイラビリティ（Reverse Availability）

## ステータス: 📋 計画段階（未着手）

> **起案日**: 2026-02-23
> **起案者**: モギモギ（関屋紘之）
> **優先度**: Phase 1-2（1対1拡張）
> **見積り**: 設計 2h + 実装 8-12h + テスト 4h

---

## 1. 課題（なぜこれが必要か）

### ビジネス文化上の問題

現在の1対1スケジューリングは、すべて**主催者が候補を提示 → 相手が選ぶ**という一方向フロー。

これは「同僚」「部下」「対等な関係」では問題ないが、
**目上の人（クライアント、上司、取引先の偉い人）** に対しては以下の問題がある:

> 「こっちが予定開けてやってるのに、日程調整のリンク送りつけてくるやつ何なの？」

つまり、**「私の空いてる日から選んでください」は目下→目上では失礼になる**。

### あるべき体験

目上の人を誘う場合:

> 「お忙しいところ恐縮ですが、ご都合の良い日時を教えていただければ、
> こちらが合わせます」

これをシステムで実現する = **「逆アベイラビリティ」** パターン。

---

## 2. コンセプト

### 名称案

- **Reverse Availability（逆アベイラビリティ）**
- 日本語: 「ご都合伺い」モード / 「お伺いモード」
- チャット表記: 🙏 ご都合伺い

### 一言で言うと

> **「相手のカレンダーから空きを取得 → 相手が候補を選んで返す → こちらが合わせる」**

既存の Open Slots が「主催者の空き → 相手が選ぶ」なら、
Reverse Availability は「相手の空き → 相手が候補を出す → 主催者が合わせる」。

### 既存モードとの関係

```
1対1モード一覧:
┌────────────────────────┬──────────────────────────────────────────┐
│ モード                  │ 方向                                      │
├────────────────────────┼──────────────────────────────────────────┤
│ Fixed                  │ 主催者 → 確定日時を通知                      │
│ Candidates3            │ 主催者の候補 → 相手が選ぶ                    │
│ FreeBusy               │ 主催者のカレンダー空き → 候補生成 → 相手が選ぶ │
│ Open Slots             │ 主催者の空き枠公開 → 相手が選ぶ              │
│ ★ Reverse Availability │ 相手のカレンダー空き → 相手が候補を出す →      │
│                        │ 主催者が合わせる                             │
└────────────────────────┴──────────────────────────────────────────┘
```

---

## 3. ユーザーフロー

### 3.1 主催者（誘う側 = 目下）のチャット

```
ユーザー: 「佐藤部長にご都合を伺って日程調整したい」
ユーザー: 「田中社長の空いてる日に合わせて面談を設定したい」
ユーザー: 「sato@company.com のご都合で打ち合わせしたい」

AI: 🙏 ご都合伺いモードで日程調整を開始します。
    佐藤部長 (sato@company.com) に以下のメールをお送りします:

    ━━━━━━━━━━━━━━━━━━━
    件名: 日程調整のお願い — ご都合の良い日時をお知らせください

    佐藤様

    お忙しいところ恐れ入ります。
    打ち合わせのお時間をいただきたく、
    ご都合の良い日時をお知らせいただけますでしょうか。

    ▶ こちらからご都合の良い日をお選びください
    [リンク]

    ※ カレンダー連携で簡単にお選びいただけます
    ※ 1分程度で完了します
    ━━━━━━━━━━━━━━━━━━━

    📧 送信しますか？
```

### 3.2 相手側（目上）の体験

相手がリンクをクリックすると:

```
Step 1: カレンダー認証（Google / Microsoft）
  → 「Tomoniwaoにカレンダーの空き状況の閲覧を許可しますか？」
  → 予定の中身は見せない。busy/free のみ取得。

Step 2: 空き時間の表示
  → 相手のカレンダーからfreebusyを取得
  → 空いている時間帯を一覧表示
  → 「以下の日時が空いているようです。
      候補を2〜3つお選びください:」
  
  ☐ 2/25(火) 10:00〜11:00
  ☐ 2/25(火) 14:00〜15:00
  ☐ 2/26(水) 11:00〜12:00
  ☐ 2/26(水) 15:00〜16:00
  ☐ 2/27(木) 10:00〜11:00
  ...

Step 3: 候補選択 → 送信
  → 相手が2〜3つ選んで「この候補を送る」
  → Thank you画面:
    「ご回答ありがとうございます。
     〇〇様がご都合に合わせてお返事いたします。」

Step 4: （オプション）カレンダー登録への誘導
  → 「Tomoniwaoで日程調整をもっと簡単に → サインアップ」
  → 成長導線（既存パターン）
```

### 3.3 主催者に候補が届く

```
AI: 📬 佐藤部長からご都合の候補が届きました！

    1. 2/25(火) 10:00〜11:00
    2. 2/26(水) 15:00〜16:00
    3. 2/27(木) 10:00〜11:00

    どの日時で確定しますか？
    （基本的にすべてご都合の良い日なので、
     どれを選んでも問題ありません）

ユーザー: 1番で
AI: ✅ 2/25(火) 10:00〜11:00 で確定しました。
    📅 Google Meet リンクとカレンダー招待を送信しました。
```

---

## 4. 技術設計（概要）

### 4.1 新規 Intent

```typescript
// classifier/types.ts に追加
| 'schedule.1on1.reverse_availability'  // PR-B6: 逆アベイラビリティ（ご都合伺い）
```

### 4.2 Classifier の検出キーワード

```typescript
const REVERSE_AVAILABILITY_KEYWORDS = [
  'ご都合',
  'お伺い',
  '都合を聞',
  '都合に合わせ',
  '空いてる日に合わせ',
  '先方の予定',
  '相手の空き',
  '相手に合わせ',
  '目上',
  'reverse',
];
```

### 4.3 API 設計

**新規エンドポイント（案）:**

```
POST /api/reverse-availability/prepare
  → スレッド作成 + 逆アベイラビリティリンク生成
  → Response: { thread_id, reverse_token, share_url }

GET /ra/:token
  → 相手向けページ（カレンダー認証 → 空き表示 → 候補選択）

POST /api/reverse-availability/:thread_id/respond
  → 相手が選んだ候補を保存
  → 主催者に通知

POST /api/reverse-availability/:thread_id/finalize
  → 主催者が1つ選んで確定 → Meet + Calendar
```

### 4.4 DB 追加（案）

```sql
-- 逆アベイラビリティ設定
CREATE TABLE reverse_availability (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES scheduling_threads(id),
  token TEXT UNIQUE NOT NULL,
  workspace_id TEXT NOT NULL,
  
  -- 主催者（依頼する側）
  requester_user_id TEXT NOT NULL,
  
  -- 相手（都合を聞かれる側）
  target_email TEXT NOT NULL,
  target_name TEXT,
  
  -- 条件
  time_min TEXT NOT NULL,            -- ISO8601: 検索開始日時
  time_max TEXT NOT NULL,            -- ISO8601: 検索終了日時
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  preferred_slots_count INTEGER DEFAULT 3, -- 相手に何候補選んでもらうか
  
  -- 相手のカレンダー認証
  target_calendar_provider TEXT,     -- google / microsoft
  target_calendar_token_encrypted TEXT, -- 暗号化して保存
  
  -- 状態
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending → calendar_connected → responded → finalized → expired
  
  responded_at TEXT,
  finalized_at TEXT,
  expires_at TEXT NOT NULL,
  
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 相手が選んだ候補
CREATE TABLE reverse_availability_responses (
  id TEXT PRIMARY KEY,
  reverse_availability_id TEXT NOT NULL 
    REFERENCES reverse_availability(id),
  slot_start TEXT NOT NULL,          -- ISO8601
  slot_end TEXT NOT NULL,            -- ISO8601
  rank INTEGER,                      -- 希望順位（1=最希望）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 4.5 フロントエンド（ゲストページ）

```
/ra/:token
├── CalendarAuthStep     — Google/Microsoft 認証
├── AvailabilityStep     — FreeBusy取得 → 空き一覧表示
├── SelectionStep        — 候補を2-3つ選択
├── ConfirmStep          — 確認 → 送信
└── ThankYouStep         — 完了 + 成長導線
```

### 4.6 Classifier Chain での位置

```
現在:
  7. oneToMany     → 2名以上で発動
  8. oneOnOne      → 1名（fixed/candidates3/freebusy/open_slots）

追加後:
  7. oneToMany     → 2名以上で発動
  8. reverseAvailability → 「ご都合伺い」キーワード + 1名
  9. oneOnOne      → 1名（従来4モード）
```

---

## 5. 応用展開（将来）

この「逆アベイラビリティ」パターンは1対1に限らず応用が効く:

### 5.1 1対N への展開

> 「チームの5人にそれぞれ都合の良い日を聞いて、全員合う日を見つけて」

- 各参加者にカレンダー認証リンクを送付
- 全員のfreebusyを収集
- 共通空きを自動検出
- 主催者に提示

### 5.2 N対N への展開

> 「A社の3人とうちの3人で、全員の空いてる日を見つけて」

- 両サイドにカレンダー認証を要求
- 6人分のfreebusyを集約
- 共通空きを提示

### 5.3 定期ミーティング設定

> 「毎週、佐藤部長の空いてる曜日に定例を入れたい」

- 週次でfreebusyを取得
- 最も安定して空いている曜日/時間帯を提案

### 5.4 「お伺い→自動確定」モード

- 相手のカレンダー認証が済んでいれば
  相手の操作なしで空き時間を取得 → 自動で候補生成 → 確定
  （coworker/family 向け、許諾設定が必要）

---

## 6. セキュリティ・プライバシー考慮

| 項目 | 対策 |
|------|------|
| カレンダーのスコープ | `freebusy` のみ（予定の中身は見ない） |
| トークン保存 | 暗号化 + 用途限定（1回の調整にのみ使用） |
| トークン失効 | 調整完了 or 期限切れで自動削除 |
| OAuth同意画面 | 「空き時間の確認のみ」を明示 |
| 相手への説明 | リンクページで何をするか事前説明 |
| GDPR/個人情報 | カレンダーデータはfreebusyのみ保持、本文は保存しない |

---

## 7. 実装タスク分解（概算）

| ID | タスク | 見積り | 依存 |
|----|--------|--------|------|
| B6-1 | PRD 詳細化 + UXフロー確定 | 1h | - |
| B6-2 | DB マイグレーション作成 | 1h | B6-1 |
| B6-3 | API: prepare + respond + finalize | 3h | B6-2 |
| B6-4 | ゲストページ（/ra/:token）UI | 4h | B6-3 |
| B6-5 | Google Calendar OAuth (freebusy scope) | 2h | B6-4 |
| B6-6 | Microsoft Calendar OAuth (freebusy scope) | 2h | B6-5 |
| B6-7 | Classifier + Executor (FE) | 2h | B6-3 |
| B6-8 | 通知（相手が候補を送った通知） | 1h | B6-3 |
| B6-9 | テスト（unit + E2E） | 3h | 全体 |
| B6-10 | ドキュメント更新 | 1h | 全体 |
| **合計** | | **~20h** | |

---

## 8. メール文面テンプレート（案）

### 8.1 依頼メール（主催者→相手）

```
件名: 日程調整のお願い — {主催者名}より

{相手名}様

いつもお世話になっております。
{主催者名}です。

{タイトル}のお時間をいただきたく、
ご都合の良い日時をお知らせいただけますと幸いです。

下記のリンクから、カレンダーの空き状況を基に
候補日を簡単にお選びいただけます（1分程度で完了します）。

▶ ご都合の良い日時を選ぶ
{share_url}

※ カレンダーの空き/埋まりのみ確認し、
  予定の内容は一切閲覧いたしません。

お忙しいところ恐れ入りますが、
何卒よろしくお願いいたします。

{主催者名}
```

### 8.2 候補到着通知（相手→主催者）

```
{相手名}様からご都合の候補が届きました:
1. {slot_1}
2. {slot_2}  
3. {slot_3}

チャットで番号を入力して確定してください。
```

---

## 9. Definition of Done

- [ ] classifier が「ご都合伺い」系キーワードで `schedule.1on1.reverse_availability` を返す
- [ ] /ra/:token ページでカレンダー認証 → freeBusy取得 → 候補選択ができる
- [ ] 相手の候補が主催者のチャットに届く
- [ ] 主催者が番号選択で確定 → Meet + Calendar 自動生成
- [ ] 72時間で自動失効
- [ ] TypeScript clean, unit test + E2E test pass
- [ ] SCHEDULING_COVERAGE_MATRIX.md, CURRENT_STATUS.md 更新

---

## 10. 関連ドキュメント

- [SCHEDULING_COVERAGE_MATRIX.md](../SCHEDULING_COVERAGE_MATRIX.md) — モード一覧への追記が必要
- [PR-B4: Open Slots](./PR-B4.md) — 逆方向の参考設計
- [SCHEDULING_RULES.md](../SCHEDULING_RULES.md) — ルール追記
- [CURRENT_STATUS.md](../CURRENT_STATUS.md) — ステータス更新

---

*計画段階のドキュメントです。実装着手前にPRD詳細化が必要です。*

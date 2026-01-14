# Frontend Architecture Document

## 概要

ToMoniWao フロントエンドは React + TypeScript + Tailwind CSS で構築された SPA です。  
主要な UI は3カラムレイアウトのチャットインターフェースで、日程調整を会話形式で行います。

**作成日**: 2026-01-13  
**最終更新**: 2026-01-13  
**バージョン**: 1.0.0

---

## 1. ディレクトリ構造

```
frontend/src/
├── App.tsx                 # ルーティング定義
├── main.tsx                # エントリーポイント
├── index.css               # グローバルスタイル
│
├── components/
│   ├── chat/               # チャット関連コンポーネント
│   │   ├── ChatLayout.tsx  # 563行 ⚠️ 巨大 - メインレイアウト
│   │   ├── ChatPane.tsx    # 460行 ⚠️ 巨大 - チャット入力/表示
│   │   ├── CardsPane.tsx   # 69行 - 右カラム（カード表示）
│   │   ├── ThreadsList.tsx # 92行 - 左カラム（スレッド一覧）
│   │   ├── NotificationBell.tsx # 118行 - 通知ベル
│   │   ├── SpeakButton.tsx # 83行 - 音声読み上げ
│   │   └── VoiceRecognitionButton.tsx # 176行 - 音声入力
│   │
│   ├── cards/              # カードコンポーネント
│   │   ├── CalendarTodayCard.tsx  # 78行
│   │   ├── CalendarWeekCard.tsx   # 80行
│   │   ├── FreeBusyCard.tsx       # 76行
│   │   ├── InvitesCard.tsx        # 104行
│   │   ├── MeetCard.tsx           # 62行
│   │   ├── SlotsCard.tsx          # 82行
│   │   └── ThreadStatusCard.tsx   # 92行
│   │
│   └── ErrorBoundary.tsx   # エラーバウンダリ
│
├── core/
│   ├── api/                # API クライアント
│   │   ├── client.ts       # 107行 - HTTP クライアント基盤
│   │   ├── index.ts        # 26行 - エクスポート集約
│   │   ├── threads.ts      # 236行 - スレッド API
│   │   ├── calendar.ts     # 72行 - カレンダー API
│   │   ├── contacts.ts     # 69行 - 連絡先 API
│   │   ├── inbox.ts        # 21行 - 受信箱 API
│   │   ├── lists.ts        # 79行 - リスト API
│   │   ├── pendingActions.ts # 141行 - 保留アクション API
│   │   ├── usersMe.ts      # 51行 - ユーザー設定 API
│   │   └── voice.ts        # 47行 - 音声 API
│   │
│   ├── auth/
│   │   └── index.ts        # 102行 - 認証管理
│   │
│   ├── chat/               # チャットロジック ⚠️ 最重要
│   │   ├── intentClassifier.ts  # 763行 ⚠️ 巨大 - インテント分類
│   │   └── apiExecutor.ts       # 2732行 ⚠️ 超巨大 - API 実行
│   │
│   └── models/
│       └── index.ts        # 317行 - 型定義
│
├── hooks/
│   ├── useSpeechRecognition.ts # 254行 - 音声認識
│   └── useSpeechSynthesis.ts   # 155行 - 音声合成
│
├── pages/
│   ├── ChatPage.tsx        # 11行 - /chat
│   ├── LoginPage.tsx       # 116行 - /
│   ├── SettingsPage.tsx    # 162行 - /settings ⚠️ ナビ導線なし
│   ├── BillingPage.tsx     # 198行 - /settings/billing
│   ├── ContactsPage.tsx    # 246行 - /contacts
│   ├── ListsPage.tsx       # 259行 - /lists
│   ├── DashboardPage.tsx   # 171行 - /dashboard-legacy
│   ├── ThreadCreatePage.tsx # 126行 - /threads/new
│   └── ThreadDetailPage.tsx # 491行 ⚠️ 巨大 - /threads/:id
│
└── utils/
    └── datetime.ts         # 266行 - 日時フォーマット
```

---

## 2. ルーティング一覧

| パス | コンポーネント | 認証 | 備考 |
|------|---------------|------|------|
| `/` | LoginPage | 不要 | Google OAuth |
| `/chat` | ChatPage → ChatLayout | 必須 | メイン画面 |
| `/chat/:threadId` | ChatPage → ChatLayout | 必須 | スレッド選択状態 |
| `/settings` | SettingsPage | 必須 | ⚠️ **導線なし** |
| `/settings/billing` | BillingPage | 必須 | 課金設定 |
| `/contacts` | ContactsPage | 必須 | ⚠️ **導線なし** |
| `/lists` | ListsPage | 必須 | ⚠️ **導線なし** |
| `/threads/new` | ThreadCreatePage | 必須 | ⚠️ **導線なし** |
| `/threads/:threadId` | ThreadDetailPage | 必須 | ⚠️ **導線なし** |
| `/dashboard-legacy` | DashboardPage | 必須 | 旧ダッシュボード |
| `/*` | リダイレクト | - | → `/chat` |

### ⚠️ ナビゲーション問題

**現状**: ChatLayout のヘッダーにログアウトと NotificationBell のみ存在  
**問題**: 以下のページへの導線がない
- `/settings` - タイムゾーン設定（P3-TZ で実装済み）
- `/contacts` - 連絡先管理
- `/lists` - リスト管理
- `/threads/new` - 新規スレッド作成
- `/threads/:id` - スレッド詳細

**推奨対応**: ヘッダーにドロップダウンメニューまたはサイドバーを追加

---

## 3. コンポーネント階層

```
App
└── ErrorBoundary
    └── BrowserRouter
        ├── LoginPage (/)
        └── ProtectedRoute
            ├── ChatPage (/chat, /chat/:threadId)
            │   └── ChatLayout
            │       ├── ThreadsList (左カラム)
            │       ├── ChatPane (中央カラム)
            │       │   ├── SpeakButton
            │       │   └── VoiceRecognitionButton
            │       └── CardsPane (右カラム)
            │           ├── ThreadStatusCard
            │           ├── SlotsCard
            │           ├── InvitesCard
            │           ├── CalendarTodayCard
            │           ├── CalendarWeekCard
            │           ├── FreeBusyCard
            │           └── MeetCard
            │
            ├── SettingsPage (/settings) ⚠️ 導線なし
            ├── BillingPage (/settings/billing)
            ├── ContactsPage (/contacts) ⚠️ 導線なし
            ├── ListsPage (/lists) ⚠️ 導線なし
            ├── ThreadCreatePage (/threads/new) ⚠️ 導線なし
            ├── ThreadDetailPage (/threads/:threadId) ⚠️ 導線なし
            └── DashboardPage (/dashboard-legacy)
```

---

## 4. 状態管理フロー

### 4.1 ChatLayout の状態（563行）

```typescript
// スレッド関連
const [status, setStatus] = useState<ThreadStatus_API | null>(null);
const [loading, setLoading] = useState(false);
const [mobileTab, setMobileTab] = useState<MobileTab>('threads');

// メッセージ履歴（localStorage 永続化）
const [messagesByThreadId, setMessagesByThreadId] = useState<Record<string, ChatMessage[]>>({});

// カレンダーデータ
const [calendarData, setCalendarData] = useState<CalendarData>({});

// 各種 Pending 状態（確認フロー用）
const [pendingAutoPropose, setPendingAutoPropose] = useState<PendingAutoPropose | null>(null);
const [pendingRemindByThreadId, setPendingRemindByThreadId] = useState<Record<string, PendingRemind | null>>({});
const [pendingNotifyByThreadId, setPendingNotifyByThreadId] = useState<Record<string, PendingNotify | null>>({});
const [pendingSplitByThreadId, setPendingSplitByThreadId] = useState<Record<string, PendingSplit | null>>({});
const [pendingAction, setPendingAction] = useState<PendingActionState | null>(null);
const [pendingRemindNeedResponseByThreadId, setPendingRemindNeedResponseByThreadId] = useState<Record<string, PendingRemindNeedResponse | null>>({});

// カウンター
const [additionalProposeCountByThreadId, setAdditionalProposeCountByThreadId] = useState<Record<string, number>>({});
const [remindCountByThreadId, setRemindCountByThreadId] = useState<Record<string, number>>({});
```

### 4.2 データフロー

```
[ユーザー入力]
      ↓
[ChatPane] → classifyIntent(input, context)
      ↓
[intentClassifier.ts] → IntentResult { intent, params }
      ↓
[ChatPane] → executeIntent(intent, context)
      ↓
[apiExecutor.ts] → ExecutionResult { success, message, data }
      ↓
[ChatLayout] ← handleExecutionResult(result)
      ↓
[状態更新] → 画面反映
```

---

## 5. 技術負債リスト

### 5.1 🔴 Critical（即時対応推奨）

| ID | 問題 | 影響 | 推奨対応 | 見積もり | 状態 |
|----|------|------|----------|----------|------|
| TD-001 | /settings 導線なし | タイムゾーン設定不可 | ヘッダーにメニュー追加 | 30分 | ✅ 完了 (dc9ce44) |
| TD-002 | apiExecutor.ts 2732→2283行 | 保守困難 | 機能別ファイル分割 | 2日 | 🔄 進行中 (ea849b0) |
| TD-003 | intentClassifier.ts 763行 | 保守困難 | インテント別ファイル分割 | 1日 | ⏳ 保留 |
| TD-004 | ChatLayout.tsx 637→2289行 | 状態管理複雑 | useReducer化 | 1日 | ✅ 完了 (9e905ab) |

### 5.2 🟡 Medium（計画的対応）

| ID | 問題 | 影響 | 推奨対応 | 見積もり | 状態 |
|----|------|------|----------|----------|------|
| TD-005 | ChatPane props 15個 | 可読性低下 | Context API 導入 | 2日 | ⏳ 保留 |
| TD-006 | ThreadDetailPage 491行 | 保守困難 | コンポーネント分割 | 1日 | ⏳ 保留 |
| TD-007 | 孤立ページ多数 | UX 低下 | 統一ナビゲーション | 1日 | ✅ 完了 (dc9ce44) |
| TD-008 | toLocaleString 直書き残存可能性 | TZ バグ | datetime.ts 統一 | 2時間 | ✅ 完了 (7adc7bd) |

### 5.3 🟢 Low（将来対応）

| ID | 問題 | 影響 | 推奨対応 | 見積もり |
|----|------|------|----------|----------|
| TD-009 | ユニットテストなし | 品質保証不足 | Vitest 導入 | 3日 |
| TD-010 | E2E テスト CI 未組込 | 回帰検知不足 | CI パイプライン | 1日 |
| TD-011 | 型定義分散 | 型安全性低下 | 型ファイル集約 | 4時間 |

---

## 6. リファクタリング計画

### Phase 1: 緊急対応（今週）
1. **TD-001**: /settings への導線追加（ヘッダーメニュー）
2. **TD-008**: toLocaleString 残存箇所の確認・修正

### Phase 2: 構造改善（来週）
1. **TD-002**: apiExecutor.ts の分割
   - `executors/calendar.ts` ✅ 完了 (215行)
   - `executors/list.ts` ✅ 完了 (261行)
   - `executors/types.ts` ✅ 完了 (162行)
   - `executors/thread.ts` ⏳ 保留
   - `executors/remind.ts` ⏳ 保留
   - `executors/pending.ts` ⏳ 保留

2. **TD-003**: intentClassifier.ts の分割
   - `classifiers/calendar.ts`
   - `classifiers/thread.ts`
   - `classifiers/confirm.ts`

### Phase 3: 状態管理改善（再来週）
1. **TD-004**: ChatLayout の useReducer 化 ✅ 完了
   - `useChatReducer.ts` 新規作成 (635行)
   - ChatLayout.tsx: 637行 → 289行 (54%削減)
   - 全 state を1オブジェクトに集約
   - 型安全な dispatch ベースの状態更新

2. **TD-005**: Context API 導入 (後回し)
   - useReducer 化により優先度低下

### Phase 4: テスト強化（月末）
1. **TD-009**: Vitest 導入・基本テスト作成
2. **TD-010**: E2E テスト CI 組込

---

## 7. チャットインテント一覧

### 7.1 カレンダー系
| インテント | トリガー | 実行関数 |
|-----------|---------|----------|
| schedule.today | 「今日の予定」 | executeCalendarToday |
| schedule.week | 「今週の予定」 | executeCalendarWeek |
| schedule.freebusy | 「空き時間」 | executeCalendarFreeBusy |

### 7.2 スレッド系
| インテント | トリガー | 実行関数 |
|-----------|---------|----------|
| thread.create | 「スレッド作成」 | executeThreadCreate |
| schedule.status.check | スレッド選択時 | executeStatusCheck |
| schedule.finalize | 「確定」 | executeFinalize |

### 7.3 招待系
| インテント | トリガー | 実行関数 |
|-----------|---------|----------|
| invite.prepare.emails | メールアドレス入力 | executeInvitePrepareEmails |
| invite.prepare.list | 「リストから招待」 | executeInvitePrepareList |
| schedule.invite.list | 「リスト全員に」 | executeInviteList |

### 7.4 リマインド系
| インテント | トリガー | 実行関数 |
|-----------|---------|----------|
| schedule.remind.pending | 「リマインド」 | executeRemindPending |
| schedule.remind.pending.confirm | 「はい」 | executeRemindConfirm |
| schedule.remind.pending.cancel | 「いいえ」 | executeRemindCancel |
| schedule.remind.need_response | 「再回答必要な人にリマインド」 | executeRemindNeedResponse |

### 7.5 確認フロー系
| インテント | トリガー | 実行関数 |
|-----------|---------|----------|
| pending.action.decide | 「送る/キャンセル/別スレッド」 | executePendingDecide |

### 7.6 リスト系
| インテント | トリガー | 実行関数 |
|-----------|---------|----------|
| list.create | 「リスト作成」 | executeListCreate |
| list.list | 「リスト一覧」 | executeListList |
| list.members | 「メンバー表示」 | executeListMembers |
| list.add_member | 「メンバー追加」 | executeListAddMember |

---

## 8. 将来の実装予定

### P3-TZ（タイムゾーン対応）✅ 実装済み
- ユーザータイムゾーン保存
- 表示側タイムゾーン対応
- スレッド基準タイムゾーン

### P2-D2（回答者だけ再通知）
- 見積もり: 1日
- intentClassifier / apiExecutor 拡張

### P2-E1（Slack/Chatwork 送達）
- 見積もり: 5日
- 送達チャネル拡張

### P3-A1（時間×場所×人 最適化）
- 見積もり: 10日+
- n対n 配置エンジン

---

## 9. 運用インシデント防止チェックリスト

### デプロイ前
- [ ] `npm run build` 成功確認
- [ ] TypeScript エラーなし
- [ ] toLocaleString 直書き禁止（datetime.ts 使用）
- [ ] 新規ルート追加時はナビゲーション導線も追加

### デプロイ後
- [ ] `/settings` アクセス確認（TZ 設定）
- [ ] メール通知の日時表示確認
- [ ] UI カード表示の日時確認
- [ ] モバイル表示確認

### 定期確認
- [ ] localStorage `tomoniwao_messages` サイズ確認
- [ ] エラーログ確認
- [ ] ユーザーフィードバック確認

---

## 10. 更新履歴

| 日付 | 内容 | 担当 |
|------|------|------|
| 2026-01-13 | TD-008 完了: toLocaleString 統一 (7adc7bd) | Claude |
| 2026-01-13 | TD-001/TD-007 完了: ナビゲーション追加 (dc9ce44) | Claude |
| 2026-01-13 | 初版作成 | Claude |

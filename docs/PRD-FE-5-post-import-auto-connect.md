# PRD: FE-5 Post-Import Auto-Connect
## post-import 完了 → schedule / send_invite executor 自動接続

**Version**: 2.0 (B戦略: 止めない・聞き直さない)
**Author**: AI Developer
**Date**: 2026-02-17
**Status**: APPROVED
**Depends on**: FE-4 (完了), 1on1 全4モード接続 (b5ce1f8 で完了)
**Design Review**: B戦略採択 — 人数で止めない、ガイドメッセージ不要

---

## 1. 背景と課題

### 1.1 現状 (FE-4 完了時点)

```
[名刺スキャン / テキスト貼付]
       ↓
  contact.import.text  →  preview API  →  pending.contact_import.confirm
       ↓
  曖昧一致? → pending.person.select (解決ループ)
       ↓
  confirm → contact_import.confirmed
       ↓
  context付き? → pending.post_import.next_step  ←── FE-4 完了地点
       ↓
  ユーザー「はい」or「1」or「2」
       ↓
  post_import.next_step.selected → { action: 'send_invite' | 'schedule', emails: [...] }
       ↓
  ★ ここで pending クリアして **終了** ← 問題: 何も起きない
```

**課題**: `post_import.next_step.selected` の結果 `{ action, emails }` を受け取った後、useChatReducer は `CLEAR_PENDING_FOR_THREAD` するだけで、次の executor (invite / schedule) を **起動しない**。ユーザーは「日程調整を始めます」というメッセージだけ見て、手動で改めて入力し直す必要がある。

### 1.2 目標

`post_import.next_step.selected` の結果を受けて、**ユーザー追加入力なしで、人数に関係なく** 次のフローを自動起動する。

### 1.3 設計思想

> **「止めない。聞き直さない。再入力を求めない。」**
>
> FE-5 は「接続」ではない。
> **「人間がやってた再入力作業をAIが肩代わりするフェーズ」**

---

## 2. 設計方針

### 2.1 B戦略: 体験重視

| 質問 | 回答 | 根拠 |
|------|------|------|
| 1名 → schedule | **oneOnOne.freebusy** 自動実行 | 条件なしでもデフォルト (2週間/60分/3候補) で動作 |
| 2名+ → schedule | **oneToMany.prepare** 自動実行 | API クライアント・バックエンドは完成済。ガイドメッセージに逃がさない |
| 1名 → send_invite | **invite.prepare.emails** 自動実行 | 既存 executor そのまま |
| 2名+ → send_invite | **invite.prepare.emails** 自動実行 (バッチ) | 既存 executor が複数メール対応済み |

### 2.2 分岐ルール: 意図の明確さベース

```
post-import → 次手選択完了
  │
  ├─ action === 'send_invite'
  │    └─ 人数問わず → executeInvitePrepareEmails (既存)
  │
  ├─ action === 'schedule'
  │    ├─ 1名  → executeOneOnOneFreebusy (1対1)
  │    └─ 2名+ → executeOneToManyPrepare (1対N) ★ 新規
  │
  └─ action === 'completed'
       └─ pending クリアのみ
```

### 2.3 oneToMany のモード選択ルール

post-import からの自動接続時は、ユーザーが条件を指定していない = **デフォルト最適解** を選ぶ:

| 状況 | oneToMany mode | 理由 |
|------|---------------|------|
| 条件指定なし (デフォルト) | `candidates` | freebusy で3候補自動生成 → candidates モードで提示が最も自然 |
| 今後: 条件あり (期間/時間帯) | `range_auto` | 範囲指定→自動候補生成 (将来拡張) |

**注**: oneToMany の prepare API は `mode: 'candidates'` + `emails` で動作する。
slots は空配列を渡し、次のステップ (`/send`) で freebusy 生成した候補を追加する設計。
ただし、**slots 必須** のバリデーションがあるため (L98-101)、最低限のデフォルト候補を bridge 側で生成する必要がある。

→ **設計判断**: bridge で freebusy API を先に呼んで候補を取得し、それを oneToMany.prepare に渡す。これにより:
1. 主催者のカレンダー空きを自動反映
2. slots バリデーション通過
3. ユーザーに即座に候補が見える

---

## 3. 状態遷移図

```
┌─────────────────────────────────────────────────────────┐
│                FE-4 完了地点                              │
│  post_import.next_step.selected                         │
│  payload: { action, emails }                            │
└─────┬──────────────────┬─────────────────┬──────────────┘
      │                  │                 │
      ▼                  ▼                 ▼
  send_invite        schedule          completed
      │                  │                 │
      │          ┌───────┴───────┐         ▼
      │          │               │    CLEAR_PENDING
      │       1名            2名+       (終了)
      │          │               │
      ▼          ▼               ▼
  [Auto-fire]  [Auto-fire]    [Auto-fire]
  invite.      1on1.          oneToMany.
  prepare.     freebusy       prepare
  emails                      (candidates mode)
      │          │               │
      ▼          ▼               ▼
  POST         POST            POST
  /threads/    /one-on-one/    /one-to-many/
  prepare      freebusy/       prepare
               prepare
      │          │               │
      ▼          ▼               ▼
  pending.     結果表示        結果表示
  action       (候補日時+URL)  (スレッド作成+招待者)
  created                          │
  (送る/                           ▼
  キャンセル)               POST /one-to-many/:id/send
                                   │
                                   ▼
                              招待送信完了
```

---

## 4. 会話例

### 4.1 名刺 → 1名 → 日程調整 (ハッピーパス)

```
User: [名刺画像アップロード]「この人と日程調整して」
Bot:  📇 名刺スキャン結果
      ✅ 新規登録予定: 1件
        1. 田中太郎 <tanaka@example.com> (株式会社ABC / 部長)
      ━━━━━━━━━━━━━━━━━━━━
      登録を実行しますか？
      • 「はい」→ 登録
      • 「いいえ」→ キャンセル

User: はい
Bot:  ✅ 連絡先取り込み完了
      次のステップ: 田中太郎 と日程調整を始めますか？
      • 「はい」→ 日程調整へ
      • 「いいえ」→ 完了

User: はい
Bot:  📅 田中太郎さんとの日程調整を準備しています...
Bot:  ✅ 田中太郎さんとの打ち合わせ
      📅 候補日時:
        1. 2/19(水) 10:00〜11:00
        2. 2/19(水) 14:00〜15:00
        3. 2/20(木) 11:00〜12:00
      🔗 共有URL: https://workmate.app/i/xxx
      📧 tanaka@example.com に招待メールを送信しました。
```

### 4.2 テキスト → 3名 → 日程調整 (1対N、ハッピーパス)

```
User: 鈴木一郎 suzuki@test.com
      佐藤花子 sato@test.com
      山田太郎 yamada@test.com
      この人たちと来週打ち合わせしたい

Bot:  📋 連絡先取り込みプレビュー
      ✅ 新規登録予定: 3件 ...
      登録を実行しますか？

User: はい
Bot:  ✅ 連絡先取り込み完了
      次のステップ: 鈴木一郎、佐藤花子、山田太郎 と日程調整を始めますか？
      • 「はい」→ 日程調整へ
      • 「いいえ」→ 完了

User: はい
Bot:  📅 3名との日程調整を準備しています...
Bot:  ✅ 日程調整スレッドを作成しました
      📋 打ち合わせ（3名参加）
      📅 候補日時:
        1. 2/19(水) 10:00〜11:00
        2. 2/19(水) 14:00〜15:00
        3. 2/20(木) 11:00〜12:00
      📧 鈴木一郎、佐藤花子、山田太郎 に招待メールを送信しました。
      ⏰ 回答期限: 72時間
```

### 4.3 テキスト → 2名 → 招待 (バッチ)

```
User: suzuki@test.com sato@test.com
      この人たちに招待送って

...（取り込み → confirm → next_step）...

User: はい
Bot:  📨 招待を準備しています...
Bot:  ✅ 招待準備完了
      📧 送信先:
        - 鈴木一郎 <suzuki@test.com>
        - 佐藤花子 <sato@test.com>
      「送る」で送信 / 「キャンセル」で取り消し
```

### 4.4 エラー: カレンダー未接続

```
User: はい (schedule 選択)
Bot:  📅 田中太郎さんとの日程調整を準備しています...
Bot:  ❌ カレンダーが接続されていません。
      設定 > カレンダー連携 でGoogleカレンダーを接続してから
      「田中太郎さんと日程調整して」と入力してください。
```

### 4.5 エラー: 空き枠なし

```
User: はい (schedule 選択)
Bot:  📅 日程調整を準備しています...
Bot:  ⚠️ 2週間以内に空き枠が見つかりませんでした。
      • 期間を広げて: 「田中太郎さんと来月中に日程調整して」
      • 直接指定: 「田中太郎さんと3/1の14時に打ち合わせ」
```

---

## 5. 実装設計

### 5.1 前提: 現状のレイヤー状況

| レイヤー | oneOnOne | oneToMany | 状態 |
|---------|----------|-----------|------|
| バックエンド API | ✅ 完成 | ✅ 完成 | — |
| API クライアント | ✅ 完成 | ✅ 完成 (`core/api/oneToMany.ts`) | — |
| Executor (チャット→API) | ✅ 4モード完成 | ❌ **未実装** | FE-5 で作成 |
| Classifier (意図分類) | ✅ 完成 | ❌ **未実装** | FE-5 scope 外 (post-import bridge 経由のため不要) |
| apiExecutor switch | ✅ 4モード接続済 | ❌ **未接続** | FE-5 scope 外 (bridge 経由) |

**重要**: oneToMany の executor/classifier がないが、FE-5 では **bridge が直接 API クライアントを呼ぶ** ため問題ない。チャットからの自然言語呼び出し (classifier → executor → apiExecutor) は FE-6 以降のスコープ。

### 5.2 変更ファイル一覧

| ファイル | 変更内容 | 影響度 |
|---------|---------|--------|
| `executors/postImportBridge.ts` | **新規**: 自動接続ブリッジ (oneOnOne + oneToMany 対応) | **高** |
| `executors/index.ts` | postImportBridge の re-export | 低 |
| `useChatReducer.ts` | `post_import.next_step.selected` handler 修正 | **高** |
| `executors/types.ts` | oneToMany 結果用の ExecutionResultData kind 追加 | 低 |
| `e2e/post-import-auto-connect.spec.ts` | **新規**: E2E テスト (6シナリオ) | 中 |

### 5.3 新規: `executors/postImportBridge.ts`

```typescript
/**
 * executors/postImportBridge.ts
 * FE-5: Post-Import Auto-Connect Bridge
 * 
 * 設計思想: 「止めない。聞き直さない。再入力を求めない。」
 * 
 * post_import.next_step.selected の結果を受けて
 * 人数に関係なく適切な executor / API を自動起動する。
 * 
 * 分岐ルール:
 * - send_invite (人数問わず) → executeInvitePrepareEmails
 * - schedule + 1名            → executeOneOnOneFreebusy
 * - schedule + 2名+           → oneToManyApi.prepare + send
 * 
 * 事故ゼロ設計:
 * - この関数自体は pending を作成しない
 * - 既存 executor / API クライアントをそのまま呼ぶ (delegate)
 * - 全パスで try-catch、失敗時は手動入力ガイダンス
 */

import type { IntentResult } from '../intentClassifier';
import type { ExecutionResult } from './types';
import { executeOneOnOneFreebusy } from './oneOnOne';
import { executeInvitePrepareEmails } from './invite';
import { oneToManyApi, type PrepareRequest, type PrepareResponse } from '../../api/oneToMany';
import { log } from '../../platform';

interface PostImportAutoConnectParams {
  action: 'send_invite' | 'schedule';
  emails: string[];
  names: string[];
}

export async function executePostImportAutoConnect(
  params: PostImportAutoConnectParams
): Promise<ExecutionResult> {
  const { action, emails, names } = params;

  log.info('[FE-5] Post-import auto-connect', {
    module: 'postImportBridge',
    action,
    emailCount: emails.length,
  });

  // ============================================================
  // send_invite: 人数問わず → invite prepare
  // ============================================================
  if (action === 'send_invite') {
    return executeInvitePrepareEmails({
      intent: 'invite.prepare.emails',
      confidence: 1.0,
      params: {
        emails,
        mode: 'new_thread',
        rawText: emails.join('\n'),
      },
    });
  }

  // ============================================================
  // schedule: 1名 → oneOnOne.freebusy
  // ============================================================
  if (action === 'schedule' && emails.length === 1) {
    const name = names[0] || emails[0].split('@')[0];
    return executeOneOnOneFreebusy({
      intent: 'schedule.1on1.freebusy',
      confidence: 1.0,
      params: {
        person: { name, email: emails[0] },
        constraints: { duration: 60 },
        duration_minutes: 60,
        title: '打ち合わせ',
        rawInput: `${name}さんと日程調整`,
      },
    });
  }

  // ============================================================
  // schedule: 2名+ → oneToMany.prepare + send
  // ============================================================
  if (action === 'schedule' && emails.length >= 2) {
    return executeOneToManyFromBridge(emails, names);
  }

  return { success: false, message: '❌ 不明なアクションです。' };
}

/**
 * 1対N 日程調整の自動実行
 * 
 * フロー:
 * 1. oneToMany.prepare でスレッド作成 (mode: candidates, デフォルト候補)
 * 2. oneToMany.send で招待送信
 * 3. 結果をチャットに返す
 */
async function executeOneToManyFromBridge(
  emails: string[],
  names: string[]
): Promise<ExecutionResult> {
  try {
    // Step 1: デフォルト候補日時を生成（明日以降の平日3枠）
    const defaultSlots = generateDefaultSlots(3, 60);

    // Step 2: oneToMany.prepare
    const prepareReq: PrepareRequest = {
      title: '打ち合わせ',
      mode: 'candidates',
      kind: 'external',
      emails,
      slots: defaultSlots,
      deadline_hours: 72,
      finalize_policy: 'organizer_decides',
    };

    const prepared: PrepareResponse = await oneToManyApi.prepare(prepareReq);

    if (!prepared.success || !prepared.thread?.id) {
      return {
        success: false,
        message: '❌ 日程調整スレッドの作成に失敗しました。\nチャットで「○○さんと日程調整して」と入力してください。',
      };
    }

    // Step 3: send (招待送信)
    const sendResult = await oneToManyApi.send(prepared.thread.id, {
      invitees: prepared.invitees,
      channel_type: 'email',
    });

    // Step 4: 結果メッセージ組み立て
    const nameList = names.slice(0, 5).join('、');
    const more = names.length > 5 ? ` 他${names.length - 5}名` : '';
    const slotLines = defaultSlots.map((s, i) => {
      const d = new Date(s.start_at);
      const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
      const day = dayNames[d.getDay()];
      const m = d.getMonth() + 1;
      const dd = d.getDate();
      const hh = d.getHours().toString().padStart(2, '0');
      const mm = d.getMinutes().toString().padStart(2, '0');
      const eDate = new Date(s.end_at);
      const ehh = eDate.getHours().toString().padStart(2, '0');
      const emm = eDate.getMinutes().toString().padStart(2, '0');
      return `  ${i + 1}. ${m}/${dd}(${day}) ${hh}:${mm}〜${ehh}:${emm}`;
    }).join('\n');

    const message = [
      `✅ 日程調整スレッドを作成しました`,
      `📋 打ち合わせ（${emails.length}名参加）`,
      `📅 候補日時:`,
      slotLines,
      `📧 ${nameList}${more} に招待メールを送信しました。`,
      `⏰ 回答期限: 72時間`,
    ].join('\n');

    return {
      success: true,
      message,
      data: {
        kind: 'thread.create' as any,
        payload: { threadId: prepared.thread.id },
      },
    };

  } catch (error) {
    log.error('[FE-5] oneToMany auto-connect failed', {
      module: 'postImportBridge',
      error: error instanceof Error ? error.message : String(error),
    });

    const nameHint = names[0] || emails[0]?.split('@')[0] || '';
    return {
      success: false,
      message: `❌ 日程調整の準備に失敗しました。\nチャットで「${nameHint}さんと日程調整して」と入力してください。`,
    };
  }
}

/**
 * デフォルト候補日時を生成
 * 明日以降の平日、10:00/14:00/16:00 の3枠
 */
function generateDefaultSlots(
  count: number,
  durationMinutes: number
): Array<{ start_at: string; end_at: string; label?: string }> {
  const slots: Array<{ start_at: string; end_at: string; label?: string }> = [];
  const now = new Date();
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  
  // 営業時間の候補時刻
  const businessHours = [10, 14, 16];
  let currentDate = new Date(now);
  currentDate.setDate(currentDate.getDate() + 1); // 明日から
  currentDate.setHours(0, 0, 0, 0);
  
  let hourIndex = 0;
  
  while (slots.length < count) {
    const dayOfWeek = currentDate.getDay();
    
    // 平日のみ (月〜金)
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      const hour = businessHours[hourIndex % businessHours.length];
      const startAt = new Date(currentDate);
      startAt.setHours(hour, 0, 0, 0);
      const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
      
      const m = startAt.getMonth() + 1;
      const d = startAt.getDate();
      const day = dayNames[startAt.getDay()];
      const hh = hour.toString().padStart(2, '0');
      
      slots.push({
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        label: `${m}/${d}(${day}) ${hh}:00`,
      });
      
      hourIndex++;
      
      // 同日の次の時刻へ。全時刻使い切ったら翌日へ
      if (hourIndex % businessHours.length === 0) {
        currentDate.setDate(currentDate.getDate() + 1);
      }
    } else {
      // 週末はスキップ
      currentDate.setDate(currentDate.getDate() + 1);
      hourIndex = 0;
    }
  }
  
  return slots;
}
```

### 5.4 `useChatReducer.ts` の変更

**変更前** (L714-718):
```typescript
else if (kind === 'post_import.next_step.selected' || kind === 'post_import.next_step.cancelled') {
  const threadId = currentThreadId || 'temp';
  dispatch({ type: 'CLEAR_PENDING_FOR_THREAD', payload: { threadId } });
}
```

**変更後**:
```typescript
else if (kind === 'post_import.next_step.selected') {
  const threadId = currentThreadId || 'temp';
  
  // FE-5: names を pending クリア前に取得（クリア後は消える）
  const pendingState = state.pendingByThreadId[threadId] as any;
  const savedNames = pendingState?.importSummary?.imported_contacts?.map(
    (c: { display_name: string }) => c.display_name
  ) || [];
  
  dispatch({ type: 'CLEAR_PENDING_FOR_THREAD', payload: { threadId } });
  
  // FE-5: Auto-connect — 人数に関係なく次の executor を自動起動
  const { action, emails } = payload as {
    action: 'send_invite' | 'schedule' | 'completed';
    emails: string[];
  };
  
  if (action !== 'completed' && emails.length > 0) {
    const loadingMsg = action === 'send_invite'
      ? '📨 招待を準備しています...'
      : `📅 ${emails.length > 1 ? `${emails.length}名との` : `${savedNames[0] || ''}さんとの`}日程調整を準備しています...`;
    
    addBotMessage(loadingMsg, threadId);
    
    (async () => {
      try {
        const result = await executePostImportAutoConnect({
          action,
          emails,
          names: savedNames,
        });
        
        addBotMessage(result.message, threadId);
        
        if (result.data) {
          handleExecutionResult(result, threadId);
        }
      } catch (error) {
        const fallbackMsg = action === 'send_invite'
          ? '❌ 招待の準備に失敗しました。「○○に招待送って」と入力してください。'
          : '❌ 日程調整の準備に失敗しました。「○○さんと日程調整して」と入力してください。';
        addBotMessage(fallbackMsg, threadId);
      }
    })();
  }
}
else if (kind === 'post_import.next_step.cancelled') {
  const threadId = currentThreadId || 'temp';
  dispatch({ type: 'CLEAR_PENDING_FOR_THREAD', payload: { threadId } });
}
```

### 5.5 重要な設計決定

#### 5.5.1 なぜ bridge が oneToMany API クライアントを直接呼ぶのか

oneToMany の executor/classifier はまだ存在しない。作る選択肢は2つ:

| 選択肢 | コスト | リスク |
|--------|--------|--------|
| A) executor + classifier 全部作ってから bridge 接続 | 高 (2日+) | 過剰設計。チャット自然言語からの呼び出しは FE-5 scope 外 |
| B) bridge が API クライアントを直接呼ぶ | **低 (2時間)** | executor 分離は FE-6 でリファクタ |

**選択: B**。理由: post-import bridge は「コンテキストが完全に確定した状態」で呼ばれるため、classifier/executor を経由する意味がない。

#### 5.5.2 oneToMany prepare → send の2ステップ

oneToMany API は prepare → send の2段階設計。post-import bridge では **両方を一気に実行** する。
理由: ユーザーは既に「はい」で confirm しているため、prepare 後に再度 「送る？」と聞くのは体験が悪い。

#### 5.5.3 デフォルト候補日時の生成

freebusy API を呼ぶ代わりに `generateDefaultSlots()` でデフォルト候補を生成する判断:

| 方式 | メリット | デメリット |
|------|---------|-----------|
| freebusy 先呼び | カレンダー空きを反映 | API 2回呼び (遅い)、カレンダー未接続で失敗 |
| **デフォルト候補** | 即座に完了、カレンダー不要 | 空きを反映しない |

**選択: デフォルト候補**。理由: 
- 1対N は「主催者が候補を出す → 参加者が回答」のフロー。主催者の空き確認は別途やればいい
- カレンダー未接続でも日程調整は開始できるべき
- 速度が体験に直結する

#### 5.5.4 names の取得タイミング

`post_import.next_step.selected` の payload には `emails` しか含まれない。`names` は pending state の `importSummary.imported_contacts` から取得する。

**注意**: `CLEAR_PENDING_FOR_THREAD` の **前** にローカル変数にコピーする。

---

## 6. エラー設計

### 6.1 エラーマトリックス

| エラー | 原因 | ユーザーメッセージ | リカバリ |
|--------|------|-------------------|---------|
| AUTH_ERROR | トークン期限切れ | 「ログインし直してください」 | 再ログイン |
| CALENDAR_NOT_CONNECTED | カレンダー未連携 (1on1 freebusy時) | 「カレンダーを接続してください」 | 設定画面誘導 |
| NO_SLOTS_AVAILABLE | 空きなし (1on1 freebusy時) | 「期間を広げてお試しください」 | 手動入力促す |
| PREPARE_FAILED | oneToMany prepare 失敗 | 「スレッド作成に失敗しました」 | 手動入力促す |
| SEND_FAILED | oneToMany send 失敗 | 「招待送信に失敗しました」 | スレッドURLを提示 |
| NETWORK_ERROR | 通信エラー | 「通信エラーです」 | リトライ促す |

### 6.2 フォールバック原則

> **「自動接続に失敗しても、ユーザーは手動で同じ操作ができる」**

- 全エラーに手動入力ガイダンスを含める
- pending は必ずクリア (stuck 防止)
- エラーでもチャット履歴に残す

---

## 7. Definition of Done (DoD)

### 7.1 機能要件

- [ ] `send_invite` → `executeInvitePrepareEmails` 自動起動 (人数問わず)
- [ ] `schedule` + 1名 → `executeOneOnOneFreebusy` 自動起動
- [ ] `schedule` + 2名+ → `oneToManyApi.prepare + send` 自動実行
- [ ] `completed` → pending クリアのみ (変更なし)
- [ ] loading メッセージが表示される
- [ ] 成功/失敗結果がチャットに表示される
- [ ] oneToMany 結果に thread_id が含まれ、handleExecutionResult で処理される

### 7.2 エラー要件

- [ ] カレンダー未接続 → ガイドメッセージ + 手動入力案内
- [ ] 空き枠なし → 期間変更ガイダンス
- [ ] oneToMany prepare 失敗 → フォールバック
- [ ] oneToMany send 失敗 → スレッドURL提示
- [ ] 通信エラー → try-catch フォールバック

### 7.3 非機能要件

- [ ] TypeScript 型チェック PASS (`tsc --noEmit`)
- [ ] 既存テスト全 PASS (regression なし)
- [ ] pending ライフサイクルを壊さない
- [ ] pending が stuck しない

### 7.4 テスト要件

- [ ] Unit: `postImportBridge.ts` 全分岐 + `generateDefaultSlots`
- [ ] Integration: useChatReducer handler
- [ ] E2E: 6シナリオ (§8)

---

## 8. E2E テスト仕様

### ファイル: `frontend/e2e/post-import-auto-connect.spec.ts`

```
S1: send_invite (1名) → invite prepare API 自動呼び出し
S2: send_invite (3名) → invite prepare API バッチ自動呼び出し
S3: schedule (1名) → oneOnOne freebusy API 自動呼び出し
S4: schedule (3名) → oneToMany prepare + send 自動実行
S5: schedule (1名) → API エラー → フォールバックメッセージ
S6: completed → pending クリアのみ、API 呼び出しなし
```

---

## 9. 実装タスク分割

| # | タスク | 見積 | 依存 |
|---|--------|------|------|
| T1 | `executors/postImportBridge.ts` 新規作成 (oneOnOne + oneToMany 対応) | 45min | - |
| T2 | `executors/index.ts` に re-export | 5min | T1 |
| T3 | `executors/types.ts` に oneToMany 用 kind 追加 (必要なら) | 10min | T1 |
| T4 | `useChatReducer.ts` handler 修正 (names 取得 + auto-connect) | 30min | T1-T3 |
| T5 | TypeScript 型チェック PASS 確認 | 10min | T1-T4 |
| T6 | Unit テスト: `postImportBridge.test.ts` | 40min | T1 |
| T7 | E2E テスト: `post-import-auto-connect.spec.ts` (6シナリオ) | 75min | T4 |
| T8 | 既存テスト regression チェック | 15min | T5 |
| **合計** | | **~4h** | |

---

## 10. 今後の拡張 (Out of Scope)

| 項目 | 説明 | 優先度 |
|------|------|--------|
| FE-6: oneToMany executor + classifier | チャット自然言語から oneToMany を直接呼べるようにする | 高 |
| FE-6b: oneToMany → freebusy 連携 | 主催者の空きを反映した候補生成 | 中 |
| FE-7: schedule モード選択UI | ボタンでモード選択 | 低 |
| FE-8: Slack/Chatwork チャネル自動選択 | 連絡先設定済みなら自動 | 低 |

---

## 11. リスク

| リスク | 影響 | 軽減策 |
|--------|------|--------|
| oneToMany prepare + send の2段実行で片方だけ成功 | orphan thread | send 失敗時にスレッドURLを返し、手動送信可能に |
| デフォルト候補が主催者の予定と衝突 | 体験悪化 | 後から候補変更 (repropose) 可能。FE-6b で freebusy 連携 |
| pending クリアタイミングずれ | names 消失 | dispatch 前にローカルコピー |
| 既存テスト壊れ | CI 失敗 | mock 維持、新テスト別ファイル |
| oneToMany API の未テスト分岐 | 500 エラー | try-catch + フォールバック |

---

## Appendix: v1.0 → v2.0 変更差分

| 項目 | v1.0 (A戦略) | v2.0 (B戦略) |
|------|-------------|-------------|
| 2名+ schedule | ガイドメッセージで停止 | **oneToMany 自動実行** |
| oneToMany 呼び出し | FE-6 以降 | **FE-5 で bridge 経由** |
| 候補日時生成 | N/A | **デフォルト平日3枠** |
| 招待送信 | N/A | **prepare + send 一気通貫** |
| 設計思想 | 安全重視 | **体験重視: 止めない** |

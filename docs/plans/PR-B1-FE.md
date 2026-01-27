# PR-B1-FE: 会話→候補3つ（Frontend対応）

> **Version**: 2026-01-27  
> **Status**: 計画書（実装前）  
> **依存**: PR-B1-API（✅ 完了）、PR-B1-SSOT（✅ 完了）

---

## 1. 目的

ユーザーが自然言語で「候補3つ提示」体験に入れるようにする。

**ユーザー発話例:**
- 「田中さんと来週月曜10時か火曜14時か水曜16時で打ち合わせ」
- 「佐藤さんに3つ候補出して調整したい」
- 「Aさんと1/28か1/29か1/30で予定調整」
- 「来週木〜日 午後で3つ候補送って」（B-2向け、今回は対象外）

---

## 2. 実装スコープ

### 2-1. 今回やること

| 項目 | ファイル | 内容 |
|------|---------|------|
| **Classifier拡張** | `classifier/oneOnOne.ts` | 複数候補を検出して `schedule.1on1.candidates3` を返す |
| **Executor追加** | `executors/oneOnOne.ts` | `executeOneOnOneCandidates()` で `/candidates/prepare` を呼ぶ |
| **型定義** | `executors/oneOnOne.ts` | `OneOnOneCandidatesPrepareRequest/Response` 追加 |

### 2-2. 今回やらないこと

- 「来週木〜日 午後で3つ候補送って」→ **B-2**（freebusy自動生成）
- 別日希望フォーム → **B-3**
- Open Slots UI → **B-4**

---

## 3. 詳細設計

### 3-1. Classifier 拡張（oneOnOne.ts）

#### 検出パターン（複数候補）

```typescript
// 複数日時パターン
// - 「A or B or C」形式: 「月曜10時か火曜14時か水曜16時」
// - 「, , ,」形式: 「1/28, 1/29, 1/30」
// - 「複数候補」「3つ候補」などのキーワード

const MULTI_SLOT_KEYWORDS = [
  '候補',
  '3つ',
  '複数',
  'いくつか',
  'どれか',
  'どこか',
];

const OR_PATTERNS = [
  /か(?=\d|来週|今週|明日|明後日)/,  // 「月曜か火曜か」
  /(?:と|、|,)\s*(?=\d|来週|今週)/,   // 「1/28、1/29」
];
```

#### 分岐ロジック

```typescript
export const classifyOneOnOne: ClassifierFn = (
  input: string,
  normalizedInput: string,
  context?: IntentContext,
  activePending?: PendingState | null
): IntentResult | null => {
  // ... 既存の前処理 ...

  // 複数候補パターンを検出
  const hasMultiSlotKeyword = MULTI_SLOT_KEYWORDS.some(k => input.includes(k));
  const hasOrPattern = OR_PATTERNS.some(p => p.test(input));
  const dates = extractMultipleDates(input);  // 新規ヘルパー
  
  if (hasMultiSlotKeyword || hasOrPattern || dates.length >= 2) {
    // 候補3つモード
    return classifyOneOnOneCandidates(input, context, person, dates);
  }

  // 既存: 固定1枠モード
  return classifyOneOnOneFixed(input, context, person);
};
```

#### 複数日時抽出ヘルパー

```typescript
/**
 * 複数の日時候補を抽出
 * @returns Array<{ date: Date; time?: { hours: number; minutes: number } }>
 */
function extractMultipleDates(input: string): Array<{ date: Date; time?: { hours: number; minutes: number } }> {
  const results: Array<{ date: Date; time?: { hours: number; minutes: number } }> = [];
  
  // 「月曜10時か火曜14時か水曜16時」形式
  const orSegments = input.split(/か|、|,/);
  for (const segment of orSegments) {
    const date = extractDate(segment.trim());
    const time = extractTime(segment.trim());
    if (date) {
      results.push({ date, time: time ?? undefined });
    }
  }
  
  return results;
}
```

#### Intent 結果

```typescript
// 複数候補モード
return {
  intent: 'schedule.1on1.candidates3',
  confidence: 0.9,
  params: {
    person,
    slots: dates.map(d => ({
      start_at: buildStartAt(d.date, d.time).toISOString(),
      end_at: buildEndAt(d.date, d.time, durationMinutes).toISOString(),
    })),
    title,
    rawInput: input,
  },
};
```

### 3-2. Executor 追加（oneOnOne.ts）

#### 型定義

```typescript
// ============================================================
// Types - 候補3つ（B-1）
// ============================================================

interface OneOnOneCandidatesPrepareRequest {
  invitee: {
    name: string;
    email?: string;
    contact_id?: string;
  };
  slots: Array<{
    start_at: string;  // ISO8601
    end_at: string;    // ISO8601
  }>;
  title?: string;
  message_hint?: string;
  send_via?: 'email' | 'share_link';
}

interface OneOnOneCandidatesPrepareResponse {
  success: boolean;
  thread_id: string;
  invite_token: string;
  share_url: string;
  slots: Array<{
    slot_id: string;
    start_at: string;
    end_at: string;
  }>;
  message_for_chat: string;
  mode: 'email' | 'share_link';
  email_queued?: boolean;
  request_id: string;
}

// ExecutionResultData 拡張
export type OneOnOneCandidatesResultData = {
  kind: '1on1.candidates.prepared';
  payload: {
    threadId: string;
    inviteToken: string;
    shareUrl: string;
    mode: 'email' | 'share_link';
    person: { name?: string; email?: string };
    slots: Array<{ slot_id: string; start_at: string; end_at: string }>;
  };
};
```

#### API呼び出し

```typescript
/**
 * POST /api/one-on-one/candidates/prepare を呼び出す
 */
async function callOneOnOneCandidatesPrepareApi(
  request: OneOnOneCandidatesPrepareRequest,
  token: string
): Promise<OneOnOneCandidatesPrepareResponse> {
  const response = await fetch(`${API_BASE_URL}/api/one-on-one/candidates/prepare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || error.details || `API error: ${response.status}`);
  }

  return response.json();
}
```

#### Executor 実装

```typescript
/**
 * 1対1候補3つの招待リンク発行
 * 
 * @param intentResult - classifyOneOnOne の結果（intent: 'schedule.1on1.candidates3'）
 * @returns ExecutionResult
 */
export async function executeOneOnOneCandidates(
  intentResult: IntentResult
): Promise<ExecutionResult> {
  const token = getToken();
  if (!token) {
    return {
      success: false,
      message: 'ログインが必要です。再度ログインしてください。',
    };
  }

  const { params } = intentResult;

  log.debug('[OneOnOne] executeOneOnOneCandidates called', { params });

  // clarification が必要な場合
  if (intentResult.needsClarification) {
    return {
      success: true,
      message: intentResult.needsClarification.message,
    };
  }

  // バリデーション
  if (!params.person) {
    return {
      success: false,
      message: '相手の名前かメールアドレスを教えてください。',
    };
  }

  if (!params.slots || params.slots.length === 0) {
    return {
      success: false,
      message: '候補日時を教えてください。（例: 来週月曜10時、火曜14時、水曜16時）',
    };
  }

  try {
    const request: OneOnOneCandidatesPrepareRequest = {
      invitee: {
        name: params.person.name || params.person.email || '相手',
        email: params.person.email,
      },
      slots: params.slots,
      title: params.title || '打ち合わせ',
      message_hint: params.rawInput,
      send_via: params.person.email ? 'email' : 'share_link',
    };

    log.debug('[OneOnOne] Calling candidates API', { request });

    const response = await callOneOnOneCandidatesPrepareApi(request, token);

    log.debug('[OneOnOne] Candidates API response', { response });

    return {
      success: true,
      message: response.message_for_chat,
      data: {
        kind: '1on1.candidates.prepared',
        payload: {
          threadId: response.thread_id,
          inviteToken: response.invite_token,
          shareUrl: response.share_url,
          mode: response.mode,
          person: params.person,
          slots: response.slots,
        },
      } as unknown as ExecutionResultData,
    };

  } catch (error) {
    log.error('[OneOnOne] Candidates API call failed', { error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('Unauthorized')) {
      return { success: false, message: 'ログインが必要です。' };
    }
    if (errorMessage.includes('validation_error')) {
      return { success: false, message: '候補日時の形式に問題があります。' };
    }

    return {
      success: false,
      message: `予定調整の準備中にエラーが発生しました: ${errorMessage}`,
    };
  }
}
```

### 3-3. apiExecutor.ts 呼び分け

```typescript
// apiExecutor.ts の該当箇所

case 'schedule.1on1.fixed':
  return executeOneOnOneFixed(intentResult);

case 'schedule.1on1.candidates3':
  return executeOneOnOneCandidates(intentResult);
```

---

## 4. テストケース

### 4-1. 単体テスト（classifier）

| 入力 | 期待 Intent | 備考 |
|------|-------------|------|
| 「田中さんと来週月曜10時で打ち合わせ」 | `schedule.1on1.fixed` | 1枠のみ |
| 「田中さんと来週月曜10時か火曜14時で打ち合わせ」 | `schedule.1on1.candidates3` | 2枠 |
| 「田中さんに3つ候補出して日程調整」 | `schedule.1on1.candidates3` | キーワード |
| 「佐藤さんと1/28、1/29、1/30で予定調整」 | `schedule.1on1.candidates3` | カンマ区切り |
| 「Aさんとどこかで打ち合わせ」 | `schedule.1on1.candidates3` + clarification | slots不足 |

### 4-2. 結合テスト（E2E）

```typescript
// e2e/oneOnOneCandidates.spec.ts

test('候補3つで招待リンク発行', async ({ page }) => {
  // 1. チャット入力
  await page.fill('[data-testid="chat-input"]', '田中さんと来週月曜10時か火曜14時か水曜16時で打ち合わせ');
  await page.click('[data-testid="chat-submit"]');
  
  // 2. AI秘書レスポンス確認
  await expect(page.locator('[data-testid="chat-message"]')).toContainText('候補日時（3件）');
  await expect(page.locator('[data-testid="chat-message"]')).toContainText('https://app.tomoniwao.jp/i/');
  
  // 3. リンク取得して遷移
  const shareUrl = await page.locator('[data-testid="share-url"]').textContent();
  await page.goto(shareUrl!);
  
  // 4. multiSlotUI 確認
  await expect(page.locator('.slot-card')).toHaveCount(3);
  await expect(page.locator('button:has-text("この日程で参加する")')).toBeVisible();
});
```

---

## 5. DoD（Definition of Done）

- [x] `classifier/oneOnOne.ts` に複数候補検出ロジック追加 ✅ (2026-01-27)
- [x] `executors/oneOnOne.ts` に `executeOneOnOneCandidates()` 追加 ✅ (2026-01-27)
- [x] `apiExecutor.ts` で `schedule.1on1.candidates3` を呼び分け ✅ (2026-01-27)
- [x] `classifier/types.ts` に `schedule.1on1.candidates3` を IntentType に追加 ✅ (2026-01-27)
- [x] TypeScript コンパイルエラーなし ✅ (2026-01-27)
- [x] 単体テスト追加（classifier）✅ 13パターン回帰テスト (2026-01-27)
- [ ] 手動テスト: チャット入力→API→レスポンス確認
- [x] main ブランチにマージ ✅ (2026-01-27)

---

## 6. 既存資産の再利用

| 資産 | ファイル | 再利用方法 |
|------|---------|----------|
| 日付抽出 | `classifier/oneOnOne.ts` | `extractDate()`, `extractTime()` をそのまま使用 |
| 人名抽出 | 同上 | `extractPerson()` をそのまま使用 |
| API呼び出し | `executors/oneOnOne.ts` | `callOneOnOnePrepareApi()` のパターンをコピー |
| フォーマット | 同上 | `formatDateTimeJP()` をそのまま使用 |

---

## 7. リスク・懸念点

| リスク | 対策 |
|--------|------|
| 「か」の誤検出（「予定調整お願いできますか」） | 「か」の後に日時パターンがある場合のみマッチ |
| 複数日時の順序 | 入力順をそのまま使用（時系列ソートはB-2以降） |
| clarification ループ | 既存の clarification 機構を流用 |

---

## 8. 次のステップ

1. ✅ 計画書レビュー (2026-01-27)
2. ✅ classifier 実装 (2026-01-27)
3. ✅ executor 実装 (2026-01-27)
4. ✅ 単体テスト (2026-01-27)
5. ⏳ 手動テスト（フロントエンドデプロイ後）
6. ✅ main マージ (2026-01-27)
7. ⏳ PR-B1-E2E 着手

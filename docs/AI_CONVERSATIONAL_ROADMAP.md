# AI会話化ロードマップ

> **目標**: 決め打ちインテント方式を壊さずに、AI秘書との自然会話で全機能を動かす
> 
> **原則**: AIは「解釈と計画」のみ、実行は「既存の堅いインテント/実行基盤」で行う

---

## 1. 目指す最終体験（UXの定義）

### ユーザーの発話例
```
「来週の午後で空いてるところを優先して、AさんBさんと1時間で調整しといて」
「Aさんは14時以降、Bさんは木曜夜がいい。無理なら他でもOK」
「田中さんに明日のリマインド送って」
```

### AI秘書の返答フロー
1. **理解の要約**（目的/制約/優先を確認）
2. **提案**（候補8件＋理由＋代案）
3. **確認**（この候補で招待を送る？/誰に送る？/メッセージは？）
4. **実行**（pending.action.created に合流して "送る/キャンセル"）
5. **フォロー**（未返信者へ自動リマインド提案など）

---

## 2. コア方針（事故らないための鉄則）

### 2-1. 実行系は既存の堅い基盤に寄せる
- 既存の `classifier → intent → apiExecutor/executors → pending.action` を **"実行レール"** として維持
- AIは **自然言語→(意図/パラメータ/計画)** を作るだけ
- 実行は必ず既存レールへ

### 2-2. AIは「勝手に送らない」
- 外部送信（招待・追加候補・リマインド・SMS等）は **常に confirm 必須**
- これにより「会話型にしても事故らない」

### 2-3. フォールバック設計
- AIが曖昧なら、今と同じように **ガイド文で入力を促す**
- AIが失敗したら **ルール分類に戻る**（現状UXを壊さない）

---

## 3. アーキテクチャ設計

### 追加するコンポーネント

```
┌─────────────────────────────────────────────────────────────┐
│                      ユーザー発話                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  A) nlRouter（Natural Language Router）                     │
│  - 入力: ユーザー発話 + 文脈（スレッド/pending/ログ）         │
│  - 出力: ActionPlan（構造化JSON）                           │
│  - 失敗時: 既存ルール分類にフォールバック                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  B) policyGate（安全ゲート）                                │
│  - intentごとに「確認が必要か」判定                         │
│  - データ不足や危険操作をブロック → 質問に分解              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  C) executorBridge                                          │
│  - ActionPlan.intent を IntentResult に変換                 │
│  - 既存の executeIntent() に投げる                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  既存: apiExecutor → executors → pending.action             │
│  （変更なし）                                               │
└─────────────────────────────────────────────────────────────┘
```

### ActionPlan スキーマ（出力例）

```typescript
interface ActionPlan {
  // 既存インテントに落とす
  intent: IntentType;
  
  // パラメータ
  params: {
    range?: 'today' | 'week' | 'next_week';
    prefer?: 'morning' | 'afternoon' | 'evening' | 'business';
    duration_minutes?: number;
    threadId?: string;
    // ...
  };
  
  // P3-GEN1: 好み（スコアリング用）
  preferences?: SchedulePrefs;
  
  // 確認が必要か（policyGateで上書き可能）
  requires_confirm: boolean;
  
  // 不足情報の質問
  clarifications?: Array<{
    field: string;
    question: string;
  }>;
  
  // 応答スタイル
  response_style: 'brief' | 'detailed' | 'conversational';
}
```

---

## 4. 既存インテント一覧（Intent Map）

### A. カレンダー閲覧/空き枠（Phase Next-3）

| Intent | 説明 | 確認要否 |
|--------|------|----------|
| `schedule.today` | 今日の予定 | 不要 |
| `schedule.week` | 今週の予定 | 不要 |
| `schedule.freebusy` | 自分の空き時間/空き枠 | 不要 |
| `schedule.freebusy.batch` | 複数参加者の共通空き | 不要 |

### B. 招待・候補送信（Beta A）

| Intent | 説明 | 確認要否 |
|--------|------|----------|
| `invite.prepare.emails` | メール貼り付け→送信準備 | **必要** |
| `invite.prepare.list` | リスト指定→送信準備 | **必要** |
| `pending.action.decide` | 送る/キャンセル/別スレッドで | 不要（確定操作） |

### C. 自動調整・追加候補（Phase Next-5/6）

| Intent | 説明 | 確認要否 |
|--------|------|----------|
| `schedule.auto_propose` | 自動調整提案 | **必要** |
| `schedule.auto_propose.confirm` | 提案確定 | 不要 |
| `schedule.auto_propose.cancel` | 提案キャンセル | 不要 |
| `schedule.additional_propose` | 追加候補提案 | **必要** |

### D. リマインド（Phase Next-6 / Phase2）

| Intent | 説明 | 確認要否 |
|--------|------|----------|
| `schedule.remind.pending` | 未返信リマインド提案 | **必要** |
| `schedule.remind.pending.confirm` | リマインド確定 | 不要 |
| `schedule.remind.pending.cancel` | リマインドキャンセル | 不要 |
| `schedule.need_response.list` | 再回答必要者リスト表示 | 不要 |
| `schedule.remind.need_response` | 再回答必要者にリマインド | **必要** |
| `schedule.remind.responded` | 回答済みにリマインド | **必要** |

### E. 確定・再調整（Phase2）

| Intent | 説明 | 確認要否 |
|--------|------|----------|
| `schedule.finalize` | 確定 | **必要** |
| `schedule.reschedule` | 確定後やり直し | **必要** |
| `schedule.status.check` | 状況確認 | 不要 |
| `schedule.invite.list` | 招待者一覧 | 不要 |

### F. リスト管理（Beta A）

| Intent | 説明 | 確認要否 |
|--------|------|----------|
| `list.create` | リスト作成 | 不要 |
| `list.list` | リスト一覧 | 不要 |
| `list.members` | リストメンバー表示 | 不要 |
| `list.add_member` | リストにメンバー追加 | 不要 |

### G. 好み設定（P3-PREF）

| Intent | 説明 | 確認要否 |
|--------|------|----------|
| `preference.set` | 好み設定 | 不要 |
| `preference.show` | 好み表示 | 不要 |
| `preference.clear` | 好みクリア | 不要 |

---

## 5. 段階的ロードマップ

### Phase CONV-0: AIを「好み抽出」にだけ使う（現在地）

**状態**: P3-GEN1 完了
- `SchedulePrefs` スキーマ定義済み
- `slotScorer.ts` でスコアリング実装済み
- `scored_slots` をAPIで返却
- フロント表示対応済み

**成果**:
- "好みっぽい文言" → 構造化 → スコア反映
- 既存インテントは温存

### Phase CONV-1: AIが「解釈補助」になる（最短で効果大）

**実装内容**:
- 現状の classifier はそのまま
- **classifier が `unknown` になった時だけ** nlRouter を呼ぶ
- nlRouter が既知の intent に落とせたら実行、落とせなければ質問

**成果**:
- "決め打ち文言じゃないと動かない" が一気に緩和
- 事故は増えない（confirmは既存のまま）

**コード変更**:
```typescript
// frontend/src/core/chat/classifier/index.ts
export function classifyIntent(input: string, context: IntentContext): IntentResult {
  // 1. 既存のルール分類を実行
  const result = runRuleClassifiers(input, context);
  
  // 2. unknown なら nlRouter にフォールバック
  if (result.intent === 'unknown' && shouldUseNlRouter(input)) {
    const aiResult = await nlRouter.classify(input, context);
    if (aiResult && aiResult.intent !== 'unknown') {
      return aiResult;
    }
  }
  
  return result;
}
```

### Phase CONV-2: AIが「会話の主導権」を持つ

**実装内容**:
- すべての入力を nlRouter に通す
- 既知intentはそのまま実行レールへ
- 不明は質問
- pending中は、AIが "次に何をすべきか" を自然言語で導く
- ただし決定語 "送る/キャンセル" も受け付ける

**コード変更**:
```typescript
// nlRouter の出力に「次のアクション提案」を追加
interface ActionPlan {
  // ...
  suggested_next_actions?: Array<{
    label: string;       // "送信する"
    intent: IntentType;  // 'pending.action.decide'
    params: Record<string, any>;
  }>;
}
```

### Phase CONV-3: 複合タスクの実行

**実装内容**:
- 1回の会話で複数intentを段階実行
- 例：「来週の午後で、A/B/Cに送って」
  - → `freebusy.batch` → `score` → `prepareSend` → `pending.action.created`
  - → 最後はユーザーに「送る？」確認

---

## 6. nlRouter の設計

### 入力
```typescript
interface NlRouterInput {
  user_message: string;
  context: {
    selectedThreadId?: string;
    pendingState?: PendingState;
    recentActions?: Array<{ intent: string; timestamp: string }>;
    userPrefs?: SchedulePrefs;
  };
  locale: 'ja' | 'en';
  timezone: string;
}
```

### プロンプト構成

```
あなたはスケジューリングAI秘書です。
ユーザーの発話を理解し、以下のJSON形式で返してください。

【許可されたintent一覧】
${ALLOWED_INTENTS.map(i => `- ${i.name}: ${i.description}`).join('\n')}

【現在の文脈】
- 選択中スレッド: ${context.selectedThreadId || 'なし'}
- 保留中アクション: ${context.pendingState?.type || 'なし'}

【出力JSON】
{
  "intent": "許可リストから選択",
  "params": { ... },
  "preferences": { ... },  // 好みがあれば
  "requires_confirm": true/false,
  "clarifications": [{ "field": "...", "question": "..." }],
  "confidence": 0.0-1.0
}

【ルール】
1. 推測しない。曖昧なら clarifications に質問を入れる
2. 外部送信系（invite/remind/finalize）は requires_confirm: true
3. 許可リストにないintentは返さない → "unknown"
```

### 出力検証（Zod）

```typescript
const ActionPlanSchema = z.object({
  intent: z.enum(ALLOWED_INTENTS),
  params: z.record(z.any()),
  preferences: SchedulePrefsSchema.optional(),
  requires_confirm: z.boolean(),
  clarifications: z.array(z.object({
    field: z.string(),
    question: z.string(),
  })).optional(),
  confidence: z.number().min(0).max(1),
});
```

---

## 7. 安全ポリシー（Confirm Rules）

### 必ず確認が必要な操作

| カテゴリ | Intent | 理由 |
|----------|--------|------|
| 外部送信 | `invite.prepare.*`, `schedule.remind.*` | メール/通知が飛ぶ |
| 確定操作 | `schedule.finalize`, `schedule.auto_propose.confirm` | 取り消し困難 |
| 再調整 | `schedule.reschedule` | 既存参加者への影響 |

### 確認不要（安全）な操作

| カテゴリ | Intent | 理由 |
|----------|--------|------|
| 閲覧系 | `schedule.today`, `schedule.week`, `schedule.freebusy` | 副作用なし |
| リスト管理 | `list.*` | 内部データのみ |
| キャンセル系 | `*.cancel` | 送信を止める方向 |

---

## 8. フォールバック設計

### unknown時の質問テンプレート

```typescript
const FALLBACK_QUESTIONS: Record<string, string> = {
  missing_thread: '対象のスレッドを選択してください',
  missing_range: '期間を教えてください（例: 今週、来週）',
  missing_participants: '参加者を教えてください（メールアドレスまたはリスト名）',
  ambiguous_action: '何をしたいですか？\n- 空き時間を確認\n- 招待を送る\n- リマインドを送る',
};
```

### AI失敗時のフォールバック

```typescript
async function classifyWithFallback(input: string, context: IntentContext): Promise<IntentResult> {
  try {
    const aiResult = await nlRouter.classify(input, context);
    if (aiResult.confidence > 0.7) {
      return aiResult;
    }
  } catch (e) {
    console.warn('[nlRouter] Failed, falling back to rules', e);
  }
  
  // ルール分類にフォールバック
  return runRuleClassifiers(input, context);
}
```

---

## 9. ログ/監査（Incident対応）

### 保存すべきデータ

```typescript
interface NlRouterLog {
  id: string;
  timestamp: string;
  user_id: string;
  
  // 入力
  user_message: string;
  context: NlRouterInput['context'];
  
  // AI出力
  ai_response_raw: string;
  action_plan: ActionPlan | null;
  validation_errors?: string[];
  
  // 実行結果
  final_intent: IntentType;
  executed: boolean;
  execution_result?: string;
}
```

---

## 10. 実装チェックリスト

### Phase CONV-1（最短導入）

- [ ] `frontend/src/core/chat/nlRouter.ts` 新規作成
- [ ] `frontend/src/core/chat/classifier/index.ts` にフォールバック追加
- [ ] OpenAI呼び出しの共通関数（既存があれば流用）
- [ ] ActionPlan の Zod スキーマ
- [ ] E2E: unknown入力がAIで解釈されるケース

### Phase CONV-2

- [ ] nlRouter を全入力のエントリポイントに
- [ ] suggested_next_actions の実装
- [ ] ログ保存（D1テーブル追加）

### Phase CONV-3

- [ ] 複合タスクのステートマシン
- [ ] タスク進行中のUI表示

---

## 11. 次のアクション

### 直近（P3-GEN1の次）

1. **P3-SCORE1（理由表示）**: スコアの理由をユーザー名付きで表示
2. **Phase CONV-1準備**: nlRouter の設計詳細化

### 中期

3. **Phase CONV-1実装**: unknown時のAIフォールバック
4. **好み設定UI**: チャットから好みを設定できる機能

---

*最終更新: 2026-01-24*

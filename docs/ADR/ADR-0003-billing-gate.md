# ADR-0003: Billing Gate 設計

## Status
**Accepted** (2026-01-03)

---

## Context

課金状態によって API の実行を制御する必要がある。

### 問題
- 課金停止ユーザーが実行系 API を使えてしまう
- GET/propose 系まで止めるとユーザー体験が悪い
- 運用インシデントの切り分けが困難（DB エラー vs 課金停止）

---

## Decision

### 1. Week1 ルール（status のみ判定）
```typescript
// status=2(停止) or 4(解約) → BLOCK (402)
// status=1(登録) or 3(復活) or Free → ALLOW
```

### 2. 実行系のみ制御
- **制御対象**: finalize, remind
- **制御なし**: GET /status, propose 系

### 3. fail-closed
- DB エラー → 402
- user_not_found → 402
- 不明なら止める（安全側）

### 4. reason フィールド
```typescript
export type BillingGateReason = 
  | 'billing_blocked'   // status=2 or 4
  | 'user_not_found'    // userId or email null
  | 'db_error';         // DB query failed
```

---

## Implementation

### checkBillingGate()
```typescript
export async function checkBillingGate(
  c: Context<{ Bindings: Env; Variables: Variables }>
): Promise<BillingGateResult> {
  const requestId = crypto.randomUUID();
  
  try {
    const userId = c.get('userId');
    if (!userId) {
      return {
        ok: false,
        httpStatus: 402,
        code: 'billing_blocked',
        reason: 'user_not_found',
        status: null,
        message: '認証情報が取得できないため、実行できません。',
        requestId,
      };
    }
    
    // Load user email
    const user = await c.env.DB.prepare(`SELECT email FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ email: string }>();
    
    if (!user?.email) {
      return {
        ok: false,
        httpStatus: 402,
        code: 'billing_blocked',
        reason: 'user_not_found',
        status: null,
        message: 'ユーザー情報が取得できないため、実行できません。',
        requestId,
      };
    }
    
    // Normalize email
    const normalizedEmail = normalizeEmail(user.email);
    
    // Check billing_accounts
    const account = await c.env.DB.prepare(
      `SELECT status FROM billing_accounts WHERE email = ? ORDER BY last_event_ts DESC LIMIT 1`
    ).bind(normalizedEmail).first<{ status: number }>();
    
    // No row => Free => allow
    if (!account) return { ok: true };
    
    // status=2 → 停止
    if (account.status === 2) {
      return {
        ok: false,
        httpStatus: 402,
        code: 'billing_blocked',
        reason: 'billing_blocked',
        status: 2,
        message: '課金状態が停止のため、実行できません（提案は可能です）。',
        requestId,
      };
    }
    
    // status=4 → 解約
    if (account.status === 4) {
      return {
        ok: false,
        httpStatus: 402,
        code: 'billing_blocked',
        reason: 'billing_blocked',
        status: 4,
        message: '課金状態が解約のため、実行できません（提案は可能です）。',
        requestId,
      };
    }
    
    // status=1 or 3 => allow
    return { ok: true };
  } catch (e) {
    console.error('[billingGate]', requestId, e);
    return {
      ok: false,
      httpStatus: 402,
      code: 'billing_blocked',
      reason: 'db_error',
      status: null,
      message: '課金状態を確認できないため、実行できません。',
      requestId,
    };
  }
}
```

### API Route 例
```typescript
app.post('/:id/finalize', async (c) => {
  const { env } = c;
  const userId = await getUserIdFromContext(c);
  
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  // Billing Gate
  const gate = await checkBillingGate(c);
  if (!gate.ok) {
    return c.json(
      {
        error: gate.code,
        reason: gate.reason,
        status: gate.status,
        message: gate.message,
        request_id: gate.requestId,
      },
      gate.httpStatus
    );
  }
  
  // 実行処理
  // ...
});
```

---

## Consequences

### Positive
- ✅ 運用インシデントの切り分けが容易（reason フィールド）
- ✅ 段階的な課金制御が可能（Week1: status のみ）
- ✅ フロント側で reason 別 UI 表示可能
- ✅ fail-closed で安全

### Negative
- ⚠️ email 照合依存（将来 user_id 紐付けが必要）
- ⚠️ 一時的な DB エラーで止まる可能性

### Risks
- email 変更時の誤判定
- DB 負荷増加

---

## Alternatives Considered

### Alternative 1: 全 API で Gate チェック
- GET/propose まで止めるとユーザー体験が悪い
- → 実行系のみに限定

### Alternative 2: fail-open
- 課金停止を見逃す可能性
- → fail-closed を採用

### Alternative 3: 403 レスポンス
- 存在が分かってしまう
- → 404 で隠蔽（Tenant Isolation と統一）

---

## Related Decisions

- ADR-0001: Tenant Isolation（404 で隠蔽）

---

## Future Work

### Week2+
- プラン別制御（Free/Pro/Enterprise）
- 使用量制限（月間スレッド数、招待数）
- 超過時の段階的制御

### Phase2
- user_id 直接紐付け（email 照合から移行）
- billing_accounts の正規化

---

## References

- Implementation: `apps/api/src/utils/billingGate.ts`
- Email Util: `apps/api/src/utils/email.ts`
- Routes: `apps/api/src/routes/threadsFinalize.ts`, `threadsRemind.ts`
- Doc: `docs/BILLING_AND_LIMITS.md`

---

## Notes

### 402 レスポンス例
```json
{
  "error": "billing_blocked",
  "reason": "billing_blocked",
  "status": 2,
  "message": "課金状態が停止のため、実行できません（提案は可能です）。",
  "request_id": "uuid"
}
```

### フロント側対応
```typescript
if (response.status === 402) {
  const data = await response.json();
  
  switch (data.reason) {
    case 'billing_blocked':
      showMessage('課金が停止されています。アカウント設定を確認してください。');
      break;
    case 'user_not_found':
      showMessage('ユーザー情報の取得に失敗しました。再ログインしてください。');
      break;
    case 'db_error':
      showMessage('一時的なエラーが発生しました。しばらくしてから再試行してください。');
      break;
  }
}
```

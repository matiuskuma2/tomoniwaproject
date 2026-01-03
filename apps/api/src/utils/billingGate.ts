/**
 * Billing Gate (Week1: status only)
 * - Stop ONLY execution endpoints (finalize/remind)
 * - status=2(suspended),4(cancelled) => BLOCK (402)
 * - status=1(active),3(recovered) or no billing row => ALLOW
 *
 * Incident safety:
 * - Fail-closed (if DB/user lookup fails, block with 402)
 * - Never throw 500 to client (return controlled 402 w/ request_id)
 */

import type { Context } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import type { Variables } from '../middleware/auth';

export type BillingGateResult =
  | { ok: true }
  | {
      ok: false;
      httpStatus: 402;
      code: 'billing_blocked';
      status: 2 | 4 | null;
      message: string;
      requestId: string;
    };

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
        status: null,
        message: '認証情報が取得できないため、実行できません。',
        requestId,
      };
    }

    // Week1: billing_accounts is keyed by normalized email
    const user = await c.env.DB.prepare(`SELECT email FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ email: string }>();

    if (!user?.email) {
      // Fail-closed: data inconsistency should not allow execution
      return {
        ok: false,
        httpStatus: 402,
        code: 'billing_blocked',
        status: null,
        message: 'ユーザー情報が取得できないため、実行できません。',
        requestId,
      };
    }

    const normalizedEmail = user.email.trim().toLowerCase();

    const account = await c.env.DB.prepare(
      `SELECT status
         FROM billing_accounts
        WHERE email = ?
        ORDER BY last_event_ts DESC
        LIMIT 1`
    )
      .bind(normalizedEmail)
      .first<{ status: number }>();

    // No row => Free => allow (Week1 rule)
    if (!account) return { ok: true };

    if (account.status === 2) {
      return {
        ok: false,
        httpStatus: 402,
        code: 'billing_blocked',
        status: 2,
        message: '課金状態が停止のため、実行できません（提案は可能です）。',
        requestId,
      };
    }

    if (account.status === 4) {
      return {
        ok: false,
        httpStatus: 402,
        code: 'billing_blocked',
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
      status: null,
      message: '課金状態を確認できないため、実行できません。',
      requestId,
    };
  }
}

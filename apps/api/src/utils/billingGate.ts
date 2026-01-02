import type { Context } from 'hono';
import type { Env } from '../../../../packages/shared/src/types/env';
import type { Variables } from '../middleware/auth';

/**
 * Billing Gate（confirm実行点のみ止める）
 * - status=2(停止),4(解約) → 実行禁止
 * - status=1(登録),3(復活) → 実行許可
 * - billing_accounts レコードなし → Free扱いで実行許可
 *
 * 事故防止:
 * - 例外時は「止める」（fail-closed）
 * - 500にしない（運用インシデントを軽症化）
 */
export async function checkBillingGate(
  c: Context<{ Bindings: Env; Variables: Variables }>
): Promise<
  | { ok: true }
  | { ok: false; httpStatus: 402 | 403; code: 'billing_blocked'; status: 2 | 4 | null; message: string; requestId: string }
> {
  const requestId = crypto.randomUUID();

  try {
    // requireAuth後の前提：userIdが入っている（Variables.userId）
    const userId = c.get('userId');
    if (!userId) {
      return {
        ok: false,
        httpStatus: 403,
        code: 'billing_blocked',
        status: null,
        message: '認証情報が取得できませんでした。',
        requestId,
      };
    }

    // usersからemail取得（Week1の正：billing_accountsはemail照合）
    const user = await c.env.DB.prepare(`SELECT email FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ email: string }>();

    // users.emailが無い or userが無い：安全側で止める（データ不整合は早期検知）
    if (!user?.email) {
      return {
        ok: false,
        httpStatus: 403,
        code: 'billing_blocked',
        status: null,
        message: 'ユーザー情報が取得できませんでした。',
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

    // billing_accounts無し = Free（実行OK）
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

    // 1 or 3 → OK
    return { ok: true };
  } catch (e) {
    console.error('[billingGate]', requestId, e);
    // 安全側：止める（500にしない）
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

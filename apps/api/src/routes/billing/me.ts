/**
 * GET /api/billing/me
 * 
 * ユーザーの現在の課金状態を返す
 * - 認証必須（Day3-0の境界ミドルウェアで担保）
 * - billing_accountsが無い場合はFree（デフォルト）
 * - MyASP同期済みの場合はplan/status/amountを返す
 */

import { Hono } from 'hono';
import type { Variables } from '../../middleware/auth';

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// tomonowaプラン（4種類）
// Free: ¥0 (billing_accountsレコード無し)
// Pro: ¥980 (plan=1)
// Team: ¥2,980 (plan=2)
// Enterprise: ¥15,000 (plan=3)
const PLAN_TO_TIER: Record<number, string> = {
  1: 'pro',
  2: 'team',
  3: 'enterprise',
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

app.get('/me', async (c) => {
  const { env } = c;

  // Day3-0で /api/billing/* は requireAuth 強制済みだが、念のため
  const userId = c.get('userId');
  if (!userId) {
    return c.json(
      { error: 'Unauthorized', message: 'Authentication required' },
      401
    );
  }

  // TODO: Phase Next-12で billing_accounts.user_id へ移行する
  const user = await env.DB.prepare(
    `SELECT email FROM users WHERE id = ? LIMIT 1`
  ).bind(userId).first<{ email: string }>();

  if (!user?.email) {
    return c.json(
      { error: 'Unauthorized', message: 'User not found' },
      401
    );
  }

  const email = normalizeEmail(user.email);

  const account = await env.DB.prepare(
    `
    SELECT plan, status, amount, last_event_ts, updated_at
    FROM billing_accounts
    WHERE email = ?
    ORDER BY last_event_ts DESC
    LIMIT 1
    `
  ).bind(email).first<{
    plan: number;
    status: number;
    amount: number;
    last_event_ts: string | null;
    updated_at: string | null;
  }>();

  // billing_accountsが無い = Free（デフォルト）
  if (!account) {
    return c.json({
      tier: 'free',
      amount: 0,
      status: 1,            // 1=登録（有効扱い）
      last_event_ts: null,
      updated_at: null,
      source: 'default_free',
    });
  }

  // MyASP同期済み: plan → tier変換
  const tier = PLAN_TO_TIER[account.plan] || 'unknown';

  return c.json({
    tier,
    amount: account.amount,
    status: account.status,
    last_event_ts: account.last_event_ts,
    updated_at: account.updated_at,
    source: 'myasp',
  });
});

export default app;

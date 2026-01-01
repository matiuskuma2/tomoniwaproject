import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
  MYASP_SYNC_TOKEN: string; // wrangler secret / .dev.vars
};

type MyaspFormBody = Record<string, string | File>;

const app = new Hono<{ Bindings: Bindings }>();

const PLAN_AMOUNT: Record<number, number> = {
  1: 980,
  2: 2980,
  3: 15000,
};

const VALID_STATUS = new Set([1, 2, 3, 4]);
const TS_WINDOW_MS = 24 * 60 * 60 * 1000; // ±24h

function pickString(body: MyaspFormBody, key: string): string | null {
  const v = body[key];
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length ? s : null;
}

function isValidEmail(email: string): boolean {
  // 最小（厳しすぎると弾きすぎる）
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.post('/sync/:token', async (c) => {
  const { env } = c;
  const requestId = crypto.randomUUID();

  // 1) token auth（必須。フォールバック無しが安全）
  const token = c.req.param('token');
  if (!env.MYASP_SYNC_TOKEN || token !== env.MYASP_SYNC_TOKEN) {
    // token値はログに出さない
    console.warn(`[billing-sync:${requestId}] invalid token attempt`);
    return c.json({ error: 'invalid token', request_id: requestId }, 401);
  }

  // 2) parse form
  const body = (await c.req.parseBody()) as MyaspFormBody;

  const myaspUserId = pickString(body, 'data[User][user_id]');
  const email = pickString(body, 'mail');
  const planStr = pickString(body, 'plan');
  const amountStr = pickString(body, 'amount');
  const statusStr = pickString(body, 'status');
  const ts = pickString(body, 'ts');
  const sig = pickString(body, 'sig'); // 現状は参考（改ざん防止には弱い）

  // 3) required validation
  if (!myaspUserId || !email || !planStr || !amountStr || !statusStr || !ts) {
    return c.json({ error: 'missing required fields', request_id: requestId }, 400);
  }
  if (!isValidEmail(email)) {
    return c.json({ error: 'invalid email', request_id: requestId }, 400);
  }

  // 3-1) email正規化（運用事故を減らす）
  const normalizedEmail = email.trim().toLowerCase();

  const plan = Number(planStr);
  const amount = Number(amountStr);
  const status = Number(statusStr);

  if (!Number.isInteger(plan) || !(plan in PLAN_AMOUNT)) {
    return c.json({ error: 'invalid plan', request_id: requestId }, 400);
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return c.json({ error: 'invalid amount', request_id: requestId }, 400);
  }
  if (PLAN_AMOUNT[plan] !== amount) {
    return c.json(
      { error: `invalid amount for plan ${plan}`, expected: PLAN_AMOUNT[plan], got: amount, request_id: requestId },
      400
    );
  }
  if (!Number.isInteger(status) || !VALID_STATUS.has(status)) {
    return c.json({ error: 'invalid status', request_id: requestId }, 400);
  }

  // 4) ts validation (ISO recommended)
  const eventTs = new Date(ts);
  if (Number.isNaN(eventTs.getTime())) {
    return c.json({ error: 'invalid ts', request_id: requestId }, 400);
  }

  // 4-1) ts正規化（巻き戻り事故を0に）
  // MyASPの %datetime_registration% が形式揺れしても、ISO8601で統一
  const normalizedTs = eventTs.toISOString();

  // window check（古すぎるのは反映しない：eventsは残す）
  const now = Date.now();
  const diff = Math.abs(now - eventTs.getTime());
  const isTooOld = diff > TS_WINDOW_MS;

  // 5) audit info
  const sourceIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  const userAgent = c.req.header('user-agent') || 'unknown';

  // 6) dedupe key（仕様固定）
  // 注意: dedupe_keyは元のtsを使用（MyASP側の重複判定と整合性を保つ）
  const dedupeKey = `${myaspUserId}|${ts}|${status}|${plan}`;

  // raw payload（最小）
  const rawPayload = JSON.stringify({
    user_id: myaspUserId,
    mail: normalizedEmail,
    plan,
    amount,
    status,
    ts: normalizedTs, // 正規化後のtsを保存
    sig, // TODO: 将来HMAC化するならここは署名検証へ
  });

  try {
    // 7) INSERT billing_events（冪等）
    let eventId: number | null = null;
    try {
      const r = await env.DB.prepare(
        `INSERT INTO billing_events
          (myasp_user_id, email, plan, amount, status, ts, dedupe_key, raw_payload, source_ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(myaspUserId, normalizedEmail, plan, amount, status, normalizedTs, dedupeKey, rawPayload, sourceIp, userAgent)
        .run();

      eventId = (r.meta.last_row_id as number) ?? null;
    } catch (e: any) {
      // UNIQUE(dedupe_key) -> duplicate OK
      const msg = String(e?.message || '');
      if (msg.includes('UNIQUE constraint failed') && msg.includes('billing_events.dedupe_key')) {
        return c.json(
          { success: true, message: 'duplicate (already processed)', dedupe_key: dedupeKey, request_id: requestId },
          200
        );
      }
      throw e;
    }

    // 8) 古すぎるtsは accountsに反映しない（運用方針）
    if (isTooOld) {
      return c.json(
        { success: true, message: 'ignored (timestamp too old)', request_id: requestId, event_id: eventId },
        200
      );
    }

    // 9) current status（解約後ガード）
    const current = await env.DB.prepare(
      `SELECT status, last_event_ts
         FROM billing_accounts
        WHERE myasp_user_id = ?
        LIMIT 1`
    )
      .bind(myaspUserId)
      .first<{ status: number; last_event_ts: string | null }>();

    if (current?.status === 4 && status !== 4) {
      // 解約後は解約以外を無視（eventsは残ってる）
      return c.json(
        { success: true, message: 'ignored (after cancellation)', request_id: requestId, event_id: eventId },
        200
      );
    }

    // 10) 巻き戻り防止（正道：MyASPのtsを比較）
    if (current?.last_event_ts) {
      const currentEventTs = new Date(current.last_event_ts);
      if (!Number.isNaN(currentEventTs.getTime()) && eventTs.getTime() <= currentEventTs.getTime()) {
        return c.json(
          { success: true, message: 'ignored (old event)', request_id: requestId, event_id: eventId },
          200
        );
      }
    }

    // 11) UPSERT billing_accounts（last_event_ts基準で更新）
    // 注意: normalizedTsを使用することで、文字列比較が時間順序と一致する
    await env.DB.prepare(
      `INSERT INTO billing_accounts
        (myasp_user_id, email, plan, amount, status, last_event_id, last_event_ts, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(myasp_user_id) DO UPDATE SET
         email = excluded.email,
         plan = excluded.plan,
         amount = excluded.amount,
         status = excluded.status,
         last_event_id = excluded.last_event_id,
         last_event_ts = excluded.last_event_ts,
         updated_at = datetime('now')
       WHERE excluded.last_event_ts > billing_accounts.last_event_ts`
    )
      .bind(myaspUserId, normalizedEmail, plan, amount, status, eventId, normalizedTs)
      .run();

    return c.json(
      { success: true, message: 'processed', request_id: requestId, event_id: eventId },
      200
    );
  } catch (e: any) {
    console.error(`[billing-sync:${requestId}] error`, e);
    return c.json({ error: 'internal server error', request_id: requestId }, 500);
  }
});

export default app;

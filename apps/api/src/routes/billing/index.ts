/**
 * Billing Routes
 * 
 * 認証境界:
 * - /api/billing/myasp/* → token認証のみ（Day3-0のミドルウェアで除外）
 * - /api/billing/* → requireAuth必須（Day3-0のミドルウェアで強制）
 */

import { Hono } from 'hono';
import myaspSync from './myaspSync';
import meRoutes from './me';

const app = new Hono();

// MyASP課金連携（認証不要、token認証のみ）
app.route('/myasp', myaspSync); // /api/billing/myasp/sync/:token

// User API（認証必須 - Day3-0のミドルウェアで強制）
app.route('/', meRoutes); // /api/billing/me

export default app;

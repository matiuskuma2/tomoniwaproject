import { Hono } from 'hono';
import myaspSync from './myaspSync';

const app = new Hono();

// MyASP課金連携（認証不要、token認証のみ）
app.route('/myasp', myaspSync); // /api/billing/myasp/sync/:token

// TODO: 将来実装予定（requireAuth必須）
// import { requireAuth } from '../../middleware/auth';
// import meRoutes from './me';
// app.use('/me', requireAuth);
// app.route('/me', meRoutes); // GET /api/billing/me

export default app;

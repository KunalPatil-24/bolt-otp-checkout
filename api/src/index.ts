import express from 'express';
import { isDatabaseReachable } from './db.js';

const app = express();
const port = Number(process.env.PORT ?? 8080);

/**
 * Health check. Reports whether the process is alive AND whether it can reach
 * the database, because a server that is running but cannot query anything is
 * not actually healthy -- and a host watching this endpoint should know the
 * difference.
 *
 * Returns 503 when the database is unreachable so that automated checks see a
 * failure status rather than having to parse the body.
 */
app.get('/api/health', async (_req, res) => {
  const databaseUp = await isDatabaseReachable();
  res.status(databaseUp ? 200 : 503).json({
    status: databaseUp ? 'ok' : 'degraded',
    database: databaseUp ? 'ok' : 'unreachable',
  });
});

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
});

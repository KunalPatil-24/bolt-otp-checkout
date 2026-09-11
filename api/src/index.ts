import express from 'express';
import { isDatabaseReachable } from './db.js';
import { errorHandler, notFoundHandler } from './errors.js';

const app = express();
const port = Number(process.env.PORT ?? 8080);

// Parse JSON bodies, with a size limit so one request cannot exhaust memory.
app.use(express.json({ limit: '16kb' }));

app.get('/api/health', async (_req, res) => {
  const databaseUp = await isDatabaseReachable();
  res.status(databaseUp ? 200 : 503).json({
    status: databaseUp ? 'ok' : 'degraded',
    database: databaseUp ? 'ok' : 'unreachable',
  });
});

// Order matters. These must come last: the 404 catches anything no route
// matched, and the error handler must be registered after every route so that
// errors thrown in them reach it.
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
});

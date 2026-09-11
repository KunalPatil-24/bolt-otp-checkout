import express from 'express';

const app = express();
const port = Number(process.env.PORT ?? 8080);

/**
 * A health endpoint: a cheap, dependency-free way to ask "is this process
 * alive?". Hosting platforms poll something like this to decide whether a
 * deploy succeeded, so it is worth having from the very first commit.
 *
 * It will grow a database check once there is a database to check.
 */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
});

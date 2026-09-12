import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { isDatabaseReachable } from './db.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { authRouter } from './routes/auth.js';
import { ordersRouter } from './routes/orders.js';

const app = express();
const port = Number(process.env.PORT ?? 8080);

/**
 * How many proxy hops in front of this process to trust.
 *
 * The host terminates TLS at its own proxy and forwards over plain HTTP, so
 * without this Express believes every request is insecure and reports the
 * proxy's address as the client's.
 *
 * The number matters and 1 is wrong here. The observed chain in production is:
 *
 *     X-Forwarded-For: 103.94.57.240, 172.71.198.98, 10.26.235.3
 *                      client         CDN edge       host-internal
 *
 * Express treats the N rightmost entries as trusted and takes the next one as
 * the client. With N=1 that yields the host's own internal address, which is
 * different on every request -- so a per-IP rate limit gave each call its own
 * bucket and never triggered. With N=2 it yields the actual client.
 *
 * Counting from the right is also what makes this safe: a client that forges
 * its own X-Forwarded-For header only prepends to the list, and the real
 * address is still appended after it by the first proxy, so the count lands on
 * the same entry either way.
 *
 * This is coupled to the host's topology. If requests start being rate limited
 * as a group, or not at all, check that chain again before changing anything
 * else.
 */
const TRUSTED_PROXY_HOPS = 2;
app.set('trust proxy', TRUSTED_PROXY_HOPS);

/**
 * Browser origins permitted to call this API, comma-separated.
 *
 * The frontend is served from a different origin than the API -- a different
 * port locally, a different domain in production -- so every call from it is
 * cross-origin, and the browser will not hand the response to the page unless
 * this API names that origin.
 */
const webOrigins = (process.env.WEB_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * `credentials: true` is what allows the session cookie to travel with these
 * cross-origin requests. It also makes the allowlist mandatory: browsers reject
 * a wildcard origin once credentials are involved, which is a deliberate
 * protection -- otherwise any site on the internet could call this API carrying
 * a logged-in user's cookie and read the reply.
 *
 * The frontend must opt in as well, with credentials: 'include' on its fetch
 * calls. Both halves are required; either alone and the cookie is dropped
 * silently, with no error and no session.
 */
app.use(
  cors({
    origin(origin, callback) {
      // No Origin header means this is not a browser cross-origin request --
      // curl, a health check, a same-origin call -- so there is nothing to
      // grant.
      if (!origin) return callback(null, true);
      // Deny by not setting the header, rather than by raising an error: the
      // browser blocks the read either way, and a rejected origin is not a
      // server fault worth a 500.
      return callback(null, webOrigins.includes(origin));
    },
    credentials: true,
  }),
);

// Parse JSON bodies, with a size limit so one request cannot exhaust memory.
app.use(express.json({ limit: '16kb' }));

// Parses the Cookie header into req.cookies. Without this the session cookie
// arrives as a raw string nobody reads.
app.use(cookieParser());

app.get('/api/health', async (_req, res) => {
  const databaseUp = await isDatabaseReachable();
  res.status(databaseUp ? 200 : 503).json({
    status: databaseUp ? 'ok' : 'degraded',
    database: databaseUp ? 'ok' : 'unreachable',
  });
});

// TEMPORARY diagnostic: what does this process actually see as the client?
app.get('/api/_whoami', (req, res) => {
  res.json({
    reqIp: req.ip,
    reqIps: req.ips,
    xForwardedFor: req.headers['x-forwarded-for'] ?? null,
    trustProxySetting: app.get('trust proxy'),
  });
});

app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);

// Order matters. These must come last: the 404 catches anything no route
// matched, and the error handler must be registered after every route so that
// errors thrown in them reach it.
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port}`);
});

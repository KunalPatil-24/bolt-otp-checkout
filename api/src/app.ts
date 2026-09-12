/**
 * Builds the application: middleware, routes, error handling.
 *
 * Deliberately does not listen on a port -- index.ts does that. Keeping them
 * apart is what lets the tests exercise every route in-process.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { isDatabaseReachable } from './db.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { authRouter } from './routes/auth.js';
import { ordersRouter } from './routes/orders.js';

const app = express();

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
 * the client, so N is the number of entries to skip. N=1 yields the host's own
 * internal address and N=2 the CDN edge -- both of which vary between requests,
 * so a per-IP rate limit gave each call its own bucket and never triggered.
 * Three hops is what reaches the client.
 *
 * Counting from the right is also what makes this safe: a client that forges
 * its own X-Forwarded-For header only prepends to the list, and the real
 * address is still appended after it by the first proxy, so the count lands on
 * the same entry either way.
 *
 * This is coupled to the host's topology. The symptom of a wrong count is a
 * per-IP limit that never fires, because the resolved address differs on every
 * request -- which is exactly how this was found.
 *
 * The CDN in front of this also sets cf-connecting-ip and true-client-ip, either
 * of which carries the client address directly and would remove the dependence
 * on counting hops. They are not used because they are only trustworthy while
 * the origin cannot be reached except through that CDN -- an assumption about
 * the host that this service cannot verify.
 */
const TRUSTED_PROXY_HOPS = 3;
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

app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);

// Order matters. These must come last: the 404 catches anything no route
// matched, and the error handler must be registered after every route so that
// errors thrown in them reach it.
app.use(notFoundHandler);
app.use(errorHandler);

export { app };

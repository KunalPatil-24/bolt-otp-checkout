import { Router } from 'express';
import { isUniqueViolation, query, sql } from '../db.js';
import { ApiError } from '../errors.js';
import {
  equalizeVerificationTime,
  generateLoginCode,
  hashLoginCode,
  verifyLoginCode,
} from '../crypto.js';
import { createSession, destroySession, getSessionUser } from '../session.js';
import { isRateLimited } from '../rateLimit.js';
import { fieldErrors, loginSchema, recognizeSchema, registerSchema } from '../validation.js';
import { emailEnabled, sendLoginCode } from '../email.js';

export const authRouter = Router();

/** A user row as it leaves the API: camelCase, and never including the hash. */
type UserRow = { id: string; email: string; first_name: string; last_name: string };

const toPublicUser = (row: UserRow) => ({
  id: row.id,
  email: row.email,
  firstName: row.first_name,
  lastName: row.last_name,
});

/* ---------------------------------------------------------------------------
 * POST /api/auth/register
 *
 * Creates a user and returns their freshly generated 6-digit code.
 *
 * This response is the only moment the plaintext code exists outside the user's
 * own record of it. Only the bcrypt hash is stored, so there is deliberately no
 * endpoint that could show it again.
 * ------------------------------------------------------------------------- */
authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.badRequest(
      'Please correct the highlighted fields.',
      fieldErrors(parsed.error),
    );
  }

  const { email, firstName, lastName } = parsed.data;

  const loginCode = generateLoginCode();
  const loginCodeHash = await hashLoginCode(loginCode);

  try {
    // Deliberately no "does this email exist?" query first. Between such a
    // check and this insert, a concurrent request could insert the same
    // address -- a time-of-check-to-time-of-use race that no application code
    // can close, because the two statements are separate round trips.
    //
    // Instead the unique index on LOWER(email) is the authority, and we handle
    // the violation it raises. Correct under any concurrency, and one fewer
    // query in the common case.
    const { rows } = await query<UserRow>(sql`
      INSERT INTO users (email, first_name, last_name, login_code_hash)
           VALUES (${email}, ${firstName}, ${lastName}, ${loginCodeHash})
        RETURNING id, email, first_name, last_name
    `);

    // Best effort, and deliberately awaited only for its result rather than
    // its success: a mail outage or an unverified recipient must not turn a
    // completed registration into a failure. The code is in the response
    // either way, which is also what the assignment asks for.
    const delivery = await sendLoginCode(email, firstName, loginCode, 'registered');

    res.status(201).json({
      user: toPublicUser(rows[0]!),
      loginCode,
      emailed: delivery.sent,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw ApiError.conflict(
        'email_taken',
        'That email address is already registered.',
      );
    }
    throw error; // anything else is a bug; the error handler turns it into a 500
  }
});

/* ---------------------------------------------------------------------------
 * POST /api/auth/recognize
 *
 * Answers one question for the checkout form: is this email registered, and if
 * so, whose is it?
 *
 * POST rather than GET, despite this being a pure read. A GET would put the
 * email address in the URL, and URLs travel further than people expect: server
 * access logs kept for months, browser history, the Referer header sent to any
 * third-party script on the page, proxies, analytics. A request body appears in
 * none of those.
 *
 * The response includes the user's first name, so the login prompt can greet
 * them by it. That is a deliberate trade and worth stating plainly: the caller
 * has typed an email and proved nothing, so this hands a name to anyone willing
 * to guess addresses. It is the same trade most large retailers make, on the
 * grounds that recognising a returning customer by name is the point of the
 * feature -- and the rate limit below is what stops it being harvested in bulk.
 *
 * Only the first name is returned, never the surname or anything else.
 * ------------------------------------------------------------------------- */

/**
 * At most this many checks per IP per minute.
 *
 * Far above anything a human typing one address can reach, far below a useful
 * scraping rate. See rateLimit.ts for why the IP is the only thing available to
 * key on here, and why that is a speed bump rather than a guarantee.
 */
const RECOGNIZE_MAX_PER_MINUTE = 30;

authRouter.post('/recognize', async (req, res) => {
  // Checked before the query, so a caller past the limit costs nothing.
  // req.ip is the real client address rather than the proxy's because
  // `trust proxy` is set in index.ts.
  if (isRateLimited(`recognize:${req.ip}`, RECOGNIZE_MAX_PER_MINUTE, 60_000)) {
    throw ApiError.tooManyRequests('Too many requests. Please slow down.');
  }

  const parsed = recognizeSchema.safeParse(req.body);

  // A malformed address is answered "no" rather than rejected as a validation
  // error. This is a lookup, and "is 'asdf@' registered?" has a truthful
  // answer. The frontend calls this while the user is still typing, so an
  // incomplete address is an ordinary occurrence, not a fault.
  if (!parsed.success) {
    res.json({ recognized: false });
    return;
  }

  const { rows } = await query<{ first_name: string }>(sql`
    SELECT first_name FROM users WHERE LOWER(email) = ${parsed.data.email}
  `);

  const found = rows[0];
  res.json(found ? { recognized: true, firstName: found.first_name } : { recognized: false });
});

/**
 * Login rate limit: at most this many failed attempts per email per window.
 *
 * A 6-digit code is 10^6 possibilities; at 100 requests a second an attacker
 * expects to find one in under two hours. Five attempts per quarter hour turns
 * that into roughly 28 years.
 *
 * Keyed on the email and stored in Postgres, unlike the recognise limiter
 * above: guessing a code means hitting one address repeatedly, so counting per
 * address catches it exactly -- and being a real security control, it has to
 * survive a restart.
 */
const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

/* ---------------------------------------------------------------------------
 * POST /api/auth/login
 *
 * Verifies a code and starts a session.
 * ------------------------------------------------------------------------- */
authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.badRequest('Enter the 6-digit code.', fieldErrors(parsed.error));
  }

  const { email, code } = parsed.data;

  // Checked before any work is done, so a locked-out attacker cannot even make
  // us spend the ~100ms of bcrypt per guess -- otherwise the rate limit would
  // still leave a cheap way to burn the server's CPU.
  const { rows: counted } = await query<{ failures: number }>(sql`
    SELECT count(*)::int AS failures
      FROM login_attempts
     WHERE LOWER(email) = ${email}
       AND succeeded = false
       AND created_at > now() - (${WINDOW_MINUTES}::int * INTERVAL '1 minute')
  `);

  if ((counted[0]?.failures ?? 0) >= MAX_FAILURES) {
    // Note this locks out the correct code too. That is the point -- a limit
    // an attacker could step around by eventually guessing right would not be
    // a limit. The cost is that someone who knows an address can deliberately
    // lock its owner out for the window; keying on IP as well would reduce
    // that, at the expense of users behind shared NAT.
    throw ApiError.tooManyRequests(
      `Too many incorrect codes. Please try again in ${WINDOW_MINUTES} minutes.`,
    );
  }

  const { rows } = await query<UserRow & { login_code_hash: string }>(sql`
    SELECT id, email, first_name, last_name, login_code_hash
      FROM users
     WHERE LOWER(email) = ${email}
  `);
  const user = rows[0];

  let success = false;
  if (user) {
    success = await verifyLoginCode(code, user.login_code_hash);
  } else {
    // Spend the same time we would have spent verifying, so that response
    // latency does not distinguish a real account from an unknown one.
    await equalizeVerificationTime();
  }

  // Recorded either way: successes make the log a usable audit trail, and only
  // failures count toward the limit.
  await query(sql`
    INSERT INTO login_attempts (email, succeeded) VALUES (${email}, ${success})
  `);

  if (!user || !success) {
    // One message for both "no such account" and "wrong code". Telling them
    // apart would confirm which addresses are registered -- and while
    // /recognize already reveals exactly that, it does so because the product
    // requires it. Leaking it a second time, where nothing requires it, would
    // be gratuitous.
    throw ApiError.unauthorized('invalid_code', 'That code is not correct.');
  }

  await createSession(user.id, res);
  res.json({ user: toPublicUser(user) });
});

/* ---------------------------------------------------------------------------
 * GET /api/auth/me
 *
 * Reports who is signed in, or null.
 *
 * The frontend needs this because the session lives in an httpOnly cookie,
 * which JavaScript cannot read by design. On a page load React knows nothing --
 * its state was wiped by the refresh while the cookie survived -- so asking the
 * server is the only way to find out.
 *
 * Returns 200 with null rather than 401 when nobody is signed in. Not being
 * logged in is not an error here: this app supports guest checkout, so "nobody"
 * is a legitimate and expected answer to "who is this?".
 * ------------------------------------------------------------------------- */
authRouter.get('/me', async (req, res) => {
  const user = await getSessionUser(req);
  res.json({ user });
});

/* ---------------------------------------------------------------------------
 * POST /api/auth/logout
 *
 * Ends the session. Idempotent -- logging out when already logged out is a
 * no-op, not an error, so a stale tab clicking sign-out gets a clean response.
 *
 * POST rather than GET because it changes state. A GET would be fetched by
 * link prefetchers and crawlers, which would log people out by accident.
 * ------------------------------------------------------------------------- */
authRouter.post('/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

/**
 * Code recovery limits. Kept tight because rotating a code is destructive: the
 * previous one stops working immediately.
 */
const REQUEST_CODE_MAX_PER_EMAIL = 3;
const REQUEST_CODE_MAX_PER_IP = 8;
const REQUEST_CODE_WINDOW_MS = 60 * 60 * 1000;

/* ---------------------------------------------------------------------------
 * POST /api/auth/request-code
 *
 * Issues a replacement code and emails it.
 *
 * Without this there is no account recovery at all: the code is displayed once
 * and stored only as a hash, so losing it means losing the account permanently.
 *
 * Note it issues a NEW code rather than resending the old one, and that is not
 * a choice -- only the hash is stored, so the original is genuinely
 * unrecoverable. Hashing costs the ability to resend, which is the right trade
 * and worth knowing is a trade.
 *
 * The response is identical whether or not the address is registered. Saying
 * "no such account" here would turn recovery into a membership oracle, and
 * /recognize already reveals that only because the product requires it.
 *
 * The trade-off worth stating: because a replacement immediately invalidates
 * the previous code, anyone who knows an address can rotate a stranger's code
 * and break the one they had written down. They gain nothing -- the new code
 * goes to the owner's inbox -- but it is a nuisance, which is why the per-email
 * limit is low. A production system would send a one-time link that only
 * replaces the code when followed, so an ignored request changes nothing.
 * ------------------------------------------------------------------------- */
authRouter.post('/request-code', async (req, res) => {
  const parsed = recognizeSchema.safeParse(req.body);

  // Generic response for everything: a malformed address, an unknown one, and a
  // real one all look the same from outside.
  const acknowledge = () =>
    res.json({
      ok: true,
      message: 'If that address is registered, a new code is on its way.',
    });

  if (!emailEnabled) {
    // Rotating a code we cannot then deliver would lock the user out for good.
    throw new ApiError(503, 'email_unavailable', 'Code recovery is not available.');
  }

  if (!parsed.success) {
    acknowledge();
    return;
  }

  const { email } = parsed.data;

  if (
    isRateLimited(`request-code:ip:${req.ip}`, REQUEST_CODE_MAX_PER_IP, REQUEST_CODE_WINDOW_MS) ||
    isRateLimited(`request-code:email:${email}`, REQUEST_CODE_MAX_PER_EMAIL, REQUEST_CODE_WINDOW_MS)
  ) {
    throw ApiError.tooManyRequests('Too many requests. Please try again later.');
  }

  const { rows } = await query<{ id: string; first_name: string }>(sql`
    SELECT id, first_name FROM users WHERE LOWER(email) = ${email}
  `);
  const user = rows[0];

  if (!user) {
    // Spend roughly the time a real rotation costs, so the response time does
    // not answer the question the response body refuses to.
    await equalizeVerificationTime();
    acknowledge();
    return;
  }

  const replacement = generateLoginCode();
  await query(sql`
    UPDATE users SET login_code_hash = ${await hashLoginCode(replacement)}
     WHERE id = ${user.id}
  `);

  await sendLoginCode(email, user.first_name, replacement, 'replacement');
  acknowledge();
});

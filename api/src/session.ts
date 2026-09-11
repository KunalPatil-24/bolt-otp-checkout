import type { Response } from 'express';
import { query, sql } from './db.js';
import { generateSessionToken, hashSessionToken } from './crypto.js';

export const SESSION_COOKIE = 'bolt_session';

/**
 * How long a login lasts. Absolute, not sliding: seven days from when it was
 * issued, full stop.
 *
 * Sliding expiry -- pushing the deadline out on every request -- is friendlier
 * to an active user, but it also means a stolen token can be kept alive
 * indefinitely simply by using it. Absolute expiry puts a hard ceiling on how
 * long a leaked token is worth anything.
 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Cookie attributes, defined once so the set and clear paths cannot drift
 * apart -- a cookie is only removable by a response whose attributes match the
 * ones it was set with.
 *
 * httpOnly: JavaScript cannot read this cookie, so a cross-site scripting bug
 *   cannot steal the session. This is the main reason for using a cookie rather
 *   than localStorage, which any script on the page can read.
 *
 * secure: HTTPS only, so the token is never sent in clear text. Off in
 *   development, where there is no TLS on localhost.
 *
 * sameSite: in production the frontend and API are on different domains, which
 *   makes every API call cross-site. Browsers only attach a cookie to a
 *   cross-site request when it is SameSite=None, and only accept SameSite=None
 *   when it is also Secure. Locally both sides are localhost, so the stricter
 *   Lax applies.
 *
 *   The trade-off worth stating: SameSite=None gives up the browser's built-in
 *   CSRF protection. A production system needs CSRF tokens on state-changing
 *   routes to compensate.
 */
function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? ('none' as const) : ('lax' as const),
    path: '/',
  };
}

/**
 * Issues a session for a user and sets the cookie on the response.
 *
 * Only the raw token goes to the browser; only its hash is written to the
 * database. Neither side holds both.
 */
export async function createSession(userId: string, res: Response): Promise<void> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await query(sql`
    INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES (${userId}, ${hashSessionToken(token)}, ${expiresAt})
  `);

  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_TTL_MS });
}

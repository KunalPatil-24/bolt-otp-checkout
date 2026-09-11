import type { Request, Response } from 'express';
import { query, sql } from './db.js';
import { generateSessionToken, hashSessionToken } from './crypto.js';

/** A signed-in user, as the rest of the app sees them. */
export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
};

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

/**
 * Resolves the signed-in user for a request, or null if there is none.
 *
 * The browser sends a token; we hash it and look for that hash. The raw token
 * is never stored, so this is the only way the lookup can work -- and it means
 * a stolen database still yields nothing usable.
 *
 * Two details worth noting:
 *
 * - The expiry check is `expires_at > now()` in SQL rather than a comparison in
 *   JavaScript, so it is evaluated against the database clock. Server and
 *   database clocks drift, and an expired session must never be returned
 *   because one machine is a few seconds behind.
 * - The JOIN fetches the user in the same round trip. Looking up the session
 *   and then the user would be two queries on every authenticated request.
 */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token === '') return null;

  const { rows } = await query<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
  }>(sql`
    SELECT u.id, u.email, u.first_name, u.last_name
      FROM sessions s
      JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ${hashSessionToken(token)}
       AND s.expires_at > now()
  `);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
  };
}

/**
 * Ends a session: deletes the row, then clears the cookie.
 *
 * Both halves matter, and the order of importance is the opposite of what it
 * looks like. Clearing the cookie only tells this one browser to forget the
 * token. Deleting the row is what actually revokes it -- without that, a token
 * captured earlier would still work, and "log out" would be a suggestion rather
 * than a guarantee. This is the concrete benefit of storing sessions as rows
 * instead of using a self-contained token.
 *
 * clearCookie must be given the same attributes the cookie was set with, or the
 * browser treats it as a different cookie and leaves the original in place --
 * which is why those options are defined in one function above.
 */
export async function destroySession(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string' && token !== '') {
    await query(sql`DELETE FROM sessions WHERE token_hash = ${hashSessionToken(token)}`);
  }
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

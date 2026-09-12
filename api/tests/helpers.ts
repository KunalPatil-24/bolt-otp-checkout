import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetRateLimits } from '../src/rateLimit.js';
import { clearRecordedEmails } from '../src/email.js';

/**
 * Drives the app in-process. No port is bound, no server is started, and
 * nothing has to be torn down -- supertest hands the request straight to the
 * Express app. That is what the app.ts / index.ts split buys.
 */
export const api = () => request(app);

/** Like api(), but keeps cookies across requests, so a session persists. */
export const agent = () => request.agent(app);

/**
 * Returns the database to a known state.
 *
 * Truncating rather than deleting and recreating keeps it fast, and RESTART
 * IDENTITY resets the login_attempts sequence so ids do not drift across runs.
 * Rate limit buckets are process state rather than database state, so they have
 * to be cleared separately or one test's requests count against the next.
 */
export async function resetDatabase(): Promise<void> {
  await pool.query('TRUNCATE orders, sessions, login_attempts, users RESTART IDENTITY CASCADE');
  resetRateLimits();
  clearRecordedEmails();
}

/** Node runs each test file in its own process; each must release the pool. */
export async function closePool(): Promise<void> {
  await pool.end();
}

/** Registers a user and returns the code, which is only ever visible here. */
export async function registerUser(
  email: string,
  firstName = 'Test',
  lastName = 'User',
): Promise<{ userId: string; code: string }> {
  const response = await api()
    .post('/api/auth/register')
    .send({ email, firstName, lastName })
    .expect(201);
  return { userId: response.body.user.id, code: response.body.loginCode };
}

/** Registers, logs in, and returns an agent carrying the session cookie. */
export async function signedInAgent(email: string, firstName = 'Test') {
  const { code } = await registerUser(email, firstName);
  const signedIn = agent();
  await signedIn.post('/api/auth/login').send({ email, code }).expect(200);
  return signedIn;
}

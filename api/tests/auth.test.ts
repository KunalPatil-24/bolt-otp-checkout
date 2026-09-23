import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, agent, closePool, registerUser, resetDatabase } from './helpers.js';
import { recordedEmails, setEmailFailure } from '../src/email.js';
import { pool } from '../src/db.js';

beforeEach(resetDatabase);
after(closePool);

describe('POST /api/auth/register', () => {
  test('creates a user and returns a 6-digit code', async () => {
    const response = await api()
      .post('/api/auth/register')
      .send({ email: 'alice@example.com', firstName: 'Alice', lastName: 'Nguyen' })
      .expect(201);

    assert.match(response.body.loginCode, /^\d{6}$/);
    assert.equal(response.body.user.email, 'alice@example.com');
    assert.equal(response.body.user.firstName, 'Alice');
  });

  test('normalises the email: trims and lowercases', async () => {
    const response = await api()
      .post('/api/auth/register')
      .send({ email: '  Alice@Example.COM  ', firstName: ' Alice ', lastName: 'Nguyen' })
      .expect(201);

    assert.equal(response.body.user.email, 'alice@example.com');
    assert.equal(response.body.user.firstName, 'Alice');
  });

  test('never stores the code in plaintext', async () => {
    const { code } = await registerUser('alice@example.com');
    const { rows } = await pool.query('SELECT login_code_hash FROM users');

    assert.notEqual(rows[0].login_code_hash, code);
    // bcrypt hashes are identifiable by their prefix and length.
    assert.match(rows[0].login_code_hash, /^\$2[aby]\$\d{2}\$/);
    assert.equal(rows[0].login_code_hash.length, 60);
  });

  test('rejects a duplicate email regardless of casing', async () => {
    await registerUser('alice@example.com');
    const response = await api()
      .post('/api/auth/register')
      .send({ email: 'ALICE@Example.com', firstName: 'Alice', lastName: 'Nguyen' })
      .expect(409);

    assert.equal(response.body.error, 'email_taken');
  });

  test('concurrent registrations of one email produce exactly one user', async () => {
    // The real point of letting the unique index arbitrate rather than checking
    // first: a check-then-insert has a gap that this would fall through.
    const attempts = Array.from({ length: 10 }, () =>
      api()
        .post('/api/auth/register')
        .send({ email: 'race@example.com', firstName: 'Race', lastName: 'Condition' }),
    );

    const results = await Promise.all(attempts);
    const created = results.filter((r) => r.status === 201);
    const conflicted = results.filter((r) => r.status === 409);

    assert.equal(created.length, 1, 'exactly one request should succeed');
    assert.equal(conflicted.length, 9);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
    assert.equal(rows[0].n, 1);
  });

  test('reports every invalid field at once', async () => {
    const response = await api()
      .post('/api/auth/register')
      .send({ email: 'not-an-email', firstName: '', lastName: '' })
      .expect(400);

    assert.equal(response.body.error, 'validation_error');
    assert.deepEqual(
      Object.keys(response.body.fields).sort(),
      ['email', 'firstName', 'lastName'],
    );
  });
});

describe('POST /api/auth/recognize', () => {
  test('recognises a registered email in any casing, and returns the first name', async () => {
    await registerUser('alice@example.com', 'Alice');

    for (const email of ['alice@example.com', 'ALICE@EXAMPLE.COM', ' Alice@Example.com ']) {
      const response = await api().post('/api/auth/recognize').send({ email }).expect(200);
      assert.equal(response.body.recognized, true, email);
      assert.equal(response.body.firstName, 'Alice');
    }
  });

  test('does not recognise an unknown email, and returns no name', async () => {
    const response = await api()
      .post('/api/auth/recognize')
      .send({ email: 'nobody@example.com' })
      .expect(200);

    assert.equal(response.body.recognized, false);
    assert.equal(response.body.firstName, undefined);
  });

  test('never returns the surname', async () => {
    await registerUser('alice@example.com', 'Alice', 'Nguyen');
    const response = await api()
      .post('/api/auth/recognize')
      .send({ email: 'alice@example.com' })
      .expect(200);

    assert.deepEqual(Object.keys(response.body).sort(), ['firstName', 'recognized']);
  });

  test('answers "no" to a half-typed address rather than erroring', async () => {
    // The frontend calls this while the user types, so an incomplete address is
    // an ordinary occurrence and must not be a 400.
    for (const email of ['alice@', 'asdf', '']) {
      const response = await api().post('/api/auth/recognize').send({ email }).expect(200);
      assert.equal(response.body.recognized, false);
    }
  });

  test('rate limits by caller after 30 checks in a minute', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) {
      const response = await api().post('/api/auth/recognize').send({ email: 'x@example.com' });
      statuses.push(response.status);
    }

    assert.equal(statuses.filter((s) => s === 200).length, 30);
    assert.equal(statuses.filter((s) => s === 429).length, 5);
  });
});

describe('POST /api/auth/login', () => {
  test('signs in with the correct code and sets an httpOnly cookie', async () => {
    const { code } = await registerUser('alice@example.com', 'Alice');

    const response = await api()
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', code })
      .expect(200);

    assert.equal(response.body.user.firstName, 'Alice');

    const cookie = response.headers['set-cookie'][0];
    assert.match(cookie, /bolt_session=/);
    assert.match(cookie, /HttpOnly/);
  });

  test('stores only a hash of the session token, never the token', async () => {
    const { code } = await registerUser('alice@example.com');
    const response = await api()
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', code })
      .expect(200);

    const token = /bolt_session=([^;]+)/.exec(response.headers['set-cookie'][0])![1];
    const { rows } = await pool.query('SELECT token_hash FROM sessions');

    assert.notEqual(rows[0].token_hash, token);
    assert.equal(rows[0].token_hash.length, 64); // sha-256, hex
  });

  test('an unknown email and a wrong code are indistinguishable', async () => {
    await registerUser('alice@example.com');

    const wrongCode = await api()
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', code: '000000' });
    const unknownEmail = await api()
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', code: '000000' });

    assert.equal(wrongCode.status, unknownEmail.status);
    assert.deepEqual(wrongCode.body, unknownEmail.body);
  });

  test('locks out after 5 failures, refusing even the correct code', async () => {
    const { code } = await registerUser('alice@example.com');

    for (let i = 0; i < 5; i++) {
      await api()
        .post('/api/auth/login')
        .send({ email: 'alice@example.com', code: '000000' })
        .expect(401);
    }

    const sixth = await api()
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', code: '000000' })
      .expect(429);
    assert.equal(sixth.body.error, 'too_many_attempts');

    // The real code is refused too. A limit that can be outlasted by
    // eventually guessing right is not a limit.
    await api().post('/api/auth/login').send({ email: 'alice@example.com', code }).expect(429);
  });

  test('records attempts for the audit trail', async () => {
    const { code } = await registerUser('alice@example.com');
    await api().post('/api/auth/login').send({ email: 'alice@example.com', code: '000000' });
    await api().post('/api/auth/login').send({ email: 'alice@example.com', code });

    const { rows } = await pool.query(
      'SELECT succeeded, count(*)::int AS n FROM login_attempts GROUP BY succeeded ORDER BY succeeded',
    );
    assert.deepEqual(rows, [
      { succeeded: false, n: 1 },
      { succeeded: true, n: 1 },
    ]);
  });
});

describe('session lifecycle', () => {
  test('/me reports null for an anonymous caller, not 401', async () => {
    // Guest checkout is supported, so "nobody" is a legitimate answer.
    const response = await api().get('/api/auth/me').expect(200);
    assert.equal(response.body.user, null);
  });

  test('/me identifies the user from the cookie alone', async () => {
    const { code } = await registerUser('alice@example.com', 'Alice');
    const signedIn = agent();
    await signedIn.post('/api/auth/login').send({ email: 'alice@example.com', code });

    const response = await signedIn.get('/api/auth/me').expect(200);
    assert.equal(response.body.user.firstName, 'Alice');
  });

  test('a forged cookie resolves to nobody', async () => {
    const response = await api()
      .get('/api/auth/me')
      .set('Cookie', 'bolt_session=not-a-real-token')
      .expect(200);
    assert.equal(response.body.user, null);
  });

  test('an expired session does not authenticate, even though the row exists', async () => {
    const { code } = await registerUser('alice@example.com');
    const signedIn = agent();
    await signedIn.post('/api/auth/login').send({ email: 'alice@example.com', code });

    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 hour'");

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM sessions');
    assert.equal(rows[0].n, 1, 'the row is still there');

    const response = await signedIn.get('/api/auth/me').expect(200);
    assert.equal(response.body.user, null);
  });

  test('logout deletes the session row, so a captured token stops working', async () => {
    const { code } = await registerUser('alice@example.com');
    const login = await api()
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', code })
      .expect(200);
    const cookie = login.headers['set-cookie'][0].split(';')[0];

    await api().get('/api/auth/me').set('Cookie', cookie).expect(200);
    await api().post('/api/auth/logout').set('Cookie', cookie).expect(200);

    // This is what session rows buy over a self-contained token: real revocation.
    const after = await api().get('/api/auth/me').set('Cookie', cookie).expect(200);
    assert.equal(after.body.user, null);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM sessions');
    assert.equal(rows[0].n, 0);
  });
});

describe('POST /api/auth/request-code', () => {
  test('emails a new code to a registered address', async () => {
    await registerUser('alice@example.com', 'Alice');
    clearSent();

    await api()
      .post('/api/auth/request-code')
      .send({ email: 'alice@example.com' })
      .expect(200);

    assert.equal(recordedEmails.length, 1);
    assert.equal(recordedEmails[0]!.to, 'alice@example.com');
    assert.equal(recordedEmails[0]!.purpose, 'replacement');
    assert.match(recordedEmails[0]!.code, /^\d{6}$/);
  });

  test('the new code works and the old one stops working', async () => {
    const { code: original } = await registerUser('alice@example.com');
    clearSent();

    await api().post('/api/auth/request-code').send({ email: 'alice@example.com' }).expect(200);
    const replacement = recordedEmails[0]!.code;
    assert.notEqual(replacement, original);

    await api()
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', code: original })
      .expect(401);

    await api()
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', code: replacement })
      .expect(200);
  });

  test('an unknown address gets an identical response, and no email', async () => {
    await registerUser('alice@example.com');
    clearSent();

    const known = await api()
      .post('/api/auth/request-code')
      .send({ email: 'alice@example.com' })
      .expect(200);
    const unknown = await api()
      .post('/api/auth/request-code')
      .send({ email: 'ghost@example.com' })
      .expect(200);

    // Identical to the caller; nothing reveals which address exists.
    assert.deepEqual(known.body, unknown.body);
    assert.equal(recordedEmails.length, 1);
    assert.equal(recordedEmails[0]!.to, 'alice@example.com');
  });

  test('a failed send leaves the existing code working', async () => {
    // The case that matters most: rotating first and mailing second would
    // destroy a code the user still had and replace it with one that never
    // arrives.
    const { code: original } = await registerUser('alice@example.com');
    setEmailFailure(true);

    const response = await api()
      .post('/api/auth/request-code')
      .send({ email: 'alice@example.com' })
      .expect(502);

    // Said plainly, not "a new code is on its way" for an email never sent.
    assert.equal(response.body.error, 'email_failed');

    setEmailFailure(false);
    await api()
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', code: original })
      .expect(200);
  });

  test('rate limits repeated requests for one address', async () => {
    await registerUser('alice@example.com');

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const response = await api()
        .post('/api/auth/request-code')
        .send({ email: 'alice@example.com' });
      statuses.push(response.status);
    }

    // Without a limit, anyone could keep rotating a stranger's code forever.
    assert.ok(statuses.includes(429), `expected a 429, got ${statuses.join(',')}`);
  });
});

function clearSent() {
  recordedEmails.length = 0;
}

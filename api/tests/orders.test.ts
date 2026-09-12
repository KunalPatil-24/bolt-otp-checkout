import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, closePool, registerUser, resetDatabase, signedInAgent } from './helpers.js';
import { pool } from '../src/db.js';

beforeEach(resetDatabase);
after(closePool);

const validOrder = {
  email: 'buyer@example.com',
  phone: '+91 98765 43210',
  addressLine1: '12 MG Road',
  addressLine2: 'Flat 4B',
  city: 'Pune',
  state: 'MH',
  postalCode: '411001',
  country: 'India',
};

describe('POST /api/orders', () => {
  test('accepts a guest order and stores it with no user', async () => {
    // Skipping login is part of the flow, so this is a success case.
    const response = await api().post('/api/orders').send(validOrder).expect(201);
    assert.equal(response.body.linkedToAccount, false);

    const { rows } = await pool.query('SELECT user_id FROM orders');
    assert.equal(rows[0].user_id, null);
  });

  test('links an order to the signed-in user', async () => {
    const signedIn = await signedInAgent('alice@example.com', 'Alice');
    const response = await signedIn.post('/api/orders').send(validOrder).expect(201);
    assert.equal(response.body.linkedToAccount, true);

    const { rows } = await pool.query(
      'SELECT u.first_name FROM orders o JOIN users u ON u.id = o.user_id',
    );
    assert.equal(rows[0].first_name, 'Alice');
  });

  test('ignores a user_id sent in the body', async () => {
    // The single most important property of this endpoint: the body is a claim,
    // the cookie is proof. Anyone could type someone else's id into the JSON.
    const { userId } = await registerUser('victim@example.com');

    const response = await api()
      .post('/api/orders')
      .send({ ...validOrder, user_id: userId, userId })
      .expect(201);

    assert.equal(response.body.linkedToAccount, false);

    const { rows } = await pool.query('SELECT user_id FROM orders');
    assert.equal(rows[0].user_id, null, 'the forged id must not be honoured');
  });

  test('stores an omitted second address line as NULL, not an empty string', async () => {
    const { addressLine2, ...withoutLine2 } = validOrder;
    void addressLine2;
    await api().post('/api/orders').send(withoutLine2).expect(201);

    const { rows } = await pool.query('SELECT address_line2 FROM orders');
    assert.equal(rows[0].address_line2, null);
  });

  test('reports every invalid field at once', async () => {
    const response = await api()
      .post('/api/orders')
      .send({ ...validOrder, email: 'nope', phone: 'abc', addressLine1: '', city: '' })
      .expect(400);

    assert.deepEqual(
      Object.keys(response.body.fields).sort(),
      ['addressLine1', 'city', 'email', 'phone'],
    );
  });

  test('accepts international phone formats', async () => {
    for (const phone of ['+44 20 7946 0958', '(415) 555-0134', '09012345678']) {
      await api().post('/api/orders').send({ ...validOrder, phone }).expect(201);
    }
  });

  test('rejects a phone number with too few digits', async () => {
    await api().post('/api/orders').send({ ...validOrder, phone: '12345' }).expect(400);
  });

  test('stores an injection payload as literal text', async () => {
    const payload = "1 Main St'); DROP TABLE orders; --";
    await api().post('/api/orders').send({ ...validOrder, addressLine1: payload }).expect(201);

    const { rows } = await pool.query('SELECT address_line1 FROM orders');
    assert.equal(rows[0].address_line1, payload);

    // The table is obviously still there if this query succeeds at all.
    const { rows: counted } = await pool.query('SELECT count(*)::int AS n FROM orders');
    assert.equal(counted[0].n, 1);
  });
});

describe('GET /api/orders', () => {
  test('requires a session', async () => {
    await api().get('/api/orders').expect(401);
  });

  test('returns only the signed-in user’s orders, newest first', async () => {
    const alice = await signedInAgent('alice@example.com', 'Alice');
    const bob = await signedInAgent('bob@example.com', 'Bob');

    await alice.post('/api/orders').send({ ...validOrder, city: 'Pune' }).expect(201);
    await alice.post('/api/orders').send({ ...validOrder, city: 'Mumbai' }).expect(201);
    await bob.post('/api/orders').send({ ...validOrder, city: 'Delhi' }).expect(201);
    await api().post('/api/orders').send({ ...validOrder, city: 'Chennai' }).expect(201);

    const response = await alice.get('/api/orders').expect(200);

    assert.equal(response.body.orders.length, 2);
    assert.deepEqual(
      response.body.orders.map((o: { city: string }) => o.city),
      ['Mumbai', 'Pune'],
    );
  });
});

describe('GET /api/orders/latest-address', () => {
  test('requires a session', async () => {
    await api().get('/api/orders/latest-address').expect(401);
  });

  test('returns null when the user has never ordered', async () => {
    const signedIn = await signedInAgent('new@example.com');
    const response = await signedIn.get('/api/orders/latest-address').expect(200);
    assert.equal(response.body.address, null);
  });

  test('returns the most recent address, not the first', async () => {
    const signedIn = await signedInAgent('alice@example.com');
    await signedIn.post('/api/orders').send({ ...validOrder, city: 'Pune' }).expect(201);
    await signedIn.post('/api/orders').send({ ...validOrder, city: 'Mumbai' }).expect(201);

    const response = await signedIn.get('/api/orders/latest-address').expect(200);
    assert.equal(response.body.address.city, 'Mumbai');
    assert.equal(response.body.address.addressLine1, validOrder.addressLine1);
  });

  test('never returns another user\'s address', async () => {
    const alice = await signedInAgent('alice@example.com');
    const bob = await signedInAgent('bob@example.com');
    await bob.post('/api/orders').send({ ...validOrder, city: 'Delhi' }).expect(201);

    // Alice has ordered nothing, so she must see nothing -- not Bob's address.
    const response = await alice.get('/api/orders/latest-address').expect(200);
    assert.equal(response.body.address, null);
  });

  test('ignores guest orders placed with the same email', async () => {
    // A guest order has no user_id, so it belongs to nobody and must not be
    // offered back to an account that happens to share the email.
    const signedIn = await signedInAgent('alice@example.com');
    await api()
      .post('/api/orders')
      .send({ ...validOrder, email: 'alice@example.com', city: 'GuestCity' })
      .expect(201);

    const response = await signedIn.get('/api/orders/latest-address').expect(200);
    assert.equal(response.body.address, null);
  });
});

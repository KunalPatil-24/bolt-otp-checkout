import { Router } from 'express';
import { query, sql } from '../db.js';
import { ApiError } from '../errors.js';
import { getSessionUser } from '../session.js';
import { fieldErrors, orderSchema } from '../validation.js';

export const ordersRouter = Router();

/* ---------------------------------------------------------------------------
 * POST /api/orders
 *
 * Records a checkout submission. No payment processing, as the assignment
 * specifies -- the row in the database is the deliverable.
 *
 * Deliberately not behind an authentication check. The flow explicitly allows
 * skipping the login step, so an order with no account attached is an expected
 * outcome rather than a failure, and orders.user_id is nullable to say so.
 * ------------------------------------------------------------------------- */
ordersRouter.post('/', async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    throw ApiError.badRequest(
      'Please correct the highlighted fields.',
      fieldErrors(parsed.error),
    );
  }

  const order = parsed.data;

  // The buyer's identity comes from the session cookie and nowhere else.
  //
  // This is the single most important line in the file. If user_id were taken
  // from the request body, anyone could attribute an order to any account by
  // editing the JSON -- the client would be asserting who it is rather than
  // proving it. The cookie is proof because it maps to a row we issued;
  // the body is just a claim. Note that orderSchema has no user_id field at
  // all, so one sent in the body is discarded before this point.
  const user = await getSessionUser(req);

  const { rows } = await query<{ id: string; created_at: Date }>(sql`
    INSERT INTO orders
           (user_id, email, phone, address_line1, address_line2,
            city, state, postal_code, country)
    VALUES (${user?.id ?? null}, ${order.email}, ${order.phone},
            ${order.addressLine1}, ${order.addressLine2 || null},
            ${order.city}, ${order.state}, ${order.postalCode}, ${order.country})
 RETURNING id, created_at
  `);

  res.status(201).json({
    orderId: rows[0]!.id,
    createdAt: rows[0]!.created_at,
    linkedToAccount: user !== null,
  });
});

type OrderRow = {
  id: string;
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  created_at: Date;
};

const toPublicOrder = (row: OrderRow) => ({
  id: row.id,
  email: row.email,
  phone: row.phone,
  addressLine1: row.address_line1,
  addressLine2: row.address_line2,
  city: row.city,
  state: row.state,
  postalCode: row.postal_code,
  country: row.country,
  createdAt: row.created_at,
});

/* ---------------------------------------------------------------------------
 * GET /api/orders
 *
 * The signed-in user's own orders, newest first.
 *
 * Unlike the POST above, this one does require a session -- there is no
 * sensible anonymous answer to "show me my orders", and returning an empty list
 * to a signed-out caller would hide the reason.
 *
 * The filter is on the session's user id, never on anything the caller sends.
 * An endpoint that took an id from the query string would let anyone read
 * anyone else's order history by changing a number in the URL, which is among
 * the most common real-world data leaks.
 *
 * Guest orders are unreachable here by construction: they have no user_id, so
 * they match no one. That is the honest consequence of allowing checkout
 * without an account.
 * ------------------------------------------------------------------------- */
ordersRouter.get('/', async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) {
    throw ApiError.unauthorized('not_signed_in', 'Sign in to see your orders.');
  }

  const { rows } = await query<OrderRow>(sql`
    SELECT id, email, phone, address_line1, address_line2,
           city, state, postal_code, country, created_at
      FROM orders
     WHERE user_id = ${user.id}
     ORDER BY created_at DESC
  `);

  res.json({ orders: rows.map(toPublicOrder) });
});

/* ---------------------------------------------------------------------------
 * GET /api/orders/latest-address
 *
 * The address this user last shipped to, or null.
 *
 * Its own endpoint rather than reading the first item from the order history,
 * because the checkout form wants one address and that would fetch every order
 * the user has ever placed to get it. LIMIT 1 also lets the database stop at
 * the first row instead of sorting the whole set.
 *
 * Only columns the form can use are selected: the email is not among them,
 * because the account's address should not quietly change the contact address
 * on a new order.
 *
 * Guest orders cannot appear here. They carry no user_id, so they match no one
 * -- even one placed with this user's email address, which is deliberate: a
 * guest order is not proof that whoever placed it owns the account.
 * ------------------------------------------------------------------------- */
ordersRouter.get('/latest-address', async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) {
    throw ApiError.unauthorized('not_signed_in', 'Sign in to use a saved address.');
  }

  const { rows } = await query<Omit<OrderRow, 'id' | 'email' | 'created_at'>>(sql`
    SELECT phone, address_line1, address_line2,
           city, state, postal_code, country
      FROM orders
     WHERE user_id = ${user.id}
     ORDER BY created_at DESC
     LIMIT 1
  `);

  const row = rows[0];
  res.json({
    address: row
      ? {
          phone: row.phone,
          addressLine1: row.address_line1,
          addressLine2: row.address_line2,
          city: row.city,
          state: row.state,
          postalCode: row.postal_code,
          country: row.country,
        }
      : null,
  });
});

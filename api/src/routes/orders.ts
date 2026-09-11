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

import { Router } from 'express';
import { isUniqueViolation, query, sql } from '../db.js';
import { ApiError } from '../errors.js';
import { generateLoginCode, hashLoginCode } from '../crypto.js';
import { fieldErrors, registerSchema } from '../validation.js';

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

    res.status(201).json({ user: toPublicUser(rows[0]!), loginCode });
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

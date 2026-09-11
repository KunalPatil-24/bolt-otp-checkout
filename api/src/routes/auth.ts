import { Router } from 'express';
import { isUniqueViolation, query, sql } from '../db.js';
import { ApiError } from '../errors.js';
import { generateLoginCode, hashLoginCode } from '../crypto.js';
import { fieldErrors, recognizeSchema, registerSchema } from '../validation.js';

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

/* ---------------------------------------------------------------------------
 * POST /api/auth/recognize
 *
 * Answers one question for the checkout form: is this email registered?
 *
 * POST rather than GET, despite this being a pure read. A GET would put the
 * email address in the URL, and URLs travel further than people expect: server
 * access logs kept for months, browser history, the Referer header sent to any
 * third-party script on the page, proxies, analytics. A request body appears in
 * none of those. The cost is a semantically inaccurate verb and a cached CORS
 * preflight, both of which are cheaper than permanently logging real people's
 * email addresses.
 *
 * The response is a bare boolean and deliberately carries no name. The caller
 * has typed an email and proved nothing, so returning a name would let anyone
 * with a list of addresses turn it into a list of names matched to addresses --
 * exactly what makes a phishing mail convincing. The name is revealed only
 * after the code is verified.
 *
 * This endpoint does inherently reveal whether an address is registered. That
 * cannot be avoided: it is the feature the flow is built on. What it can do is
 * reveal nothing further.
 * ------------------------------------------------------------------------- */
authRouter.post('/recognize', async (req, res) => {
  const parsed = recognizeSchema.safeParse(req.body);

  // A malformed address is answered "no" rather than rejected as a validation
  // error. This is a lookup, and "is 'asdf@' registered?" has a truthful
  // answer. The frontend calls this while the user is still typing, so an
  // incomplete address is an ordinary occurrence, not a fault.
  if (!parsed.success) {
    res.json({ recognized: false });
    return;
  }

  // SELECT 1, not SELECT *: we need to know whether a row exists, not what is
  // in it. Fetching the row would pull the stored code hash into application
  // memory for no reason.
  const { rows } = await query(sql`
    SELECT 1 FROM users WHERE LOWER(email) = ${parsed.data.email}
  `);

  res.json({ recognized: rows.length > 0 });
});

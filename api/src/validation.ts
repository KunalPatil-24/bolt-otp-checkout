import { z } from 'zod';

/**
 * Request schemas.
 *
 * Every request body is parsed through one of these before reaching any logic,
 * so handlers can trust their input completely. The frontend will validate too,
 * but that is only a convenience for the user -- anyone can call this API
 * directly with curl, so the server treats every incoming value as hostile.
 *
 * Zod rather than hand-written checks for two reasons: it reports every failure
 * at once, which is what the `fields` map in our error shape was designed for,
 * and the TypeScript type is inferred from the schema, so the validation and
 * the type can never drift apart.
 */

/**
 * Trimmed and lowercased before validation, so " Alice@X.com " is accepted and
 * stored as "alice@x.com". This is the application half of the case-insensitivity
 * decision; the unique index on LOWER(email) is the half that guarantees it.
 */
export const emailSchema = z
  // The message covers a missing or non-string value; without it Zod reports its
  // own wording ("expected string, received undefined"), which is developer
  // language appearing in a user-facing field.
  .string({ error: 'Enter a valid email address' })
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.email('Enter a valid email address').max(254, 'That email address is too long'));

export const nameSchema = z
  .string({ error: 'This field is required' })
  .transform((value) => value.trim())
  .pipe(z.string().min(1, 'This field is required').max(100, 'That is too long'));

/** The recognition check needs nothing but an address. */
export const recognizeSchema = z.object({ email: emailSchema });

export const registerSchema = z.object({
  email: emailSchema,
  firstName: nameSchema,
  lastName: nameSchema,
});

/**
 * Flattens Zod's issues into { fieldName: message }, the shape a form needs to
 * render a message under each input.
 *
 * Only the first issue per field is kept: showing a user three simultaneous
 * complaints about one box is noise, not help.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (result[key] === undefined) result[key] = issue.message;
  }
  return result;
}

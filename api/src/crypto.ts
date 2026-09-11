import { createHash, randomBytes, randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * bcryptjs rather than the native bcrypt package: it is pure JavaScript, so it
 * needs no compilation step at install time and cannot fail to build on a host
 * we do not control. The cost is that it is slower than the native version.
 */

const LOGIN_CODE_DIGITS = 6;

/**
 * bcrypt's work factor. Each increment doubles the time taken. 10 lands around
 * 100ms, which a user never notices on a single login but which makes bulk
 * guessing expensive. Being slow is the entire point of a password hash -- a
 * fast hash like SHA-256 would be the wrong tool here, because speed is what
 * an attacker wants.
 */
const BCRYPT_ROUNDS = 10;

/**
 * Generates the 6-digit login code issued at registration.
 *
 * `randomInt` draws from the operating system's cryptographically secure random
 * source. `Math.random()` would be wrong: it is a PRNG whose internal state can
 * be recovered from a sequence of outputs, making later values predictable.
 *
 * `randomInt` is also preferable to randomBytes-and-modulo, which introduces
 * modulo bias: 2^32 is not divisible by 10^6, so some codes would be marginally
 * more likely than others. randomInt discards out-of-range draws internally and
 * retries, giving a uniform distribution.
 *
 * padStart matters more than it looks. randomInt can legitimately return 42,
 * which would otherwise be issued as the two-character code "42" -- violating
 * the six-digit contract and revealing that the underlying number was small.
 */
export function generateLoginCode(): string {
  const upperBound = 10 ** LOGIN_CODE_DIGITS; // 1,000,000 -- exclusive
  return randomInt(0, upperBound).toString().padStart(LOGIN_CODE_DIGITS, '0');
}

/**
 * Hashes a login code for storage. The plaintext code is never persisted: it is
 * returned once by the registration endpoint and is unrecoverable afterwards.
 *
 * bcrypt generates and embeds a random salt in the output, so two users with
 * the same code get different hashes. Without a salt, identical codes would
 * produce identical hashes and a single lookup table would break every account
 * at once.
 */
export function hashLoginCode(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_ROUNDS);
}

/**
 * Checks a submitted code against a stored hash.
 *
 * bcrypt.compare, not `===`. Two reasons it cannot be an equality check:
 *
 * 1. The stored value is a hash, not the code, so there is nothing to compare
 *    it to directly. bcrypt re-hashes the submitted code using the salt
 *    embedded in the stored string, then compares the results.
 * 2. That final comparison is constant-time. A naive comparison returns as soon
 *    as two characters differ, so the time it takes reveals how many leading
 *    characters were right -- enough, over many attempts, to recover a secret
 *    one character at a time instead of guessing it whole.
 */
export function verifyLoginCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

/**
 * A hash of a value nobody will ever submit, used to spend the same time
 * verifying a code for an email that does not exist as for one that does.
 *
 * Without it, a failed login for an unregistered address would return in
 * roughly a millisecond while a wrong code for a real account takes ~100ms, and
 * that difference alone would tell an attacker which addresses are real.
 */
const DUMMY_HASH = bcrypt.hashSync('000000', BCRYPT_ROUNDS);

/** Burns the same time a real verification would take. */
export async function equalizeVerificationTime(): Promise<void> {
  await bcrypt.compare('000000', DUMMY_HASH);
}

/**
 * The session token handed to the browser: 256 bits from the OS random source.
 *
 * Unguessable by construction -- at 2^256 possibilities there is no brute force
 * to defend against, which is why this needs no rate limiting of its own the
 * way a six-digit code does.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Session tokens are stored hashed, so database read access does not yield a
 * set of usable logins.
 *
 * SHA-256 rather than bcrypt here, and that difference is deliberate. bcrypt is
 * slow on purpose because a 6-digit code is guessable and slowness is the
 * defence. A 256-bit random token cannot be guessed or found in any dictionary,
 * so there is nothing for slowness to buy -- and this runs on every
 * authenticated request, where speed matters.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

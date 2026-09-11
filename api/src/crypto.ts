import { randomInt } from 'node:crypto';
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

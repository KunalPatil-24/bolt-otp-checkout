/**
 * Client-side checks, run when a field loses focus.
 *
 * These exist to tell someone about a problem while they are still thinking
 * about that field, rather than making them discover several at once after
 * pressing the button. They are a convenience, not the boundary -- the server
 * validates everything again, because anyone can call the API directly.
 *
 * Deliberately LOOSER than the server's rules, and that asymmetry is the whole
 * design. These rules are written out separately here rather than shared with
 * the API, so the two can drift; the way to make drift harmless is to ensure
 * the frontend never rejects something the server would accept. A frontend
 * stricter than the server blocks valid input and the user cannot get past it.
 * Looser simply means the server has the last word, which it does anyway.
 */

/** Matches the completeness check used for recognition, for consistency. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

const REQUIRED_LABEL: Record<string, string> = {
  email: 'Email address is required',
  phone: 'Phone number is required',
  addressLine1: 'Street address is required',
  city: 'City is required',
  state: 'State or province is required',
  postalCode: 'Postal code is required',
  country: 'Country is required',
};

export function validateField(name: string, rawValue: string): string | undefined {
  const value = rawValue.trim();

  // The second address line is genuinely optional, so it never complains.
  if (name === 'addressLine2') return undefined;

  if (value === '') return REQUIRED_LABEL[name];

  if (name === 'email' && !EMAIL_PATTERN.test(value)) {
    return 'Enter a valid email address';
  }

  if (name === 'phone') {
    // Counts digits rather than characters, so formatting cannot pad a short
    // number into looking long enough. Seven is the server's floor too.
    const digits = value.match(/\d/g)?.length ?? 0;
    if (digits < 7) return 'Enter a valid phone number';
  }

  return undefined;
}

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, type User } from '../lib/api';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { LoginModal } from '../components/LoginModal';
import { TextField } from '../components/TextField';

/**
 * What counts as "complete enough to be worth asking the server about".
 *
 * The trailing {2,} is the part that earns its keep: it means we do not fire
 * while the user is still typing the domain. "kunal@example.c" is one keystroke
 * from done and not worth a request; "kunal@example.co" is.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** How long the user must stop typing before the check fires. */
const RECOGNITION_DEBOUNCE_MS = 400;

const EMPTY_FORM = {
  email: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
};

type FormValues = typeof EMPTY_FORM;

type CheckoutPageProps = {
  user: User | null;
  onUserChange: (user: User | null) => void;
};

export function CheckoutPage({ user, onUserChange }: CheckoutPageProps) {
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const [modalEmail, setModalEmail] = useState<string | null>(null);
  const [recognizedEmail, setRecognizedEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<{ orderId: string; linked: boolean } | null>(
    null,
  );

  /**
   * Two separate sets, and the separation matters.
   *
   * `alreadyChecked` stops us asking the server the same question twice --
   * users click back into the email field, or edit and undo.
   *
   * `dismissed` remembers that the user closed the modal for an address, so it
   * does not reappear on their next keystroke. Without it, skipping the modal
   * and touching the email field pops it straight back up.
   *
   * They cannot be one set, because the sign-in link below needs to know an
   * address WAS recognised even though its modal was dismissed.
   *
   * Refs rather than state: changing them must not cause a re-render. They are
   * bookkeeping, not part of what is on screen.
   */
  const alreadyChecked = useRef(new Set<string>());
  const dismissed = useRef(new Set<string>());

  const debouncedEmail = useDebouncedValue(form.email, RECOGNITION_DEBOUNCE_MS);
  const normalizedEmail = debouncedEmail.trim().toLowerCase();
  const emailIsComplete = EMAIL_PATTERN.test(normalizedEmail);

  /* -------------------------------------------------------------------------
   * Background recognition.
   *
   * Runs once the user pauses on a plausibly complete address. It deliberately
   * does not block anything: every other field stays live throughout, and a
   * negative result changes nothing on screen at all.
   * ---------------------------------------------------------------------- */
  useEffect(() => {
    if (!emailIsComplete) return;
    if (user) return;                                      // already signed in
    if (alreadyChecked.current.has(normalizedEmail)) return; // asked before
    if (dismissed.current.has(normalizedEmail)) return;      // user said no

    /**
     * One controller per run, aborted by the cleanup below when the email
     * changes.
     *
     * Without this: type an address, pause (request A fires), edit it, pause
     * (request B fires). If A is slower than B -- which is entirely ordinary,
     * responses do not arrive in send order -- A lands last and opens a
     * "welcome back" modal for an address the user already typed away from.
     *
     * Debouncing makes that race rare. Aborting makes it impossible. They are
     * doing different jobs, which is why both are here.
     *
     * Aborting also actually cancels the request, where merely ignoring a stale
     * response still costs a round trip and server work.
     */
    const controller = new AbortController();
    setChecking(true);

    api
      .recognize(normalizedEmail, controller.signal)
      .then((result) => {
        alreadyChecked.current.add(normalizedEmail);
        setChecking(false);
        if (result.recognized) {
          setRecognizedEmail(normalizedEmail);
          setModalEmail(normalizedEmail);
        }
      })
      .catch((error) => {
        // An abort is not a failure -- we caused it. If it fell through to the
        // branch below, every cancelled request would look like a network
        // problem.
        if (error instanceof DOMException && error.name === 'AbortError') return;

        // Any real failure is swallowed on purpose. Recognition is a
        // convenience; checkout is the thing that matters. A returning customer
        // checking out as a guest is a minor annoyance, while an alarming error
        // about something they never asked for loses the sale. The sign-in link
        // below is the fallback that makes silence acceptable.
        setChecking(false);
      });

    return () => controller.abort();
  }, [normalizedEmail, emailIsComplete, user]);

  /**
   * Keep the email field in step with the signed-in account.
   *
   * Runs in two situations, and the second is easy to miss: straight after
   * logging in, and on page load once the session has been restored from the
   * cookie. The form mounts empty and the user arrives a moment later from
   * /me -- without this the field would stay blank while also being disabled,
   * leaving the form impossible to submit.
   */
  useEffect(() => {
    if (!user) return;
    setForm((previous) =>
      previous.email === user.email ? previous : { ...previous, email: user.email },
    );
  }, [user]);

  function update(field: keyof FormValues, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
    // Clear a field's error the moment it is edited -- a complaint about what
    // the user just changed is stale by definition.
    setErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  function handleLoginSuccess(loggedIn: User) {
    onUserChange(loggedIn);
    setModalEmail(null);
  }

  function handleSkip() {
    // Record the dismissal, but keep `recognizedEmail` so the banner can still
    // offer a way back in if the user changes their mind.
    if (modalEmail) dismissed.current.add(modalEmail);
    setModalEmail(null);
  }

  async function handleSignOut() {
    await api.logout().catch(() => undefined);
    onUserChange(null);
    setRecognizedEmail(null);
    // Let the same address be recognised again after signing out.
    alreadyChecked.current.clear();
    dismissed.current.clear();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setErrors({});
    try {
      const result = await api.createOrder({ ...form });
      setConfirmation({ orderId: result.orderId, linked: result.linkedToAccount });
    } catch (caught) {
      if (caught instanceof ApiError) {
        // The server is the authority on validity, and it returns errors keyed
        // by field name, which drop straight into the inputs.
        setErrors(
          Object.keys(caught.fields).length > 0 ? caught.fields : { form: caught.message },
        );
      } else {
        setErrors({ form: 'Something went wrong. Please try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <div className="card confirmation">
        <div className="confirmation-badge">✓</div>
        <h1>Order recorded</h1>
        <p className="muted">
          Reference <code>{confirmation.orderId}</code>
        </p>
        <p className="muted">
          {confirmation.linked
            ? 'This order is linked to your account.'
            : 'This order was placed as a guest.'}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setConfirmation(null);
            setForm(user ? { ...EMPTY_FORM, email: user.email } : EMPTY_FORM);
          }}
        >
          Place another order
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        {user ? (
          <div className="banner banner-signed-in">
            <div>
              <span className="banner-eyebrow">Signed in</span>
              <strong className="banner-name">
                {user.firstName} {user.lastName}
              </strong>
            </div>
            <button type="button" className="btn btn-ghost btn-small" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        ) : recognizedEmail && recognizedEmail === normalizedEmail ? (
          // The fallback that makes silent failure acceptable: a way into an
          // account that does not depend on the modal having appeared.
          <div className="banner">
            <span className="muted">This email is already registered.</span>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => setModalEmail(recognizedEmail)}
            >
              Sign in
            </button>
          </div>
        ) : (
          <div className="banner">
            <span className="muted">
              Checking out as a guest. <Link to="/register">Register</Link> to get a
              login code.
            </span>
          </div>
        )}

        <h1 className="card-title">Checkout</h1>
        <p className="card-subtitle">
          No payment is taken — submitting records the details in the database.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <TextField
            label="Email address"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={form.email}
            error={errors.email}
            disabled={Boolean(user)}
            hint={
              checking
                ? 'Checking for an existing account…'
                : user
                  ? 'Using your account email.'
                  : undefined
            }
            onChange={(value) => update('email', value)}
          />

          <TextField
            label="Phone number"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="+91 98765 43210"
            value={form.phone}
            error={errors.phone}
            onChange={(value) => update('phone', value)}
          />

          <h2 className="section-heading">Shipping address</h2>

          <TextField
            label="Street address"
            name="addressLine1"
            autoComplete="address-line1"
            placeholder="12 MG Road"
            value={form.addressLine1}
            error={errors.addressLine1}
            onChange={(value) => update('addressLine1', value)}
          />

          <TextField
            label="Apartment, suite, etc. (optional)"
            name="addressLine2"
            autoComplete="address-line2"
            value={form.addressLine2}
            error={errors.addressLine2}
            onChange={(value) => update('addressLine2', value)}
          />

          <div className="field-row">
            <TextField
              label="City"
              name="city"
              autoComplete="address-level2"
              value={form.city}
              error={errors.city}
              onChange={(value) => update('city', value)}
            />
            <TextField
              label="State / Province"
              name="state"
              autoComplete="address-level1"
              value={form.state}
              error={errors.state}
              onChange={(value) => update('state', value)}
            />
          </div>

          <div className="field-row">
            <TextField
              label="Postal code"
              name="postalCode"
              autoComplete="postal-code"
              value={form.postalCode}
              error={errors.postalCode}
              onChange={(value) => update('postalCode', value)}
            />
            <TextField
              label="Country"
              name="country"
              autoComplete="country-name"
              value={form.country}
              error={errors.country}
              onChange={(value) => update('country', value)}
            />
          </div>

          {errors.form && (
            <p className="form-error" role="alert">
              {errors.form}
            </p>
          )}

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Place order'}
          </button>
        </form>
      </div>

      {modalEmail && (
        <LoginModal email={modalEmail} onSuccess={handleLoginSuccess} onSkip={handleSkip} />
      )}
    </>
  );
}

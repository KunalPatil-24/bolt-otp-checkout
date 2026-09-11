import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, type User } from '../lib/api';

type LoginModalProps = {
  email: string;
  onSuccess: (user: User) => void;
  onSkip: () => void;
};

/**
 * The code prompt, shown when an email is recognised.
 *
 * Every route out of it leads back to the checkout form: the Escape key, the
 * backdrop, and an explicit button. The assignment requires a way to skip, and
 * beyond that a checkout flow must never trap someone who only wants to buy
 * something as a guest.
 */
export function LoginModal({ email, onSuccess, onSkip }: LoginModalProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Move focus into the dialog as it opens, so a keyboard or screen-reader user
  // lands on the field instead of being left behind on the page underneath.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onSkip]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return; // a double-click must not send two logins

    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { user } = await api.login({ email, code });
      onSuccess(user);
    } catch (caught) {
      // The API's message is already appropriate for a user: it distinguishes a
      // wrong code from a rate-limited account without revealing whether the
      // address is registered.
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      inputRef.current?.select(); // ready for a retype, no manual clearing
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onSkip}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
        // Without this, a click that starts inside the dialog reaches the
        // backdrop's handler and dismisses it -- including a drag that begins
        // on the text input.
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title" id="login-modal-title">
          Welcome back
        </h2>
        <p className="modal-subtitle">
          We recognise <strong>{email}</strong>. Enter the 6-digit code from when you
          registered.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <input
            ref={inputRef}
            className={`code-input${error ? ' code-input-error' : ''}`}
            value={code}
            inputMode="numeric"       // numeric keypad on phones
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            aria-label="6-digit code"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'code-error' : undefined}
            onChange={(event) => {
              // Strip non-digits as they are typed rather than rejecting the
              // whole value on submit.
              setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
              if (error) setError(null); // an error about what they just changed is stale
            }}
          />

          {error && (
            // role="alert" so a screen reader announces it without the user
            // having to go looking.
            <p className="modal-error" id="code-error" role="alert">
              {error}
            </p>
          )}

          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Checking…' : 'Sign in'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onSkip}>
              Continue without signing in
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

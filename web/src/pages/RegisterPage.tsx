import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { TextField } from '../components/TextField';

export function RegisterPage() {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [issued, setIssued] = useState<{
    code: string;
    firstName: string;
    emailed: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return; // a double-click must not create two accounts

    setSubmitting(true);
    setErrors({});
    try {
      const result = await api.register(form);
      setIssued({
        code: result.loginCode,
        firstName: result.user.firstName,
        emailed: result.emailed,
      });
    } catch (caught) {
      if (caught instanceof ApiError) {
        // Field-level errors go under their inputs; anything else -- a taken
        // email, a network failure -- becomes a single message above the button.
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

  /**
   * The code is displayed exactly once.
   *
   * Only a bcrypt hash was stored, so there is genuinely no endpoint that could
   * show it again -- this is not a policy we could relax, it is a consequence
   * of how the code is stored. The screen therefore has to do three things:
   * make the code easy to read off accurately, make it trivial to copy, and say
   * plainly that it will not be shown again.
   *
   * Deliberately no automatic redirect: navigating away from the only place
   * this code will ever appear, on a timer, would be a bad way to lose it.
   */
  if (issued) {
    return (
      <div className="card">
        <h1 className="card-title">You're registered, {issued.firstName}</h1>
        <p className="card-subtitle">
          This is your login code. You'll need it to sign in at checkout.
        </p>

        <div className="code-display">
          {/* Monospace and widely spaced, because this will be read aloud,
              written down, or retyped, and 0/O and 1/l must not be confusable. */}
          <span className="code-digits">{issued.code}</span>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(issued.code);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                // The clipboard API can be blocked by permissions or an
                // insecure context. The code is on screen regardless, so this
                // fails quietly rather than raising an error about a
                // convenience.
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <p className="notice">
          <strong>Save this now.</strong> We store only an encrypted version, so it
          cannot be shown or recovered later.
          {issued.emailed
            ? " We've also emailed it to you."
            : ' You can ask for a replacement by email at checkout.'}
        </p>

        <Link className="btn btn-primary btn-block" to="/">
          Continue to checkout
        </Link>
      </div>
    );
  }

  return (
    <div className="card">
      <h1 className="card-title">Create an account</h1>
      <p className="card-subtitle">
        You'll get a 6-digit code to sign in with at checkout.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="field-row">
          <TextField
            label="First name"
            name="firstName"
            autoComplete="given-name"
            value={form.firstName}
            error={errors.firstName}
            onChange={(value) => update('firstName', value)}
          />
          <TextField
            label="Last name"
            name="lastName"
            autoComplete="family-name"
            value={form.lastName}
            error={errors.lastName}
            onChange={(value) => update('lastName', value)}
          />
        </div>

        <TextField
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={form.email}
          error={errors.email}
          onChange={(value) => update('email', value)}
        />

        {errors.form && (
          <p className="form-error" role="alert">
            {errors.form}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? 'Registering…' : 'Register'}
        </button>
      </form>

      <p className="card-footer">
        Already registered? <Link to="/">Go to checkout</Link> — we'll recognise your
        email as you type.
      </p>
    </div>
  );
}

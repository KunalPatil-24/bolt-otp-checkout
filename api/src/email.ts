// Loaded here rather than relying on another module having done it. This file
// reads process.env at import time, and which module is imported first is not
// something it should depend on -- without this the key is simply absent and
// email silently does nothing, locally only, since a host injects real
// environment variables and would have worked.
import 'dotenv/config';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';

/**
 * Email delivery for login codes.
 *
 * Entirely optional: with no mail credentials the app runs exactly as before
 * and codes are only shown on screen. That keeps a fresh checkout and the test
 * suite working with no third-party account, and it is why every function here
 * reports whether it sent rather than throwing.
 *
 * Three transports, used in this order of preference when several are set:
 *
 *  - Brevo, over its HTTPS API. Delivers to any address from a single sender
 *    address you confirm by email, with no domain to own. It is first because
 *    it is the one that works on Render's free tier, which blocks outbound
 *    SMTP ports -- so Gmail below works locally but not there.
 *  - Gmail over SMTP, with an app password. Delivers to any address from the
 *    account's own mailbox, with no domain to own or verify. Needs a host that
 *    allows outbound SMTP.
 *  - Resend. Its shared sender works without a domain too, but it will only
 *    deliver to the address the Resend account was created with, so every
 *    other user's email is refused. Verifying a domain of your own lifts that;
 *    set EMAIL_FROM to an address on it.
 */

const brevoKey = process.env.BREVO_API_KEY;
const brevoSender = process.env.BREVO_SENDER_EMAIL;
const brevo = brevoKey && brevoSender ? { key: brevoKey, sender: brevoSender } : null;

const gmailUser = process.env.GMAIL_USER;
// Google displays the password in groups of four; the spaces are not part of it.
const gmailPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');
const resendKey = process.env.RESEND_API_KEY;

const gmail =
  !brevo && gmailUser && gmailPassword
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPassword },
      })
    : null;
const resend = !brevo && !gmail && resendKey ? new Resend(resendKey) : null;

// Gmail rewrites the From address to the authenticated account anyway, so only
// the display name is ours to choose there.
const from = gmail
  ? `Bolt Checkout <${gmailUser}>`
  : (process.env.EMAIL_FROM ?? 'Bolt Checkout <onboarding@resend.dev>');

/**
 * Under test, nothing is actually sent.
 *
 * The suite loads the same .env as development, so without this a test run
 * would fire real email at real inboxes -- and the tests would depend on a
 * third-party service being up to pass. Sends are recorded instead, which is
 * also what lets a test assert that an email WOULD have gone out.
 */
const isTest = process.env.NODE_ENV === 'test';

export type RecordedEmail = { to: string; code: string; purpose: string };
export const recordedEmails: RecordedEmail[] = [];

/**
 * Makes the test transport report failure, so a test can check what happens
 * when delivery does not succeed -- which is the case that decides whether a
 * user is locked out.
 */
let failNextSends = false;
export function setEmailFailure(shouldFail: boolean): void {
  failNextSends = shouldFail;
}

/** Empties the record between tests. */
export function clearRecordedEmails(): void {
  recordedEmails.length = 0;
}

export const emailEnabled = brevo !== null || gmail !== null || resend !== null || isTest;

type SendResult = { sent: boolean; reason?: string };

/**
 * Sends a login code.
 *
 * Never throws. Delivery is a convenience layered on top of a flow that already
 * works without it -- the code is shown on screen either way -- so a mail
 * outage, a rate limit, or an unverified recipient must not turn a successful
 * registration into a failed one. The caller carries on regardless; the reason
 * is logged for us and never shown to the user.
 */
export async function sendLoginCode(
  to: string,
  firstName: string,
  code: string,
  purpose: 'registered' | 'replacement',
): Promise<SendResult> {
  if (isTest) {
    if (failNextSends) return { sent: false, reason: 'simulated_failure' };
    recordedEmails.push({ to, code, purpose });
    return { sent: true };
  }

  if (!brevo && !gmail && !resend) return { sent: false, reason: 'email_not_configured' };

  const subject =
    purpose === 'registered' ? 'Your Bolt login code' : 'Your new Bolt login code';

  const intro =
    purpose === 'registered'
      ? 'Thanks for registering. Use this code to sign in at checkout.'
      : 'Here is a new code. Your previous one no longer works.';

  // Both parts are supplied: many clients and most corporate gateways prefer or
  // strip to text, and a code nobody can read is useless.
  const message = {
    from,
    to,
    subject,
    text: `Hi ${firstName},\n\n${intro}\n\n${code}\n\nIf you didn't expect this email, you can ignore it.`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#04091a">
        <p style="font-size:16px;margin:0 0 8px">Hi ${escapeHtml(firstName)},</p>
        <p style="font-size:15px;color:#5b6076;margin:0 0 24px">${intro}</p>
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:.18em;text-align:center;padding:22px;background:#f8f6fe;border:1px dashed #cfcce2;border-radius:14px">${code}</div>
        <p style="font-size:13px;color:#5b6076;margin:24px 0 0">If you didn't expect this email, you can ignore it.</p>
      </div>
    `,
  };

  try {
    if (brevo) {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': brevo.key, 'content-type': 'application/json' },
        body: JSON.stringify({
          sender: { name: 'Bolt Checkout', email: brevo.sender },
          to: [{ email: to }],
          subject,
          textContent: message.text,
          htmlContent: message.html,
        }),
        // A hung request would hold the user's click open indefinitely.
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const detail = await response.text();
        console.error(`[email] send failed: ${response.status} ${detail}`);
        return { sent: false, reason: `brevo_${response.status}` };
      }
      return { sent: true };
    }

    if (gmail) {
      await gmail.sendMail(message);
      return { sent: true };
    }

    const { error } = await resend!.emails.send(message);
    if (error) {
      console.error('[email] send failed:', error.message);
      return { sent: false, reason: error.message };
    }
    return { sent: true };
  } catch (caught) {
    console.error('[email] send threw:', caught);
    return { sent: false, reason: caught instanceof Error ? caught.message : 'exception' };
  }
}

/**
 * The name comes from user input and is interpolated into HTML, so it has to be
 * escaped. Without this, registering as `<script>…` would put that script into
 * an email -- and mail clients are just another rendering surface.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

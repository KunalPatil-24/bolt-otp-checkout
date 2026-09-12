// Loaded here rather than relying on another module having done it. This file
// reads process.env at import time, and which module is imported first is not
// something it should depend on -- without this the key is simply absent and
// email silently does nothing, locally only, since a host injects real
// environment variables and would have worked.
import 'dotenv/config';
import { Resend } from 'resend';

/**
 * Email delivery for login codes.
 *
 * Entirely optional: with no RESEND_API_KEY the app runs exactly as before and
 * codes are only shown on screen. That keeps a fresh checkout and the test
 * suite working with no third-party account, and it is why every function here
 * reports whether it sent rather than throwing.
 */

const apiKey = process.env.RESEND_API_KEY;

/**
 * Resend's shared sender works without owning a domain, but it will only
 * deliver to the address the Resend account was created with. Sending to a
 * verified domain of your own lifts that -- set EMAIL_FROM once you have one.
 */
const from = process.env.EMAIL_FROM ?? 'Bolt Checkout <onboarding@resend.dev>';

const client = apiKey ? new Resend(apiKey) : null;

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

export const emailEnabled = client !== null || isTest;

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

  if (!client) return { sent: false, reason: 'email_not_configured' };

  const subject =
    purpose === 'registered' ? 'Your Bolt login code' : 'Your new Bolt login code';

  const intro =
    purpose === 'registered'
      ? 'Thanks for registering. Use this code to sign in at checkout.'
      : 'Here is a new code. Your previous one no longer works.';

  try {
    const { error } = await client.emails.send({
      from,
      to,
      subject,
      // Both parts are supplied: many clients and most corporate gateways
      // prefer or strip to text, and a code nobody can read is useless.
      text: `Hi ${firstName},\n\n${intro}\n\n${code}\n\nIf you didn't expect this email, you can ignore it.`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#04091a">
          <p style="font-size:16px;margin:0 0 8px">Hi ${escapeHtml(firstName)},</p>
          <p style="font-size:15px;color:#5b6076;margin:0 0 24px">${intro}</p>
          <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:.18em;text-align:center;padding:22px;background:#f8f6fe;border:1px dashed #cfcce2;border-radius:14px">${code}</div>
          <p style="font-size:13px;color:#5b6076;margin:24px 0 0">If you didn't expect this email, you can ignore it.</p>
        </div>
      `,
    });

    if (error) {
      console.error('[email] send failed:', error.message);
      return { sent: false, reason: error.message };
    }
    return { sent: true };
  } catch (caught) {
    console.error('[email] send threw:', caught);
    return { sent: false, reason: 'exception' };
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

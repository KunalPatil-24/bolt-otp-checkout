/**
 * The only place in the frontend that talks to the API.
 *
 * Keeping every call behind one module means the base URL, the credentials
 * mode, and error handling are decided once. No component builds a URL or
 * inspects a status code itself -- so it is impossible to forget
 * `credentials: 'include'` on one call and spend an afternoon wondering why
 * that single request looks logged out.
 */

/**
 * Vite replaces import.meta.env.VITE_* at BUILD time, inlining the value into
 * the bundle. That means this value is public -- anyone can read it in the
 * shipped JavaScript. Fine for an address; it is why real secrets never carry a
 * VITE_ prefix and never leave the server.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080';

export type User = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
};

/**
 * Carries the API's structured error so a form can use it directly: `code` to
 * branch on, `message` to display, `fields` to drop under the right input.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(
    status: number,
    body: { error?: string; message?: string; fields?: Record<string, string> },
  ) {
    super(body.message ?? 'Something went wrong. Please try again.');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error ?? 'unknown_error';
    this.fields = body.fields ?? {};
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      // Send and accept the session cookie even though the API is on a
      // different origin. Without this the browser silently drops it and every
      // request looks anonymous -- no error, just a permanently logged-out app.
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch (error) {
    // fetch only rejects on a network-level failure -- it does NOT reject on a
    // 4xx or 5xx, which is the usual surprise. An aborted request also lands
    // here, and callers need to tell that apart from a real failure, so it is
    // rethrown untouched.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, {
      error: 'network_error',
      message: 'Could not reach the server.',
    });
  }

  // A 204 or an empty body would make .json() throw, so failures to parse fall
  // back to an empty object rather than masking the real status.
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

export const api = {
  register: (input: { email: string; firstName: string; lastName: string }) =>
    request<{ user: User; loginCode: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /**
   * Takes an AbortSignal because this one is called while the user types, and a
   * request for an email they have already edited away from must be cancellable.
   */
  recognize: (email: string, signal?: AbortSignal) =>
    request<{ recognized: boolean; firstName?: string }>('/api/auth/recognize', {
      method: 'POST',
      body: JSON.stringify({ email }),
      signal,
    }),

  login: (input: { email: string; code: string }) =>
    request<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  me: () => request<{ user: User | null }>('/api/auth/me'),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  createOrder: (input: Record<string, string>) =>
    request<{ orderId: string; createdAt: string; linkedToAccount: boolean }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

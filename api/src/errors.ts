import type { NextFunction, Request, Response } from 'express';

/**
 * The shape of every error response this API produces.
 *
 * `error` is a stable machine-readable code the frontend can branch on.
 * `message` is human-readable text for display, and is free to be reworded
 * without breaking any client -- which is exactly why the frontend must branch
 * on the code and never on the message.
 *
 * `fields` is present on validation failures, keyed by input name, so a form
 * can render each message under the right field without parsing anything.
 */
export type ErrorBody = {
  error: string;
  message: string;
  fields?: Record<string, string>;
};

/**
 * An error a handler can throw to produce a specific HTTP response.
 *
 * Anything else that escapes a handler is treated as a bug and becomes a
 * generic 500 -- so the distinction this class draws is "a problem we
 * anticipated and want to describe" versus "something went wrong".
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** 400 — the request was malformed or failed validation. */
  static badRequest(message: string, fields?: Record<string, string>): ApiError {
    return new ApiError(400, 'validation_error', message, fields);
  }

  /** 401 — the caller is not authenticated, or their credential was wrong. */
  static unauthorized(code: string, message: string): ApiError {
    return new ApiError(401, code, message);
  }

  /** 404 — no such resource. */
  static notFound(message = 'Not found.'): ApiError {
    return new ApiError(404, 'not_found', message);
  }

  /** 409 — the request conflicts with existing state, e.g. a duplicate email. */
  static conflict(code: string, message: string): ApiError {
    return new ApiError(409, code, message);
  }

  /** 429 — the caller is being rate limited. */
  static tooManyRequests(message: string): ApiError {
    return new ApiError(429, 'too_many_attempts', message);
  }
}

/** Anything that did not match a route. Keeps 404s in the same shape as the rest. */
export function notFoundHandler(_req: Request, res: Response): void {
  const body: ErrorBody = { error: 'not_found', message: 'No such endpoint.' };
  res.status(404).json(body);
}

/**
 * The single place errors become responses.
 *
 * Express recognises this as error-handling middleware by its four parameters —
 * remove `next` and it silently becomes ordinary middleware that never runs.
 * Express 5 also forwards rejected promises from async handlers here
 * automatically, so a handler can simply `throw` and stop thinking about
 * response formatting.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // If a response has already started streaming there is no way to replace it
  // with an error; the best we can do is let Express abort the connection.
  if (res.headersSent) return;

  if (error instanceof ApiError) {
    const body: ErrorBody = { error: error.code, message: error.message };
    if (error.fields) body.fields = error.fields;
    res.status(error.status).json(body);
    return;
  }

  // Anything else is an unanticipated bug. The real error goes to the server
  // log where it is useful; the client gets nothing specific, because stack
  // traces, SQL text and file paths help an attacker map the system and help a
  // user not at all.
  console.error('[api] unhandled error:', error);
  const body: ErrorBody = { error: 'internal_error', message: 'Something went wrong.' };
  res.status(500).json(body);
}

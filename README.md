# OTP-Based User Login — Checkout Demo

A checkout flow that recognises returning customers by their email address as
they type, and asks them for a 6-digit code before revealing their account.

**Live:** _(added once deployed)_

---

## What it does

**Registration** — collect email, first name and last name. The server generates
a random 6-digit code, stores a bcrypt hash of it, and returns the plaintext
code exactly once for the user to save.

**Checkout** — a form collecting email, phone and shipping address. Once the
email looks complete, the app quietly asks the API whether it belongs to a
registered user; the form stays fully usable throughout. If it is recognised, a
modal asks for the code. The user can enter it or skip and continue as a guest.
A correct code signs them in, closes the modal and shows their name above the
form. Submitting records the order.

---

## Architecture

Three layers, deployed independently:

```
  Browser
     │  HTTPS, credentialed CORS (the session cookie travels cross-origin)
     ▼
┌─────────────────┐        ┌──────────────────┐        ┌───────────────┐
│  web/           │  ───▶  │  api/            │  ───▶  │  db/          │
│  React + TS     │        │  Express + TS    │        │  Postgres     │
│  Vite → Vercel  │        │  → Render        │        │  → Neon       │
└─────────────────┘        └──────────────────┘        └───────────────┘
```

The browser never talks to Postgres. Every rule — validation, code verification,
rate limiting, session issuing — lives in the API, because the frontend is code
the user controls and can bypass entirely with `curl`.

```
db/migrations/       Schema, as checked-in .sql files
api/src/
  index.ts             Server setup: CORS, JSON parsing, routes, error handling
  db.ts                Connection pool, the `sql` tagged template, query helper
  crypto.ts            Code generation, hashing, session tokens
  session.ts           Session create / read / destroy, cookie attributes
  validation.ts        Zod schemas for every request body
  errors.ts            The one error shape, and the handlers that produce it
  migrate.ts           Migration runner
  routes/auth.ts       register, recognize, login, me, logout
  routes/orders.ts     checkout submission
web/src/
  lib/api.ts           The only module that calls the API
  lib/useDebouncedValue.ts
  pages/               CheckoutPage, RegisterPage
  components/          LoginModal, TextField
```

---

## API

| Method | Path                  | Purpose                                          |
| ------ | --------------------- | ------------------------------------------------ |
| `GET`  | `/api/health`         | Liveness plus database reachability               |
| `POST` | `/api/auth/register`  | Create a user, return the one-time code           |
| `POST` | `/api/auth/recognize` | Is this email registered? Returns only a boolean  |
| `POST` | `/api/auth/login`     | Verify a code, start a session                    |
| `GET`  | `/api/auth/me`        | Current user, or `null`                           |
| `POST` | `/api/auth/logout`    | End the session                                   |
| `POST` | `/api/orders`         | Record a checkout submission                      |

Every failure returns the same shape: `{ error, message }`, plus a per-field
`fields` map on validation errors so a form can highlight every bad input at
once.

---

## Notable decisions

**Codes are hashed, never stored in plaintext.** bcrypt, the same as a password.
The code is shown once at registration and cannot be recovered.

**Login is rate limited** — five failures per email per fifteen minutes,
recorded in `login_attempts`. A 6-digit code is only 10⁶ possibilities; at 100
guesses a second that is under two hours without a limit, and roughly 28 years
with one. Hashing and rate limiting defend *different* threats: hashing protects
a leaked database, rate limiting protects the live login.

**Sessions are opaque random tokens, stored hashed.** The browser holds the
token in an `httpOnly` cookie, so an XSS bug cannot read it; only its SHA-256
hash is in the database. Session rows rather than a self-contained token mean a
login can be revoked instantly by deleting a row.

**Identity comes from the cookie, never the request body.** The body is a claim;
the cookie is proof, because it maps to a session the server issued.

**Every query is parameterised.** The `sql` tagged template turns interpolation
into bound parameters, so writing a query the natural way produces a safe one.

**Recognition is debounced and abortable.** A 400ms debounce plus a completeness
check turns ~18 keystrokes into one request; an `AbortController` cancels a
superseded check so a slow earlier response cannot open a modal for an address
the user has already edited away from.

**Failed logins are indistinguishable.** An unregistered email and a wrong code
return the same status, the same message, and take the same time.

### Known trade-offs

- **No CSRF protection.** Cross-domain cookies require `SameSite=None`, which
  gives up the browser's built-in defence. A production version needs CSRF
  tokens on state-changing routes.
- **Codes never expire and are reusable**, which makes them closer to a static
  password than a one-time code. Real OTPs are single-use and short-lived.
- **Rate limiting is per email**, so someone who knows an address can lock its
  owner out for the window. Keying on IP as well would reduce this, at the cost
  of users behind shared NAT.
- **`/api/auth/recognize` is not rate limited**, so email addresses can be
  enumerated quickly. It leaks only a boolean, but bulk enumeration should be
  slowed.
- **Expired session rows are never cleaned up.** They are ignored correctly, but
  accumulate.
- **No automated tests.** Every path was verified by hand, including the
  recognition race, which was reproduced with artificial latency.

---

## Running locally

Requires Node 20+ and Postgres 13+.

```bash
createdb bolt

cd api
cp .env.example .env          # point DATABASE_URL at your local Postgres
npm install
npm run migrate               # applies db/migrations/*.sql
npm run dev                   # http://localhost:8080

cd ../web                     # in a second terminal
npm install
npm run dev                   # http://localhost:5173
```

### Environment variables

**`api/.env`**

| Variable       | Meaning                                           |
| -------------- | ------------------------------------------------- |
| `DATABASE_URL` | Postgres connection string                         |
| `WEB_ORIGINS`  | Comma-separated browser origins allowed by CORS    |
| `PORT`         | Port to listen on (the host sets this in production)|
| `NODE_ENV`     | `development` or `production`                      |

**`web/.env.local`** (optional locally)

| Variable            | Meaning                                              |
| ------------------- | ---------------------------------------------------- |
| `VITE_API_BASE_URL` | Base URL of the API. Defaults to `:8080`.            |

`VITE_` variables are inlined into the built JavaScript and are public. Secrets
never carry that prefix.

---

## Database

Schema is checked in as `.sql` under [`db/migrations/`](db/migrations), applied
by `npm run migrate` from `api/`. The runner records what it has applied in a
`schema_migrations` table, so re-running is safe — which matters because it runs
against the production database on every deploy.

| Table            | Purpose                                        |
| ---------------- | ---------------------------------------------- |
| `users`          | Registered users and their hashed login code    |
| `sessions`       | Active logins, token stored hashed              |
| `login_attempts` | Append-only log backing the rate limiter        |
| `orders`         | Submitted checkout forms (`user_id` nullable)   |

---

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md).

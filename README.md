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
| `POST` | `/api/auth/recognize` | Is this email registered? Returns a boolean + first name |
| `POST` | `/api/auth/login`     | Verify a code, start a session                    |
| `POST` | `/api/auth/request-code` | Email a replacement code                       |
| `GET`  | `/api/auth/me`        | Current user, or `null`                           |
| `POST` | `/api/auth/logout`    | End the session                                   |
| `POST` | `/api/orders`         | Record a checkout submission                      |
| `GET`  | `/api/orders`         | The signed-in user's own orders                   |
| `GET`  | `/api/orders/latest-address` | The address this user last shipped to      |

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
return the same status, the same message, and take the same time. Code recovery
answers identically for a registered and an unregistered address too, so it
cannot be used to test whether an account exists.

**Codes are emailed as well as shown.** Losing a code would otherwise mean
losing the account permanently, since only the hash is stored. Note that hashing
costs the ability to *resend* a code -- recovery has to issue a new one, because
the original is genuinely unrecoverable. Email is optional: without an API key
the app behaves exactly as before.

**Order history is filtered by the session**, never by an id from the request, so
changing a value in a URL cannot surface somebody else's orders.

**A recognised returning customer's address is filled in for them**, which is
the point of recognising anyone: checkout collapses to a single click. Only
empty fields are filled, never ones already typed in, and there is always a way
to enter a different address. Guest orders are never offered back, even one
placed with the same email -- a guest order is not proof of owning the account.

### Known trade-offs

- **No CSRF protection.** Cross-domain cookies require `SameSite=None`, which
  gives up the browser's built-in defence. A production version needs CSRF
  tokens on state-changing routes.
- **Codes never expire and are reusable**, which makes them closer to a static
  password than a one-time code. Real OTPs are single-use and short-lived. This
  is deliberate rather than overlooked: the assignment states the user "will
  need this code to log in later", so expiry would lock out anyone returning the
  next day.
- **Requesting a replacement code invalidates the previous one once delivered**, so
  anyone who knows an address can rotate a stranger's code and break the one
  they had saved. They gain nothing, since the new code goes to the owner's
  inbox, but it is a nuisance -- hence a low per-address limit. A production
  system would email a one-time link that only replaces the code when followed,
  so an ignored request changes nothing.
- **Rate limiting is per email**, so someone who knows an address can lock its
  owner out for the window. Keying on IP as well would reduce this, at the cost
  of users behind shared NAT.
- **`/api/auth/recognize` reveals a registered user's first name**, so the
  login prompt can greet them by it. That is a deliberate product trade — the
  caller has proved nothing at that point — mitigated by a per-IP rate limit of
  30 checks a minute, which raises the cost of bulk harvesting without removing
  the leak. Nothing short of dropping the feature would remove it.
- **Expired session rows are never cleaned up.** They are ignored correctly, but
  accumulate.
- **The API's rate limiter is per-process and in memory**, so it resets on
  restart and is not shared between instances. That is acceptable for a speed
  bump and would not be for a security control; Redis is where it belongs at
  real volume.
- **Client-side validation duplicates the server's rules rather than sharing
  them**, since the two are separate packages. The duplication is made harmless
  by keeping the client's checks deliberately looser: a frontend stricter than
  the server would reject input the server would accept, and the user could not
  get past it.
- **No frontend tests.** The API has an integration suite; the React side was
  verified by hand, including the recognition race, which was reproduced by
  adding artificial latency to the endpoint.

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
| `GMAIL_USER`   | Optional. Gmail address that sends login codes     |
| `GMAIL_APP_PASSWORD` | Optional. Its app password; with `GMAIL_USER`, enables emailing codes and recovery |
| `RESEND_API_KEY` | Optional. Alternative to Gmail, used only when it is unset. Without a verified domain it only delivers to the Resend account's own address |
| `EMAIL_FROM`   | Optional, Resend only. Defaults to Resend's shared sender |
| `PORT`         | Port to listen on (the host sets this in production)|
| `NODE_ENV`     | `development` or `production`                      |

**`web/.env.local`** (optional locally)

| Variable            | Meaning                                              |
| ------------------- | ---------------------------------------------------- |
| `VITE_API_BASE_URL` | Base URL of the API. Defaults to `:8080`.            |

`VITE_` variables are inlined into the built JavaScript and are public. Secrets
never carry that prefix.

---

## Tests

```bash
cd api
npm test
```

31 integration tests covering the behaviour the design decisions exist for, not
the shape of the code: that the login code is never stored in plaintext, that
ten simultaneous registrations of one email produce exactly one user, that an
unknown email and a wrong code are indistinguishable, that a lockout refuses the
correct code too, that an expired session whose row still exists does not
authenticate, that logging out kills a token captured beforehand, that a forged
`user_id` in a request body is ignored, and that an injection payload is stored
as literal text.

They use Node's built-in test runner rather than adding a framework, and drive
the app in-process through supertest — which is what separating `app.ts` from
`index.ts` is for: no port to bind and no server to tear down. The script
creates and migrates a throwaway database (`TEST_DATABASE_URL` to override), so
a fresh checkout needs no setup.

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

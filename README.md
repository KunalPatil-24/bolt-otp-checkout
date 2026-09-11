# OTP-Based User Login — Checkout Demo

A checkout flow that recognises returning customers by email address and asks
them for a 6-digit code before revealing their account.

> **Status:** in progress. Project scaffold only — no functionality yet.

---

## Architecture

Three layers, deployed independently:

```
  Browser
     │  HTTPS
     ▼
┌─────────────────┐        ┌──────────────────┐        ┌───────────────┐
│  web/           │  ───▶  │  api/            │  ───▶  │  db/          │
│  React + TS     │        │  Node + Express  │        │  Postgres     │
│  Vite           │        │  TypeScript      │        │  .sql files   │
└─────────────────┘        └──────────────────┘        └───────────────┘
```

The browser never talks to Postgres. Every rule — validation, code
verification, session issuing — lives in the API, because the frontend is code
the user controls and can bypass entirely with `curl`.

| Directory | Layer    | Responsibility                                    |
| --------- | -------- | ------------------------------------------------- |
| `web/`    | Frontend | Draws the screens, collects input, calls the API   |
| `api/`    | API      | All logic. The only thing that talks to Postgres   |
| `db/`     | Database | Schema, as checked-in `.sql` migrations            |

### Why three separate npm packages rather than a workspace

`api/` and `web/` each have their own `package.json` and lockfile. Render builds
from `api/` and Vercel from `web/`, and both expect a self-contained project at
the directory they are pointed at. A workspace setup hoists dependencies to the
repository root, which defeats that. The cost is installing twice; the benefit
is that each layer is genuinely independent and deployable on its own.

### Stack

TypeScript throughout, rather than the suggested Go, on the grounds that the
assignment invites using what you are comfortable with — and a codebase you can
defend line by line is worth more than a less familiar one.

---

## Running locally

Requires Node 20+.

```bash
# API
cd api
npm install
npm run dev          # http://localhost:8080/api/health

# Frontend, in a second terminal
cd web
npm install
npm run dev          # http://localhost:5173
```

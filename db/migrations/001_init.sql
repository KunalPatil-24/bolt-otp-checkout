-- ============================================================================
-- 001_init.sql — initial schema
--
-- Apply with:
--     npm run migrate            (from api/, applies all pending)
--     psql -1 "$DATABASE_URL" -f db/migrations/001_init.sql
--
-- Requires Postgres 13+, for the built-in gen_random_uuid().
--
-- No BEGIN/COMMIT here: the migration runner wraps each file in a transaction
-- together with its bookkeeping row, so the two can never disagree. A file-level
-- BEGIN/COMMIT would end that outer transaction early. Use psql -1 to get the
-- same atomicity when applying by hand.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- users
--
-- A registered user: the fields the registration flow collects, plus the
-- 6-digit code they will log in with.
--
-- The code is stored as a bcrypt hash rather than plaintext. It is displayed
-- once in the registration response and is unrecoverable afterwards, because
-- nothing ever needs to read it back -- only to answer "does this submitted
-- code match?", which comparing hashes does.
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT        NOT NULL,
    first_name      TEXT        NOT NULL,
    last_name       TEXT        NOT NULL,
    login_code_hash TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email is case-insensitive in practice: alice@x.com and Alice@X.com are the
-- same person. This functional unique index enforces that in the database, so
-- an application bug cannot create two accounts for one address.
CREATE UNIQUE INDEX users_email_lower_key ON users (LOWER(email));


-- ----------------------------------------------------------------------------
-- orders
--
-- A submitted checkout form. No payment processing -- the assignment asks only
-- that the submission be recorded, so this row is the deliverable.
--
-- `user_id` is NULLABLE on purpose: the flow explicitly allows skipping the
-- login step, so an order with no account attached is a legitimate state rather
-- than a missing value.
-- ----------------------------------------------------------------------------
CREATE TABLE orders (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        REFERENCES users (id) ON DELETE SET NULL,
    email         TEXT        NOT NULL,
    phone         TEXT        NOT NULL,
    address_line1 TEXT        NOT NULL,
    address_line2 TEXT,
    city          TEXT        NOT NULL,
    state         TEXT        NOT NULL,
    postal_code   TEXT        NOT NULL,
    country       TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ON DELETE SET NULL, not CASCADE: an order is a business record in its own
-- right and should survive deletion of the account that placed it.

CREATE INDEX orders_user_id_idx ON orders (user_id);

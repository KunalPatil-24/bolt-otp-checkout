-- ============================================================================
-- 003_login_attempts.sql — rate limiting for code verification
--
-- A 6-digit numeric code has 10^6 possible values, so an attacker guessing at
-- 100 requests per second expects to find one in under two hours. Unlimited
-- guessing makes the code meaningless as a secret, regardless of how it is
-- stored.
--
-- This is the other half of the defence begun in 001. Hashing the code protects
-- it if the database leaks; counting attempts protects the live login against
-- guessing. Neither substitutes for the other.
--
-- An append-only log rather than a counter column: storing one timestamped row
-- per attempt lets the limit be a SLIDING window --
--
--     SELECT count(*) FROM login_attempts
--      WHERE LOWER(email) = $1 AND succeeded = false
--        AND created_at > now() - interval '15 minutes'
--
-- A fixed window (a counter reset every 15 minutes) can be walked straight
-- through: five attempts at 14:59 and five more at 15:01 is ten attempts in two
-- minutes, all within limits. Counting backwards from now has no boundary to
-- exploit.
--
-- It also doubles as an audit trail, which makes "was this account under
-- attack?" a question that can actually be answered.
-- ============================================================================


CREATE TABLE login_attempts (
    id         BIGSERIAL   PRIMARY KEY,
    email      TEXT        NOT NULL,
    succeeded  BOOLEAN     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- BIGSERIAL here, where the other tables use UUID. The difference is
-- deliberate: users, orders and sessions have identifiers that leave the
-- server, so they benefit from being unguessable. Nothing ever exposes a
-- login_attempts row, and this table takes a write on every attempt, so a
-- cheap sequential integer is the better fit.

-- No foreign key to users, on purpose: attempts against email addresses that
-- are not registered must also be recorded, and those are precisely the
-- attempts that matter most.

-- A composite index for the window query above. Order matters: the column
-- tested for equality (the email) comes first, the column tested as a range
-- (created_at) second. Reversed, Postgres could not use the index to narrow by
-- email before scanning the range.
CREATE INDEX login_attempts_email_created_idx
    ON login_attempts (LOWER(email), created_at DESC);

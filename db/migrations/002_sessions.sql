-- ============================================================================
-- 002_sessions.sql — server-side login state
--
-- HTTP is stateless: each request arrives with no memory of the last one. After
-- a code is verified, something has to carry that fact forward, and this table
-- is it.
--
-- The browser holds a long random token in an httpOnly cookie. This table holds
-- only the SHA-256 hash of that token, so read access to the database does not
-- yield a set of usable logins -- the same reasoning applied to login codes in
-- 001. On each request the API hashes the token it receives and looks for a
-- match here.
--
-- Sessions as rows, rather than a self-contained signed token, mean a login can
-- be revoked immediately by deleting the row.
-- ============================================================================

BEGIN;

CREATE TABLE sessions (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash TEXT        NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ON DELETE CASCADE above, unlike orders' ON DELETE SET NULL: a session belongs
-- to its user and means nothing without one, so it should disappear with them.
-- An order, by contrast, is a business record that outlives the account.

-- UNIQUE on token_hash is correctness (two sessions must never share a token)
-- and also creates the index that every authenticated request looks up by, so
-- no separate index is needed for it.

-- Supports "end every session for this user" -- signing out everywhere.
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- Supports clearing out expired rows, which would otherwise accumulate forever.
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

COMMIT;

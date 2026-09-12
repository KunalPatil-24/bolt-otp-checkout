#!/usr/bin/env bash
#
# Runs the test suite against a throwaway database, never the development one.
#
# Override the target with TEST_DATABASE_URL; the default is a local bolt_test.
# The database is created if missing and migrated before the tests run, so a
# fresh checkout needs no manual setup.
set -euo pipefail

TEST_DB_URL="${TEST_DATABASE_URL:-postgres://localhost:5432/bolt_test}"

if [[ "$TEST_DB_URL" == *localhost* || "$TEST_DB_URL" == *127.0.0.1* ]]; then
  DB_NAME="${TEST_DB_URL##*/}"
  createdb "$DB_NAME" 2>/dev/null && echo "created database $DB_NAME" || true
fi

export DATABASE_URL="$TEST_DB_URL"
export NODE_ENV=test

echo "→ migrating $TEST_DB_URL"
npm run migrate --silent

echo "→ running tests"
# --test-concurrency=1 runs the files one at a time. Node runs test files in
# parallel processes by default, and they all share this one database, so
# without it one file's TRUNCATE wipes rows another file is midway through
# using. The tests inside a file already run in order.
node --import tsx --test --test-concurrency=1 "tests/*.test.ts"

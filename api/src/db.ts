import 'dotenv/config';
import pg from 'pg';

/**
 * The database connection URL comes from the environment, never from source
 * control -- it contains a password.
 *
 * If it is missing we throw here, at import time, which stops the server from
 * starting at all. That is deliberate. The alternative is a server that boots
 * happily and then fails on a user's first request, turning a configuration
 * mistake into a production incident. Failing loudly at deploy time is much
 * cheaper than failing quietly at request time.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Copy api/.env.example to api/.env and fill it in.',
  );
}

/** Local Postgres does not speak TLS; hosted Postgres requires it. */
const isLocal = /@(localhost|127\.0\.0\.1)/.test(databaseUrl);

/**
 * A pool of connections, not a single connection.
 *
 * Opening a Postgres connection is expensive -- a TCP handshake, TLS
 * negotiation, and a new process on the database server -- so we open a few
 * once and hand them out as requests need them. A request borrows a connection,
 * runs its query, and returns it.
 *
 * max: 5 is deliberately small. Postgres connections are OS processes costing
 * memory and scheduling overhead, so a larger pool can reduce throughput rather
 * than improve it. Note also that this limit is PER PROCESS: two instances with
 * max 5 open ten connections to the database, and during a deploy the old and
 * new instance overlap. Five leaves comfortable headroom inside free-tier
 * limits, and every query here is an indexed lookup that holds its connection
 * for well under a millisecond.
 *
 * The signal that 5 is too low would be requests failing on
 * connectionTimeoutMillis below -- that is when to raise it, not before.
 */
export const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: isLocal ? undefined : { rejectUnauthorized: true },
  max: 5,
  idleTimeoutMillis: 30_000,   // release a connection unused for 30s
  connectionTimeoutMillis: 10_000, // give up waiting for a free one after 10s
});

/**
 * Pooled connections can die while idle -- a network blip, or the database
 * restarting. Without this listener Node treats that as an unhandled error
 * event and crashes the process.
 */
pool.on('error', (error) => {
  console.error('[db] idle client error:', error.message);
});

/**
 * A piece of SQL with its values kept separate.
 */
export type SqlQuery = { text: string; values: unknown[] };

/**
 * Builds a parameterised query from a template literal.
 *
 *     sql`SELECT * FROM users WHERE LOWER(email) = ${email}`
 *
 * This looks like string interpolation and is the opposite of it. JavaScript
 * hands a tag function the literal chunks and the interpolated values as two
 * separate arguments -- the value never becomes part of the string. We emit a
 * numbered placeholder in its place and collect the value, producing:
 *
 *     { text: 'SELECT * FROM users WHERE LOWER(email) = $1', values: [email] }
 *
 * The point is ergonomic rather than cryptographic: writing a query the natural
 * way now produces a safe one, instead of safety depending on remembering to
 * pass a second argument.
 *
 * NOTE: this protects VALUES only. Identifiers -- table and column names --
 * cannot be parameterised by any database driver, so `ORDER BY ${column}` is
 * still unsafe. Anything of that sort needs an allowlist of permitted names.
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlQuery {
  let text = '';
  const collected: unknown[] = [];

  strings.forEach((chunk, index) => {
    text += chunk;
    if (index < values.length) {
      collected.push(values[index]);
      text += `$${collected.length}`;
    }
  });

  return { text, values: collected };
}

/**
 * Runs a query.
 *
 * Accepts either the `sql` tagged form, which is the default for endpoints:
 *
 *     query(sql`SELECT * FROM users WHERE id = ${id}`)
 *
 * or an explicit text-and-parameters pair, for queries built dynamically:
 *
 *     query('SELECT * FROM users WHERE id = $1', [id])
 *
 * Both send the query text and the values to Postgres as separate things, so a
 * value is never parsed as SQL. That is what makes injection structurally
 * impossible here rather than something we have to remember to avoid. There is
 * deliberately no overload that takes a finished string with values already
 * embedded.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  textOrQuery: string | SqlQuery,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  if (typeof textOrQuery === 'string') {
    return pool.query<T>(textOrQuery, params);
  }
  return pool.query<T>(textOrQuery.text, textOrQuery.values);
}

/** True if the database is reachable. Used by the health endpoint. */
export async function isDatabaseReachable(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

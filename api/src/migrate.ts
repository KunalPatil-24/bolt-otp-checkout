/**
 * Migration runner.
 *
 *     npm run migrate
 *
 * Applies every .sql file in db/migrations that has not been applied yet, in
 * filename order, and records each one so that running it again is safe.
 *
 * That last property is the point. This same command runs against the
 * production database on every deploy, and nobody should have to remember -- or
 * look up -- which files have already been applied.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

// Resolved relative to this file rather than to the current working directory,
// so the command works the same whether it is run from api/ or anywhere else,
// and whether it runs as TypeScript via tsx or as compiled JavaScript in dist/.
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'db',
  'migrations',
);

async function main(): Promise<void> {
  // The table that records what has run. Created here rather than in a
  // migration, because it has to exist before any migration can be tracked.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  );
  const alreadyApplied = new Set(rows.map((row) => row.filename));

  // Lexicographic sort. This is why the files are zero-padded 001, 002, 003 --
  // without the padding, "10_x.sql" would sort before "9_x.sql" and migrations
  // would run out of order.
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found in db/migrations.');
    await pool.end();
    return;
  }

  let appliedCount = 0;

  for (const filename of files) {
    if (alreadyApplied.has(filename)) {
      console.log(`  skip   ${filename}`);
      continue;
    }

    const sql = readFileSync(join(migrationsDir, filename), 'utf8');
    process.stdout.write(`  apply  ${filename} ... `);

    // A single connection, so the migration and the record of it share one
    // transaction: either both land or neither does. Using the pool directly
    // would not guarantee the same connection, and a transaction lives on a
    // connection.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      appliedCount += 1;
      console.log('ok');
    } catch (error) {
      await client.query('ROLLBACK');
      console.log('FAILED');
      console.error(`\nMigration ${filename} failed. Nothing from it was applied.\n`);
      throw error;
    } finally {
      // Always hand the connection back, success or failure, or the pool leaks
      // and eventually has nothing left to give out.
      client.release();
    }
  }

  console.log(
    appliedCount === 0
      ? '\nDatabase already up to date.'
      : `\nApplied ${appliedCount} migration(s).`,
  );
  await pool.end();
}

// Stop on the first failure rather than continuing: later migrations generally
// assume earlier ones succeeded, so ploughing on turns one clear error into
// several confusing ones. A non-zero exit code also fails the deploy.
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

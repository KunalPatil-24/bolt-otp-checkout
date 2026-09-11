# Database layer

Postgres. The schema lives here as numbered `.sql` files, which are the source
of truth — nothing generates them, and nothing else defines the schema.

```
migrations/
  001_....sql
```

Files are applied in filename order by the runner in `api/src/migrate.ts`, which
records what it has already applied so that re-running is safe.

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const MIGRATION_LOCK = 72_724_201;

// Postgres type ids we parse ourselves: DATE stays a plain 'YYYY-MM-DD' string (no timezone
// surprises) and int8 (COUNT(*)) becomes a JS number.
const TYPE_DATE = 1082;
const TYPE_INT8 = 20;

/**
 * Open the database. In production this is a real Postgres server (DATABASE_URL).
 * Without one, it falls back to PGlite — Postgres compiled to WebAssembly — so development and
 * tests run against the same SQL with nothing to install. `memory://` gives a throwaway database.
 */
async function openDb(url = process.env.DATABASE_URL || 'pglite://data/pglite', { searchPath } = {}) {
  if (/^postgres(ql)?:\/\//.test(url)) return openPg(url, searchPath);
  return openPglite(url === 'memory://' ? undefined : url.replace(/^pglite:\/\//, ''));
}

async function openPg(url, searchPath) {
  const pg = require('pg');
  pg.types.setTypeParser(TYPE_DATE, (v) => v);
  pg.types.setTypeParser(TYPE_INT8, (v) => Number(v));
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_SIZE) || 10,
    // Managed providers use TLS; verify it unless explicitly told the server has a private CA.
    ssl: /sslmode=disable/.test(url) ? false : { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== '1' },
  });
  // Used by tests to give each run its own schema.
  if (searchPath) {
    if (!/^[a-z_][a-z0-9_]*$/.test(searchPath)) throw new Error('Invalid search path');
    pool.on('connect', (client) => client.query(`SET search_path TO ${searchPath}`));
  }
  const wrap = (client) => ({
    query: async (sql, params = []) => (await client.query(sql, params)).rows,
    one: async (sql, params = []) => (await client.query(sql, params)).rows[0] || null,
    exec: (sql) => client.query(sql),
  });
  return {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openPglite(dataDir) {
  const { PGlite } = require('@electric-sql/pglite');
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir, {
    parsers: { [TYPE_DATE]: (v) => v, [TYPE_INT8]: (v) => Number(v) },
  });
  await db.waitReady;
  const wrap = (client) => ({
    query: async (sql, params = []) => (await client.query(sql, params)).rows,
    one: async (sql, params = []) => (await client.query(sql, params)).rows[0] || null,
    exec: (sql) => client.exec(sql),
  });
  return {
    ...wrap(db),
    tx: (fn) => db.transaction((tx) => fn(wrap(tx))),
    close: () => db.close(),
  };
}

/** Apply any migrations in /migrations that haven't run yet, in filename order. */
async function migrate(db, { log = () => {} } = {}) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  // Several app instances may boot at once; only one runs migrations.
  await db.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
  try {
    const done = new Set((await db.query('SELECT version FROM schema_migrations')).map((r) => r.version));
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await db.tx(async (tx) => {
        await tx.exec(sql);
        await tx.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      });
      log(`Applied migration ${file}`);
    }
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
  }
}

module.exports = { openDb, migrate };

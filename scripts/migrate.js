// Apply database migrations:  npm run migrate
const { loadConfig } = require('../src/config');
const { openDb, migrate } = require('../src/db');

async function main() {
  const db = await openDb(loadConfig().databaseUrl);
  await migrate(db, { log: console.log });
  await db.close();
  console.log('Database is up to date.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

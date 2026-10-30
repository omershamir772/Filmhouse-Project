// Give (or take away) admin rights:  npm run make-admin -- <username> [--remove]
const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db');

async function main() {
  const username = process.argv[2];
  const remove = process.argv.includes('--remove');
  if (!username) throw new Error('Usage: npm run make-admin -- <username> [--remove]');
  const db = await openDb(loadConfig().databaseUrl);
  const user = await db.one('UPDATE users SET role = $1 WHERE lower(username) = lower($2) RETURNING username, role', [remove ? 'member' : 'admin', username]);
  if (!user) throw new Error(`No member called @${username}.`);
  await db.query("INSERT INTO audit_log (actor_id, actor_name, action, target_type, details) VALUES (NULL, 'command line', $1, 'user', $2)", [
    remove ? 'remove-admin' : 'make-admin',
    user.username,
  ]);
  await db.close();
  console.log(`@${user.username} is now ${user.role === 'admin' ? 'an admin' : 'a regular member'}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

const { REQUIRED_ROLES, ALL_ROLES } = require('../constants');
const { toList } = require('./text');

/**
 * Turn the parallel credit_role[] / credit_person[] form arrays into credit rows.
 *
 * A person written as "@username" is linked to that member's profile; anything else is
 * credited by name only (for crew who haven't joined FilmHouse yet).
 */
async function parseCredits(db, body) {
  const roles = toList(body.credit_role);
  const people = toList(body.credit_person);
  const credits = [];
  const errors = [];
  const seen = new Set();

  for (const [i, rawRole] of roles.entries()) {
    const role = String(rawRole || '').trim();
    const person = String(people[i] || '').trim();
    if (!person) continue;
    if (!ALL_ROLES.includes(role)) {
      errors.push(`Pick a role for ${person}.`);
      continue;
    }
    if (person.length > 80) {
      errors.push('Credit names must be under 80 characters.');
      continue;
    }
    let credit;
    if (person.startsWith('@')) {
      const user = await db.one('SELECT id, username, display_name FROM users WHERE lower(username) = lower($1) AND suspended_at IS NULL', [
        person.slice(1),
      ]);
      if (!user) {
        errors.push(`There's no FilmHouse member called ${person}. Remove the @ to credit them by name.`);
        continue;
      }
      credit = { role, user_id: user.id, name: user.display_name, input: person };
    } else {
      credit = { role, user_id: null, name: person, input: person };
    }
    const key = `${role}|${credit.user_id ?? credit.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    credits.push({ ...credit, position: credits.length });
  }
  if (credits.length > 60) errors.push('That is a lot of credits — please keep it to 60.');

  for (const role of REQUIRED_ROLES) {
    if (!credits.some((c) => c.role === role)) errors.push(`Every film needs a credited ${role}.`);
  }
  return { credits, errors };
}

// The rows to pre-fill the credit editor with: required roles first, then any extras.
function creditFormRows(credits = []) {
  const rows = credits.map((c) => ({ role: c.role, person: c.input ?? (c.username ? '@' + c.username : c.name) }));
  for (const role of REQUIRED_ROLES) {
    if (!rows.some((r) => r.role === role)) rows.push({ role, person: '' });
  }
  rows.sort((a, b) => Number(!REQUIRED_ROLES.includes(a.role)) - Number(!REQUIRED_ROLES.includes(b.role)));
  rows.push({ role: '', person: '' }, { role: '', person: '' });
  return rows;
}

async function saveCredits(db, filmId, credits) {
  await db.query('DELETE FROM credits WHERE film_id = $1', [filmId]);
  for (const c of credits) {
    await db.query('INSERT INTO credits (film_id, role, user_id, name, position) VALUES ($1, $2, $3, $4, $5)', [
      filmId,
      c.role,
      c.user_id,
      c.name,
      c.position,
    ]);
  }
}

module.exports = { parseCredits, creditFormRows, saveCredits };

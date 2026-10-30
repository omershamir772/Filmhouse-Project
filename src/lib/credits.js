const { REQUIRED_ROLES, ALL_ROLES } = require('../constants');
const { toList } = require('./text');

/**
 * Turn the parallel credit_role[] / credit_person[] form arrays into credit rows.
 *
 * A person written as "@username" is linked to that member's profile; anything else is
 * credited by name only (for crew who haven't joined FilmHouse yet).
 */
function parseCredits(db, body) {
  const roles = toList(body.credit_role);
  const people = toList(body.credit_person);
  const findUser = db.prepare('SELECT id, username, display_name FROM users WHERE username = ?');
  const credits = [];
  const errors = [];
  const seen = new Set();

  roles.forEach((rawRole, i) => {
    const role = String(rawRole || '').trim();
    const person = String(people[i] || '').trim();
    if (!person) return;
    if (!ALL_ROLES.includes(role)) {
      errors.push(`Pick a role for ${person}.`);
      return;
    }
    if (person.length > 80) {
      errors.push('Credit names must be under 80 characters.');
      return;
    }
    let credit;
    if (person.startsWith('@')) {
      const user = findUser.get(person.slice(1).toLowerCase());
      if (!user) {
        errors.push(`There's no FilmHouse member called ${person}. Remove the @ to credit them by name.`);
        return;
      }
      credit = { role, user_id: user.id, name: user.display_name, input: person };
    } else {
      credit = { role, user_id: null, name: person, input: person };
    }
    const key = `${role}|${credit.user_id ?? credit.name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    credits.push({ ...credit, position: credits.length });
  });

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

function saveCredits(db, filmId, credits) {
  db.prepare('DELETE FROM credits WHERE film_id = ?').run(filmId);
  const insert = db.prepare('INSERT INTO credits (film_id, role, user_id, name, position) VALUES (?, ?, ?, ?, ?)');
  for (const c of credits) insert.run(filmId, c.role, c.user_id, c.name, c.position);
}

module.exports = { parseCredits, creditFormRows, saveCredits };

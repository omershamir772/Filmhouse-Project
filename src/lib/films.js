const { embedUrl, thumbnailUrl } = require('./video');
const { REQUIRED_ROLES, ALL_ROLES } = require('../constants');

// Recommendations take real effort, so they weigh much more than a view.
const RECOMMENDATION_WEIGHT = 10;

function decorateFilm(film) {
  if (!film) return film;
  return {
    ...film,
    embed: embedUrl(film.provider, film.video_id),
    thumbnail: thumbnailUrl(film.provider, film.video_id),
  };
}

function roleOrder(role) {
  const i = ALL_ROLES.indexOf(role);
  return i === -1 ? ALL_ROLES.length : i;
}

function creditsForFilm(db, filmId) {
  const rows = db
    .prepare(`
      SELECT c.*, u.username, u.display_name
      FROM credits c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.film_id = ? ORDER BY c.position, c.id`)
    .all(filmId);
  return rows.sort((a, b) => roleOrder(a.role) - roleOrder(b.role) || a.position - b.position);
}

// Group credits as [{ role, people: [...] }] in canonical role order.
function groupCredits(credits) {
  const groups = new Map();
  for (const c of credits) {
    if (!groups.has(c.role)) groups.set(c.role, []);
    groups.get(c.role).push(c);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => roleOrder(a) - roleOrder(b))
    .map(([role, people]) => ({ role, people, required: REQUIRED_ROLES.includes(role) }));
}

// Attach a short "dir. X" line to a list of films.
function withDirectors(db, films) {
  const stmt = db.prepare(`SELECT name FROM credits WHERE film_id = ? AND role = 'Director' ORDER BY position`);
  return films.map((f) => ({ ...decorateFilm(f), directors: stmt.all(f.id).map((r) => r.name) }));
}

/**
 * Films ranked by activity in a recent window. `window` is an SQLite datetime modifier, e.g. '-1 day'.
 */
function popularFilms(db, window, limit = 6) {
  const rows = db
    .prepare(`
      SELECT f.*, u.username AS owner_username, u.display_name AS owner_name,
        (SELECT COUNT(*) FROM film_views v WHERE v.film_id = f.id AND v.viewed_at >= datetime('now', :window)) AS views,
        (SELECT COUNT(*) FROM recommendations r WHERE r.film_id = f.id AND r.created_at >= datetime('now', :window)) AS recs
      FROM films f JOIN users u ON u.id = f.owner_id
      WHERE views + recs > 0
      ORDER BY views + recs * ${RECOMMENDATION_WEIGHT} DESC, f.created_at DESC
      LIMIT :limit`)
    .all({ window, limit });
  return withDirectors(db, rows);
}

function recordView(db, filmId, viewer) {
  db.prepare('INSERT OR IGNORE INTO film_views (film_id, viewer) VALUES (?, ?)').run(filmId, viewer);
}

module.exports = { decorateFilm, creditsForFilm, groupCredits, withDirectors, popularFilms, recordView, roleOrder };

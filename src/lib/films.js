const crypto = require('node:crypto');
const { embedUrl, thumbnailUrl } = require('./video');
const { REQUIRED_ROLES, ALL_ROLES } = require('../constants');

// Recommendations take real effort, so they weigh much more than a view.
const RECOMMENDATION_WEIGHT = 10;

function decorateFilm(film) {
  if (!film) return film;
  return { ...film, embed: embedUrl(film.provider, film.video_id), thumbnail: thumbnailUrl(film.provider, film.video_id) };
}

function roleOrder(role) {
  const i = ALL_ROLES.indexOf(role);
  return i === -1 ? ALL_ROLES.length : i;
}

async function creditsForFilm(db, filmId) {
  const rows = await db.query(
    `SELECT c.*, u.username, u.display_name
     FROM credits c LEFT JOIN users u ON u.id = c.user_id AND u.suspended_at IS NULL
     WHERE c.film_id = $1 ORDER BY c.position, c.id`,
    [filmId],
  );
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
async function withDirectors(db, films) {
  if (!films.length) return [];
  const rows = await db.query(
    `SELECT film_id, name FROM credits WHERE film_id = ANY($1::int[]) AND role = 'Director' ORDER BY position`,
    [films.map((f) => f.id)],
  );
  return films.map((f) => ({ ...decorateFilm(f), directors: rows.filter((r) => r.film_id === f.id).map((r) => r.name) }));
}

/** Films ranked by activity in a recent window, e.g. '1 day' or '7 days'. */
async function popularFilms(db, window, limit = 6) {
  const rows = await db.query(
    `SELECT * FROM (
       SELECT f.*, u.username AS owner_username, u.display_name AS owner_name,
         (SELECT COUNT(*) FROM film_views v WHERE v.film_id = f.id AND v.viewed_at >= now() - $1::interval) AS views,
         (SELECT COUNT(*) FROM recommendations r WHERE r.film_id = f.id AND r.hidden_at IS NULL AND r.created_at >= now() - $1::interval) AS recs
       FROM films f JOIN users u ON u.id = f.owner_id
       WHERE f.hidden_at IS NULL AND u.suspended_at IS NULL
     ) ranked
     WHERE views + recs > 0
     ORDER BY views + recs * ${RECOMMENDATION_WEIGHT} DESC, created_at DESC
     LIMIT $2`,
    [window, limit],
  );
  return withDirectors(db, rows);
}

/**
 * A viewer id for de-duplicating views. Keyed with the app secret and today's date, so it can't be
 * reversed into an IP address and can't be linked across days.
 */
function viewerId(req) {
  if (req.user) return `u${req.user.id}`;
  const day = new Date().toISOString().slice(0, 10);
  return crypto
    .createHmac('sha256', req.app.locals.config.appSecret)
    .update(`${day}|${req.ip}|${req.get('user-agent') || ''}`)
    .digest('hex')
    .slice(0, 32);
}

async function recordView(db, filmId, viewer) {
  await db.query('INSERT INTO film_views (film_id, viewer) VALUES ($1, $2) ON CONFLICT DO NOTHING', [filmId, viewer]);
}

module.exports = { decorateFilm, creditsForFilm, groupCredits, withDirectors, popularFilms, recordView, viewerId, roleOrder };

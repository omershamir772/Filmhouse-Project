const express = require('express');

const { requireAuth, requireVerified } = require('../lib/auth');
const { rateLimit } = require('../lib/rateLimit');
const { parseVideoUrl } = require('../lib/video');
const { wordCount } = require('../lib/text');
const { parseCredits, creditFormRows, saveCredits } = require('../lib/credits');
const { decorateFilm, creditsForFilm, groupCredits, withDirectors, recordView, viewerId } = require('../lib/films');
const { blockedIds } = require('../lib/moderation');
const { ALL_ROLES, MIN_RECOMMENDATION_WORDS } = require('../constants');

const router = express.Router();
const postLimit = rateLimit('postsPerUser', (req) => req.user.id);

async function loadFilm(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return next('route');
  const film = await req.app.locals.db.one(
    `SELECT f.*, u.username AS owner_username, u.display_name AS owner_name
     FROM films f JOIN users u ON u.id = f.owner_id
     WHERE f.id = $1 AND u.suspended_at IS NULL`,
    [id],
  );
  // Hidden films stay visible to their owner (so they know) and to admins (to review them).
  if (!film || (film.hidden_at && req.user?.id !== film.owner_id && req.user?.role !== 'admin')) return next('route');
  req.film = decorateFilm(film);
  next();
}

function requireOwner(req, res, next) {
  if (req.film.owner_id === req.user.id) return next();
  res.status(403).render('error', { title: 'Not your reel', message: 'Only the person who added this film can change it.' });
}

async function memberOptions(db) {
  return db.query('SELECT username, display_name FROM users WHERE suspended_at IS NULL ORDER BY display_name LIMIT 2000');
}

function readFilmForm(body) {
  return {
    title: String(body.title || '').trim(),
    year: body.year ? Number(body.year) : null,
    runtime_min: body.runtime_min ? Number(body.runtime_min) : null,
    logline: String(body.logline || '').trim(),
    video_url: String(body.video_url || '').trim(),
  };
}

function validateFilm(form) {
  const errors = [];
  if (!form.title || form.title.length > 120) errors.push('Give your film a title (up to 120 characters).');
  const thisYear = new Date().getFullYear();
  if (form.year !== null && !(Number.isInteger(form.year) && form.year >= 1888 && form.year <= thisYear + 1)) {
    errors.push(`Year should be between 1888 and ${thisYear + 1}.`);
  }
  if (form.runtime_min !== null && !(Number.isInteger(form.runtime_min) && form.runtime_min > 0 && form.runtime_min < 1000)) {
    errors.push('Runtime should be a number of minutes.');
  }
  if (form.logline.length > 400) errors.push('Keep the logline under 400 characters.');
  if (form.video_url.length > 500) errors.push('That link is too long.');
  const video = parseVideoUrl(form.video_url);
  if (!video) errors.push('Paste a YouTube or Vimeo link to your film.');
  return { errors, video };
}

async function renderForm(res, status, locals) {
  res.status(status).render('films/form', { members: await memberOptions(res.app.locals.db), errors: [], ...locals });
}

function isCredited(film, credits, userId) {
  return film.owner_id === userId || credits.some((c) => c.user_id === userId);
}

router.get('/films', async (req, res) => {
  const db = req.app.locals.db;
  const q = String(req.query.q || '').trim().slice(0, 100);
  const role = ALL_ROLES.includes(req.query.role) ? req.query.role : '';
  const films = await db.query(
    `SELECT f.*, u.username AS owner_username, u.display_name AS owner_name
     FROM films f JOIN users u ON u.id = f.owner_id
     WHERE f.hidden_at IS NULL AND u.suspended_at IS NULL
       AND ($1 = '' OR f.title ILIKE '%' || $1 || '%' OR f.logline ILIKE '%' || $1 || '%'
            OR EXISTS (SELECT 1 FROM credits c WHERE c.film_id = f.id AND c.name ILIKE '%' || $1 || '%'))
       AND ($2 = '' OR EXISTS (SELECT 1 FROM credits c WHERE c.film_id = f.id AND c.role = $2 AND c.user_id IS NOT NULL))
     ORDER BY f.created_at DESC, f.id DESC LIMIT 60`,
    [q, role],
  );
  res.render('films/index', { title: 'Films', films: await withDirectors(db, films), q, role });
});

router.get('/films/new', requireVerified, async (req, res) => {
  const me = { role: 'Director', person: '@' + req.user.username };
  await renderForm(res, 200, {
    title: 'Add a film',
    film: null,
    form: {},
    rows: creditFormRows([]).map((r, i) => (i === 0 && r.role === me.role ? me : r)),
  });
});

router.post('/films', requireVerified, postLimit, async (req, res) => {
  const db = req.app.locals.db;
  const form = readFilmForm(req.body);
  const { errors, video } = validateFilm(form);
  const { credits, errors: creditErrors } = await parseCredits(db, req.body);
  errors.push(...creditErrors);
  if (errors.length) return renderForm(res, 422, { title: 'Add a film', film: null, form, rows: creditFormRows(credits), errors });

  const filmId = await db.tx(async (tx) => {
    const film = await tx.one(
      `INSERT INTO films (owner_id, title, year, runtime_min, logline, video_url, provider, video_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [req.user.id, form.title, form.year, form.runtime_min, form.logline, form.video_url, video.provider, video.id],
    );
    await saveCredits(tx, film.id, credits);
    return film.id;
  });
  res.redirect(`/films/${filmId}`);
});

async function renderFilmPage(req, res, status, { recForm, recErrors = [] }) {
  const db = req.app.locals.db;
  const film = req.film;
  const blocked = await blockedIds(db, req.user);
  const credits = await creditsForFilm(db, film.id);
  const recommendations = (
    await db.query(
      `SELECT r.*, u.username, u.display_name, u.status
       FROM recommendations r JOIN users u ON u.id = r.author_id
       WHERE r.film_id = $1 AND r.hidden_at IS NULL AND u.suspended_at IS NULL
       ORDER BY r.created_at DESC, r.id DESC`,
      [film.id],
    )
  ).filter((r) => !blocked.has(r.author_id));
  const photos = (
    await db.query(
      `SELECT p.*, u.username, u.display_name FROM set_photos p JOIN users u ON u.id = p.author_id
       WHERE p.film_id = $1 AND p.hidden_at IS NULL AND u.suspended_at IS NULL
       ORDER BY p.created_at DESC LIMIT 12`,
      [film.id],
    )
  ).filter((p) => !blocked.has(p.author_id));

  res.status(status).render('films/show', {
    title: film.title,
    film,
    creditGroups: groupCredits(credits),
    recommendations,
    recRoles: [...new Set(credits.map((c) => c.role))],
    isCredited: Boolean(req.user && isCredited(film, credits, req.user.id)),
    photos,
    recForm,
    recErrors,
  });
}

router.get('/films/:id', loadFilm, async (req, res) => {
  if (!req.user || req.user.id !== req.film.owner_id) await recordView(req.app.locals.db, req.film.id, viewerId(req));
  await renderFilmPage(req, res, 200, { recForm: { role: String(req.query.role || ''), body: '' } });
});

router.get('/films/:id/edit', requireAuth, loadFilm, requireOwner, async (req, res) => {
  const credits = await creditsForFilm(req.app.locals.db, req.film.id);
  await renderForm(res, 200, { title: `Edit ${req.film.title}`, film: req.film, form: req.film, rows: creditFormRows(credits) });
});

router.post('/films/:id', requireVerified, loadFilm, requireOwner, async (req, res) => {
  const db = req.app.locals.db;
  const form = readFilmForm(req.body);
  const { errors, video } = validateFilm(form);
  const { credits, errors: creditErrors } = await parseCredits(db, req.body);
  errors.push(...creditErrors);
  if (errors.length) {
    return renderForm(res, 422, { title: `Edit ${req.film.title}`, film: req.film, form, rows: creditFormRows(credits), errors });
  }
  await db.tx(async (tx) => {
    await tx.query(
      `UPDATE films SET title = $1, year = $2, runtime_min = $3, logline = $4, video_url = $5, provider = $6, video_id = $7 WHERE id = $8`,
      [form.title, form.year, form.runtime_min, form.logline, form.video_url, video.provider, video.id, req.film.id],
    );
    await saveCredits(tx, req.film.id, credits);
  });
  res.redirect(`/films/${req.film.id}`);
});

router.post('/films/:id/delete', requireAuth, loadFilm, requireOwner, async (req, res) => {
  await req.app.locals.db.query('DELETE FROM films WHERE id = $1', [req.film.id]);
  res.redirect(`/u/${req.user.username}`);
});

router.post('/films/:id/recommendations', requireVerified, loadFilm, postLimit, async (req, res) => {
  const db = req.app.locals.db;
  const film = req.film;
  const credits = await creditsForFilm(db, film.id);
  const role = String(req.body.role || '');
  const body = String(req.body.body || '').trim();
  const words = wordCount(body);
  const errors = [];

  if (isCredited(film, credits, req.user.id)) {
    errors.push("You worked on this film, so you can't recommend it — let the audience speak.");
  }
  // Someone the crew has blocked can't write about their work.
  const crewIds = [film.owner_id, ...credits.map((c) => c.user_id).filter(Boolean)];
  const blockedBy = await db.one('SELECT 1 FROM blocks WHERE blocked_id = $1 AND blocker_id = ANY($2::int[])', [req.user.id, crewIds]);
  if (blockedBy) errors.push("You can't recommend this film.");
  if (!credits.some((c) => c.role === role)) errors.push('Choose which craft your recommendation is about.');
  if (words < MIN_RECOMMENDATION_WORDS) {
    errors.push(`Recommendations need at least ${MIN_RECOMMENDATION_WORDS} words — you have ${words}. Take your time; tell them what worked and why.`);
  }
  if (body.length > 20000) errors.push('That recommendation is too long.');
  if (!errors.length) {
    const exists = await db.one('SELECT 1 FROM recommendations WHERE film_id = $1 AND author_id = $2 AND role = $3', [film.id, req.user.id, role]);
    if (exists) errors.push(`You've already recommended the ${role.toLowerCase()} on this film.`);
  }
  if (errors.length) return renderFilmPage(req, res, 422, { recForm: { role, body }, recErrors: errors });

  await db.query('INSERT INTO recommendations (film_id, author_id, role, body, word_count) VALUES ($1, $2, $3, $4, $5)', [
    film.id,
    req.user.id,
    role,
    body,
    words,
  ]);
  res.redirect(`/films/${film.id}#recommendations`);
});

router.post('/recommendations/:id/delete', requireAuth, async (req, res) => {
  const db = req.app.locals.db;
  const rec = await db.one('SELECT * FROM recommendations WHERE id = $1', [Number(req.params.id) || 0]);
  if (!rec || rec.author_id !== req.user.id) {
    return res.status(404).render('error', { title: 'Not found', message: "That recommendation doesn't exist." });
  }
  await db.query('DELETE FROM recommendations WHERE id = $1', [rec.id]);
  res.redirect(`/films/${rec.film_id}#recommendations`);
});

module.exports = router;

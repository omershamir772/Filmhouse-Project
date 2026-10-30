const crypto = require('node:crypto');
const express = require('express');

const { requireAuth } = require('../lib/auth');
const { transaction } = require('../db');
const { parseVideoUrl } = require('../lib/video');
const { wordCount } = require('../lib/text');
const { parseCredits, creditFormRows, saveCredits } = require('../lib/credits');
const { decorateFilm, creditsForFilm, groupCredits, withDirectors, recordView } = require('../lib/films');
const { ALL_ROLES, MIN_RECOMMENDATION_WORDS } = require('../constants');

const router = express.Router();

function loadFilm(req, res, next) {
  const film = req.app.locals.db
    .prepare(`
      SELECT f.*, u.username AS owner_username, u.display_name AS owner_name
      FROM films f JOIN users u ON u.id = f.owner_id WHERE f.id = ?`)
    .get(Number(req.params.id) || 0);
  if (!film) return next();
  req.film = decorateFilm(film);
  next();
}

function requireOwner(req, res, next) {
  if (req.film.owner_id === req.user.id) return next();
  res.status(403).render('error', { title: 'Not your reel', message: 'Only the person who added this film can change it.' });
}

function memberOptions(db) {
  return db.prepare('SELECT username, display_name FROM users ORDER BY display_name').all();
}

function readFilmForm(body) {
  const year = body.year ? Number(body.year) : null;
  const runtime = body.runtime_min ? Number(body.runtime_min) : null;
  return {
    title: String(body.title || '').trim(),
    year,
    runtime_min: runtime,
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
  const video = parseVideoUrl(form.video_url);
  if (!video) errors.push('Paste a YouTube or Vimeo link to your film.');
  return { errors, video };
}

function renderForm(res, status, locals) {
  res.status(status).render('films/form', {
    members: memberOptions(res.app.locals.db),
    errors: [],
    ...locals,
  });
}

router.get('/films', (req, res) => {
  const db = req.app.locals.db;
  const q = String(req.query.q || '').trim();
  const role = ALL_ROLES.includes(req.query.role) ? req.query.role : '';
  const params = { q: `%${q}%`, role };
  const films = db
    .prepare(`
      SELECT DISTINCT f.*, u.username AS owner_username, u.display_name AS owner_name,
        (SELECT COUNT(*) FROM recommendations r WHERE r.film_id = f.id) AS rec_count
      FROM films f JOIN users u ON u.id = f.owner_id
      LEFT JOIN credits c ON c.film_id = f.id
      WHERE (:q = '%%' OR f.title LIKE :q OR f.logline LIKE :q OR c.name LIKE :q)
        AND (:role = '' OR f.id IN (SELECT film_id FROM credits WHERE role = :role AND user_id IS NOT NULL))
      ORDER BY f.created_at DESC, f.id DESC LIMIT 60`)
    .all(params);
  res.render('films/index', { title: 'Films', films: withDirectors(db, films), q, role });
});

router.get('/films/new', requireAuth, (req, res) => {
  const me = { role: 'Director', person: '@' + req.user.username };
  renderForm(res, 200, {
    title: 'Add a film',
    film: null,
    form: {},
    rows: creditFormRows([]).map((r, i) => (i === 0 && r.role === me.role ? me : r)),
  });
});

router.post('/films', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const form = readFilmForm(req.body);
  const { errors, video } = validateFilm(form);
  const { credits, errors: creditErrors } = parseCredits(db, req.body);
  errors.push(...creditErrors);
  if (errors.length) {
    return renderForm(res, 422, { title: 'Add a film', film: null, form, rows: creditFormRows(credits), errors });
  }
  const filmId = transaction(db, () => {
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO films (owner_id, title, year, runtime_min, logline, video_url, provider, video_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, form.title, form.year, form.runtime_min, form.logline, form.video_url, video.provider, video.id);
    saveCredits(db, lastInsertRowid, credits);
    return lastInsertRowid;
  });
  res.redirect(`/films/${filmId}`);
});

function renderFilmPage(req, res, status, { recForm, recErrors = [] }) {
  const db = req.app.locals.db;
  const film = req.film;
  const credits = creditsForFilm(db, film.id);
  const recommendations = db
    .prepare(`
      SELECT r.*, u.username, u.display_name, u.status
      FROM recommendations r JOIN users u ON u.id = r.author_id
      WHERE r.film_id = ? ORDER BY r.created_at DESC, r.id DESC`)
    .all(film.id);
  const photos = db
    .prepare(`
      SELECT p.*, u.username, u.display_name FROM set_photos p JOIN users u ON u.id = p.author_id
      WHERE p.film_id = ? ORDER BY p.created_at DESC LIMIT 12`)
    .all(film.id);

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

function isCredited(film, credits, userId) {
  return film.owner_id === userId || credits.some((c) => c.user_id === userId);
}

router.get('/films/:id', loadFilm, (req, res) => {
  // Count unique visitors per day without storing anything identifying.
  const viewer = req.user
    ? `u${req.user.id}`
    : crypto.createHash('sha256').update(`${req.ip}|${req.get('user-agent') || ''}`).digest('hex').slice(0, 32);
  if (!req.user || req.user.id !== req.film.owner_id) recordView(req.app.locals.db, req.film.id, viewer);
  renderFilmPage(req, res, 200, { recForm: { role: String(req.query.role || ''), body: '' } });
});

router.get('/films/:id/edit', requireAuth, loadFilm, requireOwner, (req, res) => {
  const credits = creditsForFilm(req.app.locals.db, req.film.id);
  renderForm(res, 200, { title: `Edit ${req.film.title}`, film: req.film, form: req.film, rows: creditFormRows(credits) });
});

router.post('/films/:id', requireAuth, loadFilm, requireOwner, (req, res) => {
  const db = req.app.locals.db;
  const form = readFilmForm(req.body);
  const { errors, video } = validateFilm(form);
  const { credits, errors: creditErrors } = parseCredits(db, req.body);
  errors.push(...creditErrors);
  if (errors.length) {
    return renderForm(res, 422, { title: `Edit ${req.film.title}`, film: req.film, form, rows: creditFormRows(credits), errors });
  }
  transaction(db, () => {
    db.prepare(`UPDATE films SET title = ?, year = ?, runtime_min = ?, logline = ?, video_url = ?, provider = ?, video_id = ?
                WHERE id = ?`)
      .run(form.title, form.year, form.runtime_min, form.logline, form.video_url, video.provider, video.id, req.film.id);
    saveCredits(db, req.film.id, credits);
  });
  res.redirect(`/films/${req.film.id}`);
});

router.post('/films/:id/delete', requireAuth, loadFilm, requireOwner, (req, res) => {
  req.app.locals.db.prepare('DELETE FROM films WHERE id = ?').run(req.film.id);
  res.redirect(`/u/${req.user.username}`);
});

router.post('/films/:id/recommendations', requireAuth, loadFilm, (req, res) => {
  const db = req.app.locals.db;
  const film = req.film;
  const credits = creditsForFilm(db, film.id);
  const role = String(req.body.role || '');
  const body = String(req.body.body || '').trim();
  const words = wordCount(body);
  const errors = [];

  if (isCredited(film, credits, req.user.id)) {
    errors.push("You worked on this film, so you can't recommend it — let the audience speak.");
  }
  if (!credits.some((c) => c.role === role)) errors.push('Choose which craft your recommendation is about.');
  if (words < MIN_RECOMMENDATION_WORDS) {
    errors.push(`Recommendations need at least ${MIN_RECOMMENDATION_WORDS} words — you have ${words}. Take your time; tell them what worked and why.`);
  }
  if (body.length > 20000) errors.push('That recommendation is too long.');
  if (!errors.length) {
    const exists = db.prepare('SELECT 1 FROM recommendations WHERE film_id = ? AND author_id = ? AND role = ?').get(film.id, req.user.id, role);
    if (exists) errors.push(`You've already recommended the ${role.toLowerCase()} on this film.`);
  }
  if (errors.length) return renderFilmPage(req, res, 422, { recForm: { role, body }, recErrors: errors });

  db.prepare('INSERT INTO recommendations (film_id, author_id, role, body, word_count) VALUES (?, ?, ?, ?, ?)')
    .run(film.id, req.user.id, role, body, words);
  res.redirect(`/films/${film.id}#recommendations`);
});

router.post('/recommendations/:id/delete', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const rec = db.prepare('SELECT * FROM recommendations WHERE id = ?').get(Number(req.params.id) || 0);
  if (!rec || rec.author_id !== req.user.id) {
    return res.status(404).render('error', { title: 'Not found', message: "That recommendation doesn't exist." });
  }
  db.prepare('DELETE FROM recommendations WHERE id = ?').run(rec.id);
  res.redirect(`/films/${rec.film_id}#recommendations`);
});

module.exports = router;

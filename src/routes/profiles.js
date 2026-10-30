const express = require('express');

const { requireAuth } = require('../lib/auth');
const { parseLetterboxd, toList } = require('../lib/text');
const { decorateFilm, roleOrder } = require('../lib/films');
const { ALL_ROLES, MEMBER_STATUSES } = require('../constants');

const router = express.Router();

router.get('/people', (req, res) => {
  const db = req.app.locals.db;
  const filters = {
    q: String(req.query.q || '').trim(),
    status: MEMBER_STATUSES.includes(req.query.status) ? req.query.status : '',
    craft: ALL_ROLES.includes(req.query.craft) ? req.query.craft : '',
    location: String(req.query.location || '').trim(),
  };
  const people = db
    .prepare(`
      SELECT u.*, (SELECT COUNT(DISTINCT film_id) FROM credits c WHERE c.user_id = u.id) AS film_count
      FROM users u
      WHERE (:q = '' OR u.display_name LIKE '%' || :q || '%' OR u.username LIKE '%' || :q || '%' OR u.school LIKE '%' || :q || '%')
        AND (:status = '' OR u.status = :status)
        AND (:craft = '' OR ',' || u.crafts || ',' LIKE '%,' || :craft || ',%')
        AND (:location = '' OR u.location LIKE '%' || :location || '%')
      ORDER BY film_count DESC, u.display_name LIMIT 100`)
    .all(filters);
  res.render('people/index', { title: 'People', people, filters });
});

router.get('/u/:username', (req, res, next) => {
  const db = req.app.locals.db;
  const profile = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username).toLowerCase());
  if (!profile) return next();

  // Filmography: every film this person is credited on, with all of their roles on it.
  const creditRows = db
    .prepare(`
      SELECT f.*, c.role FROM credits c JOIN films f ON f.id = c.film_id
      WHERE c.user_id = ? ORDER BY COALESCE(f.year, 0) DESC, f.created_at DESC`)
    .all(profile.id);
  const filmography = new Map();
  for (const row of creditRows) {
    if (!filmography.has(row.id)) filmography.set(row.id, { ...decorateFilm(row), roles: [] });
    filmography.get(row.id).roles.push(row.role);
  }
  for (const f of filmography.values()) f.roles.sort((a, b) => roleOrder(a) - roleOrder(b));

  // Recommendations aimed at a craft this person was credited for on that film.
  const recommendations = db
    .prepare(`
      SELECT r.*, f.title AS film_title, u.username, u.display_name
      FROM recommendations r
      JOIN films f ON f.id = r.film_id
      JOIN users u ON u.id = r.author_id
      WHERE EXISTS (SELECT 1 FROM credits c WHERE c.film_id = r.film_id AND c.role = r.role AND c.user_id = :id)
      ORDER BY r.created_at DESC, r.id DESC`)
    .all({ id: profile.id });
  const recsByRole = {};
  for (const r of recommendations) recsByRole[r.role] = (recsByRole[r.role] || 0) + 1;

  // People this person has worked with most often.
  const collaborators = db
    .prepare(`
      SELECT u.username, u.display_name, COUNT(DISTINCT c2.film_id) AS films
      FROM credits c1
      JOIN credits c2 ON c2.film_id = c1.film_id AND c2.user_id IS NOT NULL AND c2.user_id != c1.user_id
      JOIN users u ON u.id = c2.user_id
      WHERE c1.user_id = ?
      GROUP BY u.id ORDER BY films DESC, u.display_name LIMIT 8`)
    .all(profile.id);

  const photos = db.prepare('SELECT * FROM set_photos WHERE author_id = ? ORDER BY created_at DESC LIMIT 9').all(profile.id);
  const posts = db
    .prepare('SELECT * FROM board_posts WHERE author_id = ? ORDER BY created_at DESC LIMIT 5')
    .all(profile.id);

  res.render('people/show', {
    title: profile.display_name,
    profile,
    crafts: profile.crafts ? profile.crafts.split(',') : [],
    filmography: [...filmography.values()],
    recommendations,
    recsByRole,
    collaborators,
    photos,
    posts,
  });
});

router.get('/settings', requireAuth, (req, res) => {
  res.render('people/settings', {
    title: 'Your profile',
    form: { ...req.user, crafts: req.user.crafts ? req.user.crafts.split(',') : [] },
    errors: [],
    welcome: req.query.welcome === '1',
    saved: req.query.saved === '1',
  });
});

router.post('/settings', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const form = {
    display_name: String(req.body.display_name || '').trim(),
    status: req.body.status,
    crafts: toList(req.body.crafts).filter((c) => ALL_ROLES.includes(c)),
    location: String(req.body.location || '').trim(),
    school: String(req.body.school || '').trim(),
    bio: String(req.body.bio || '').trim(),
    letterboxd: String(req.body.letterboxd || '').trim(),
    website: String(req.body.website || '').trim(),
  };
  const errors = [];
  if (!form.display_name || form.display_name.length > 60) errors.push('Your name is required (up to 60 characters).');
  if (!MEMBER_STATUSES.includes(form.status)) errors.push('Pick a status.');
  if (form.location.length > 80) errors.push('Location is too long.');
  if (form.school.length > 100) errors.push('School / institution is too long.');
  if (form.bio.length > 1500) errors.push('Keep your bio under 1,500 characters.');
  const letterboxd = parseLetterboxd(form.letterboxd);
  if (letterboxd === null) errors.push("That doesn't look like a Letterboxd username or profile link.");
  if (form.website && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(form.website)) errors.push('Website must start with http:// or https://');

  if (errors.length) {
    return res.status(422).render('people/settings', { title: 'Your profile', form, errors, welcome: false, saved: false });
  }
  db.prepare(`
    UPDATE users SET display_name = ?, status = ?, crafts = ?, location = ?, school = ?, bio = ?, letterboxd = ?, website = ?
    WHERE id = ?`)
    .run(form.display_name, form.status, form.crafts.join(','), form.location, form.school, form.bio, letterboxd, form.website, req.user.id);
  res.redirect('/settings?saved=1');
});

module.exports = router;

const express = require('express');

const { requireAuth } = require('../lib/auth');
const { parseLetterboxd, toList } = require('../lib/text');
const { decorateFilm, roleOrder } = require('../lib/films');
const { blockedIds } = require('../lib/moderation');
const { ALL_ROLES, MEMBER_STATUSES } = require('../constants');

const router = express.Router();

router.get('/people', async (req, res) => {
  const db = req.app.locals.db;
  const filters = {
    q: String(req.query.q || '').trim().slice(0, 100),
    status: MEMBER_STATUSES.includes(req.query.status) ? req.query.status : '',
    craft: ALL_ROLES.includes(req.query.craft) ? req.query.craft : '',
    location: String(req.query.location || '').trim().slice(0, 80),
  };
  const blocked = await blockedIds(db, req.user);
  const people = (
    await db.query(
      `SELECT u.id, u.username, u.display_name, u.status, u.crafts, u.location, u.school,
         (SELECT COUNT(DISTINCT film_id) FROM credits c WHERE c.user_id = u.id) AS film_count
       FROM users u
       WHERE u.suspended_at IS NULL
         AND ($1 = '' OR u.display_name ILIKE '%' || $1 || '%' OR u.username ILIKE '%' || $1 || '%' OR u.school ILIKE '%' || $1 || '%')
         AND ($2 = '' OR u.status = $2)
         AND ($3 = '' OR ',' || u.crafts || ',' LIKE '%,' || $3 || ',%')
         AND ($4 = '' OR u.location ILIKE '%' || $4 || '%')
       ORDER BY film_count DESC, u.display_name LIMIT 100`,
      [filters.q, filters.status, filters.craft, filters.location],
    )
  ).filter((p) => !blocked.has(p.id));
  res.render('people/index', { title: 'People', people, filters });
});

router.get('/u/:username', async (req, res, next) => {
  const db = req.app.locals.db;
  const profile = await db.one('SELECT * FROM users WHERE lower(username) = lower($1) AND suspended_at IS NULL', [String(req.params.username)]);
  if (!profile) return next();
  const isMe = req.user?.id === profile.id;

  // Filmography: every film this person is credited on, with all of their roles on it.
  const creditRows = await db.query(
    `SELECT f.*, c.role FROM credits c JOIN films f ON f.id = c.film_id
     WHERE c.user_id = $1 AND (f.hidden_at IS NULL OR f.owner_id = $2)
     ORDER BY COALESCE(f.year, 0) DESC, f.created_at DESC`,
    [profile.id, req.user?.id ?? 0],
  );
  const filmography = new Map();
  for (const row of creditRows) {
    if (!filmography.has(row.id)) filmography.set(row.id, { ...decorateFilm(row), roles: [] });
    filmography.get(row.id).roles.push(row.role);
  }
  for (const f of filmography.values()) f.roles.sort((a, b) => roleOrder(a) - roleOrder(b));

  // Recommendations aimed at a craft this person was credited for on that film.
  const recommendations = await db.query(
    `SELECT r.*, f.title AS film_title, u.username, u.display_name
     FROM recommendations r
     JOIN films f ON f.id = r.film_id
     JOIN users u ON u.id = r.author_id
     WHERE r.hidden_at IS NULL AND f.hidden_at IS NULL AND u.suspended_at IS NULL
       AND EXISTS (SELECT 1 FROM credits c WHERE c.film_id = r.film_id AND c.role = r.role AND c.user_id = $1)
     ORDER BY r.created_at DESC, r.id DESC LIMIT 50`,
    [profile.id],
  );
  const recsByRole = {};
  for (const r of recommendations) recsByRole[r.role] = (recsByRole[r.role] || 0) + 1;

  const collaborators = await db.query(
    `SELECT u.username, u.display_name, COUNT(DISTINCT c2.film_id) AS films
     FROM credits c1
     JOIN credits c2 ON c2.film_id = c1.film_id AND c2.user_id IS NOT NULL AND c2.user_id <> c1.user_id
     JOIN users u ON u.id = c2.user_id AND u.suspended_at IS NULL
     WHERE c1.user_id = $1
     GROUP BY u.id ORDER BY films DESC, u.display_name LIMIT 8`,
    [profile.id],
  );
  const photos = await db.query('SELECT * FROM set_photos WHERE author_id = $1 AND hidden_at IS NULL ORDER BY created_at DESC LIMIT 9', [profile.id]);
  const posts = await db.query('SELECT * FROM board_posts WHERE author_id = $1 AND hidden_at IS NULL ORDER BY created_at DESC LIMIT 5', [profile.id]);
  const iBlocked = req.user && !isMe ? Boolean(await db.one('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.user.id, profile.id])) : false;

  res.render('people/show', {
    title: profile.display_name,
    profile,
    isMe,
    iBlocked,
    crafts: profile.crafts ? profile.crafts.split(',') : [],
    filmography: [...filmography.values()],
    recommendations,
    recsByRole,
    collaborators,
    photos,
    posts,
  });
});

router.post('/u/:username/block', requireAuth, async (req, res, next) => {
  const db = req.app.locals.db;
  const target = await db.one('SELECT id, username FROM users WHERE lower(username) = lower($1)', [String(req.params.username)]);
  if (!target || target.id === req.user.id) return next();
  if (req.body.action === 'unblock') {
    await db.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.user.id, target.id]);
  } else {
    await db.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, target.id]);
  }
  res.redirect(`/u/${target.username}`);
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

router.post('/settings', requireAuth, async (req, res) => {
  const db = req.app.locals.db;
  const form = {
    display_name: String(req.body.display_name || '').trim(),
    status: req.body.status,
    crafts: [...new Set(toList(req.body.crafts).filter((c) => ALL_ROLES.includes(c)))],
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
  if (form.website && !(/^https?:\/\/[^\s]+\.[^\s]+$/i.test(form.website) && form.website.length <= 200)) {
    errors.push('Website must start with http:// or https://');
  }

  if (errors.length) {
    return res.status(422).render('people/settings', { title: 'Your profile', form, errors, welcome: false, saved: false });
  }
  await db.query(
    `UPDATE users SET display_name = $1, status = $2, crafts = $3, location = $4, school = $5, bio = $6, letterboxd = $7, website = $8 WHERE id = $9`,
    [form.display_name, form.status, form.crafts.join(','), form.location, form.school, form.bio, letterboxd, form.website, req.user.id],
  );
  // Credits show the member's current name.
  await db.query('UPDATE credits SET name = $1 WHERE user_id = $2', [form.display_name, req.user.id]);
  res.redirect('/settings?saved=1');
});

module.exports = router;

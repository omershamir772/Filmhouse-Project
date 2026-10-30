const express = require('express');

const { requireAuth } = require('../lib/auth');
const { transaction } = require('../db');
const { isIsoDate, toList } = require('../lib/text');
const { ALL_ROLES, POST_TYPES } = require('../constants');

const router = express.Router();

function rolesFor(db, postIds) {
  if (!postIds.length) return {};
  const rows = db
    .prepare(`SELECT post_id, role FROM board_post_roles WHERE post_id IN (${postIds.map(() => '?').join(',')})`)
    .all(...postIds);
  const out = {};
  for (const r of rows) (out[r.post_id] ||= []).push(r.role);
  return out;
}

/**
 * Search the board. Date filters match any post whose shoot window overlaps [from, to];
 * posts without dates are treated as flexible and always match.
 */
function searchBoard(db, filters) {
  const roles = filters.roles;
  const posts = db
    .prepare(`
      SELECT p.*, u.username, u.display_name, u.status AS author_status
      FROM board_posts p JOIN users u ON u.id = p.author_id
      WHERE (:kind = '' OR p.kind = :kind)
        AND (:q = '' OR p.title LIKE '%' || :q || '%' OR p.description LIKE '%' || :q || '%')
        AND (:location = '' OR p.location LIKE '%' || :location || '%')
        AND (:from = '' OR COALESCE(p.end_date, p.start_date) IS NULL OR COALESCE(p.end_date, p.start_date) >= :from)
        AND (:to = '' OR p.start_date IS NULL OR p.start_date <= :to)
        AND (:include_past = 1 OR COALESCE(p.end_date, p.start_date) IS NULL OR COALESCE(p.end_date, p.start_date) >= date('now'))
        ${roles.length ? `AND p.id IN (SELECT post_id FROM board_post_roles WHERE role IN (${roles.map((_, i) => `:role${i}`).join(',')}))` : ''}
      ORDER BY COALESCE(p.start_date, '9999-12-31'), p.created_at DESC
      LIMIT 100`)
    .all({
      kind: filters.kind,
      q: filters.q,
      location: filters.location,
      from: filters.from,
      to: filters.to,
      include_past: filters.include_past ? 1 : 0,
      ...Object.fromEntries(roles.map((r, i) => [`role${i}`, r])),
    });
  const roleMap = rolesFor(db, posts.map((p) => p.id));
  return posts.map((p) => ({ ...p, roles: roleMap[p.id] || [] }));
}

router.get('/board', (req, res) => {
  const filters = {
    kind: POST_TYPES[req.query.kind] ? req.query.kind : '',
    q: String(req.query.q || '').trim(),
    location: String(req.query.location || '').trim(),
    from: isIsoDate(req.query.from) ? req.query.from : '',
    to: isIsoDate(req.query.to) ? req.query.to : '',
    roles: toList(req.query.role).filter((r) => ALL_ROLES.includes(r)),
    include_past: req.query.include_past === '1',
  };
  const posts = searchBoard(req.app.locals.db, filters);
  res.render('board/index', { title: 'Bulletin board', posts, filters });
});

function readPost(body) {
  return {
    kind: body.kind,
    title: String(body.title || '').trim(),
    description: String(body.description || '').trim(),
    location: String(body.location || '').trim(),
    start_date: String(body.start_date || '').trim(),
    end_date: String(body.end_date || '').trim(),
    compensation: String(body.compensation || '').trim(),
    contact: String(body.contact || '').trim(),
    roles: [...new Set(toList(body.roles).filter((r) => ALL_ROLES.includes(r)))],
  };
}

function validatePost(p) {
  const errors = [];
  if (!POST_TYPES[p.kind]) errors.push('Is this a crew call or are you available for work?');
  if (!p.title || p.title.length > 120) errors.push('Add a headline (up to 120 characters).');
  if (!p.description || p.description.length > 4000) errors.push('Describe the project (up to 4,000 characters).');
  if (p.start_date && !isIsoDate(p.start_date)) errors.push('Start date is not a valid date.');
  if (p.end_date && !isIsoDate(p.end_date)) errors.push('End date is not a valid date.');
  if (p.start_date && p.end_date && p.end_date < p.start_date) errors.push('End date must be after the start date.');
  if (!p.roles.length) errors.push(p.kind === 'available' ? 'Which roles can you fill?' : 'Which roles are you looking for?');
  if (p.location.length > 80 || p.compensation.length > 120 || p.contact.length > 160) errors.push('Some fields are too long.');
  return errors;
}

router.get('/board/new', requireAuth, (req, res) => {
  const kind = POST_TYPES[req.query.kind] ? req.query.kind : 'crew_call';
  const roles = kind === 'available' && req.user.crafts ? req.user.crafts.split(',') : [];
  res.render('board/form', { title: 'New bulletin', post: { kind, roles, location: req.user.location }, errors: [] });
});

router.post('/board', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const post = readPost(req.body);
  const errors = validatePost(post);
  if (errors.length) return res.status(422).render('board/form', { title: 'New bulletin', post, errors });

  const id = transaction(db, () => {
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO board_posts (author_id, kind, title, description, location, start_date, end_date, compensation, contact)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, post.kind, post.title, post.description, post.location, post.start_date || null, post.end_date || null, post.compensation, post.contact);
    const insertRole = db.prepare('INSERT INTO board_post_roles (post_id, role) VALUES (?, ?)');
    for (const role of post.roles) insertRole.run(lastInsertRowid, role);
    return lastInsertRowid;
  });
  res.redirect(`/board/${id}`);
});

router.get('/board/:id', (req, res, next) => {
  const db = req.app.locals.db;
  const post = db
    .prepare(`
      SELECT p.*, u.username, u.display_name, u.status AS author_status
      FROM board_posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`)
    .get(Number(req.params.id) || 0);
  if (!post) return next();
  post.roles = rolesFor(db, [post.id])[post.id] || [];
  res.render('board/show', { title: post.title, post });
});

router.post('/board/:id/delete', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const post = db.prepare('SELECT * FROM board_posts WHERE id = ?').get(Number(req.params.id) || 0);
  if (post && post.author_id === req.user.id) db.prepare('DELETE FROM board_posts WHERE id = ?').run(post.id);
  res.redirect('/board');
});

module.exports = router;

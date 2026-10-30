const express = require('express');

const { requireAuth, requireVerified } = require('../lib/auth');
const { rateLimit } = require('../lib/rateLimit');
const { isIsoDate, toList } = require('../lib/text');
const { blockedIds } = require('../lib/moderation');
const { ALL_ROLES, POST_TYPES } = require('../constants');

const router = express.Router();

async function rolesFor(db, postIds) {
  if (!postIds.length) return {};
  const rows = await db.query('SELECT post_id, role FROM board_post_roles WHERE post_id = ANY($1::int[])', [postIds]);
  const out = {};
  for (const r of rows) (out[r.post_id] ||= []).push(r.role);
  return out;
}

/**
 * Search the board. Date filters match any post whose shoot window overlaps [from, to];
 * posts without dates are treated as flexible and always match.
 */
async function searchBoard(db, filters) {
  const posts = await db.query(
    `SELECT p.*, u.username, u.display_name, u.status AS author_status
     FROM board_posts p JOIN users u ON u.id = p.author_id
     WHERE p.hidden_at IS NULL AND u.suspended_at IS NULL
       AND ($1 = '' OR p.kind = $1)
       AND ($2 = '' OR p.title ILIKE '%' || $2 || '%' OR p.description ILIKE '%' || $2 || '%')
       AND ($3 = '' OR p.location ILIKE '%' || $3 || '%')
       AND ($4::date IS NULL OR COALESCE(p.end_date, p.start_date) IS NULL OR COALESCE(p.end_date, p.start_date) >= $4::date)
       AND ($5::date IS NULL OR p.start_date IS NULL OR p.start_date <= $5::date)
       AND ($6 OR COALESCE(p.end_date, p.start_date) IS NULL OR COALESCE(p.end_date, p.start_date) >= current_date)
       AND (cardinality($7::text[]) = 0 OR EXISTS (SELECT 1 FROM board_post_roles r WHERE r.post_id = p.id AND r.role = ANY($7::text[])))
     ORDER BY COALESCE(p.start_date, '9999-12-31'::date), p.created_at DESC
     LIMIT 100`,
    [filters.kind, filters.q, filters.location, filters.from || null, filters.to || null, filters.include_past, filters.roles],
  );
  const roleMap = await rolesFor(db, posts.map((p) => p.id));
  return posts.map((p) => ({ ...p, roles: roleMap[p.id] || [] }));
}

router.get('/board', async (req, res) => {
  const db = req.app.locals.db;
  const filters = {
    kind: POST_TYPES[req.query.kind] ? req.query.kind : '',
    q: String(req.query.q || '').trim().slice(0, 100),
    location: String(req.query.location || '').trim().slice(0, 80),
    from: isIsoDate(req.query.from) ? req.query.from : '',
    to: isIsoDate(req.query.to) ? req.query.to : '',
    roles: toList(req.query.role).filter((r) => ALL_ROLES.includes(r)),
    include_past: req.query.include_past === '1',
  };
  const blocked = await blockedIds(db, req.user);
  const posts = (await searchBoard(db, filters)).filter((p) => !blocked.has(p.author_id));
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

router.get('/board/new', requireVerified, (req, res) => {
  const kind = POST_TYPES[req.query.kind] ? req.query.kind : 'crew_call';
  const roles = kind === 'available' && req.user.crafts ? req.user.crafts.split(',') : [];
  res.render('board/form', { title: 'New bulletin', post: { kind, roles, location: req.user.location }, errors: [] });
});

router.post('/board', requireVerified, rateLimit('postsPerUser', (req) => req.user.id), async (req, res) => {
  const db = req.app.locals.db;
  const post = readPost(req.body);
  const errors = validatePost(post);
  if (errors.length) return res.status(422).render('board/form', { title: 'New bulletin', post, errors });

  const id = await db.tx(async (tx) => {
    const row = await tx.one(
      `INSERT INTO board_posts (author_id, kind, title, description, location, start_date, end_date, compensation, contact)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [req.user.id, post.kind, post.title, post.description, post.location, post.start_date || null, post.end_date || null, post.compensation, post.contact],
    );
    for (const role of post.roles) await tx.query('INSERT INTO board_post_roles (post_id, role) VALUES ($1, $2)', [row.id, role]);
    return row.id;
  });
  res.redirect(`/board/${id}`);
});

router.get('/board/:id', async (req, res, next) => {
  const db = req.app.locals.db;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return next();
  const post = await db.one(
    `SELECT p.*, u.username, u.display_name, u.status AS author_status
     FROM board_posts p JOIN users u ON u.id = p.author_id WHERE p.id = $1 AND u.suspended_at IS NULL`,
    [id],
  );
  if (!post || (post.hidden_at && req.user?.id !== post.author_id && req.user?.role !== 'admin')) return next();
  post.roles = (await rolesFor(db, [post.id]))[post.id] || [];
  res.render('board/show', { title: post.title, post });
});

router.post('/board/:id/delete', requireAuth, async (req, res) => {
  await req.app.locals.db.query('DELETE FROM board_posts WHERE id = $1 AND author_id = $2', [Number(req.params.id) || 0, req.user.id]);
  res.redirect('/board');
});

module.exports = router;

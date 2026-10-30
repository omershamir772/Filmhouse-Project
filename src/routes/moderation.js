const express = require('express');

const { requireVerified, requireAdmin, destroyAllSessions } = require('../lib/auth');
const { rateLimit } = require('../lib/rateLimit');
const { REPORT_TARGETS, REPORT_REASONS, audit } = require('../lib/moderation');

const router = express.Router();

// Where an admin (or reporter) can look at the reported thing.
async function describeTarget(db, type, id) {
  switch (type) {
    case 'user': {
      const u = await db.one('SELECT id, username, display_name, suspended_at FROM users WHERE id = $1', [id]);
      return u && { owner_id: u.id, title: `${u.display_name} (@${u.username})`, href: `/u/${u.username}`, hidden: Boolean(u.suspended_at) };
    }
    case 'film': {
      const f = await db.one('SELECT id, owner_id, title, hidden_at FROM films WHERE id = $1', [id]);
      return f && { owner_id: f.owner_id, title: f.title, href: `/films/${f.id}`, hidden: Boolean(f.hidden_at) };
    }
    case 'recommendation': {
      const r = await db.one('SELECT r.id, r.author_id, r.film_id, r.role, r.body, r.hidden_at FROM recommendations r WHERE r.id = $1', [id]);
      return r && { owner_id: r.author_id, title: `${r.role}: ${r.body.slice(0, 120)}…`, href: `/films/${r.film_id}#rec-${r.id}`, hidden: Boolean(r.hidden_at) };
    }
    case 'post': {
      const p = await db.one('SELECT id, author_id, title, hidden_at FROM board_posts WHERE id = $1', [id]);
      return p && { owner_id: p.author_id, title: p.title, href: `/board/${p.id}`, hidden: Boolean(p.hidden_at) };
    }
    case 'photo': {
      const p = await db.one('SELECT id, author_id, caption, thumb_key, hidden_at FROM set_photos WHERE id = $1', [id]);
      return p && { owner_id: p.author_id, title: p.caption || 'Set photo', thumb_key: p.thumb_key, href: '/feed', hidden: Boolean(p.hidden_at) };
    }
    default:
      return null;
  }
}

function readTarget(src) {
  const type = REPORT_TARGETS[src.type] ? src.type : null;
  const id = Number(src.id);
  return type && Number.isInteger(id) && id > 0 ? { type, id } : null;
}

// ---------- Reporting (any verified member) ----------

router.get('/report', requireVerified, async (req, res, next) => {
  const target = readTarget(req.query);
  const info = target && (await describeTarget(req.app.locals.db, target.type, target.id));
  if (!info) return next();
  res.render('moderation/report', { title: 'Report', target, info, reasons: REPORT_REASONS, label: REPORT_TARGETS[target.type].label, errors: [] });
});

router.post('/report', requireVerified, rateLimit('reportsPerUser', (req) => req.user.id), async (req, res, next) => {
  const db = req.app.locals.db;
  const target = readTarget(req.body);
  const info = target && (await describeTarget(db, target.type, target.id));
  if (!info) return next();
  const reason = String(req.body.reason || '');
  const details = String(req.body.details || '').trim().slice(0, 2000);
  if (!REPORT_REASONS.includes(reason)) {
    return res.status(422).render('moderation/report', {
      title: 'Report',
      target,
      info,
      reasons: REPORT_REASONS,
      label: REPORT_TARGETS[target.type].label,
      errors: ['Please choose a reason.'],
    });
  }
  await db.query('INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES ($1, $2, $3, $4, $5)', [
    req.user.id,
    target.type,
    target.id,
    reason,
    details,
  ]);
  res.render('error', { title: 'Thanks for telling us', message: 'A moderator will review your report. You can also block this person from their profile so you no longer see their posts.' });
});

// ---------- Admin ----------

router.get('/admin', requireAdmin, async (req, res) => {
  const db = req.app.locals.db;
  const reports = await db.query(
    `SELECT r.*, u.username AS reporter_username FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
     WHERE r.status = 'open' ORDER BY r.created_at ASC LIMIT 100`,
  );
  for (const r of reports) r.info = await describeTarget(db, r.target_type, r.target_id);
  const q = String(req.query.user || '').trim().slice(0, 100);
  const users = q
    ? await db.query(
        `SELECT id, username, display_name, email, role, email_verified_at, suspended_at, created_at FROM users
         WHERE username ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%' OR display_name ILIKE '%' || $1 || '%'
         ORDER BY created_at DESC LIMIT 50`,
        [q],
      )
    : [];
  const log = await db.query('SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 50');
  res.set('Cache-Control', 'no-store');
  res.render('moderation/admin', { title: 'Moderation', reports, users, q, log, targets: REPORT_TARGETS });
});

async function setHidden(db, type, id, hidden) {
  if (type === 'user') {
    await db.query(`UPDATE users SET suspended_at = ${hidden ? 'now()' : 'NULL'} WHERE id = $1 AND role <> 'admin'`, [id]);
    if (hidden) await destroyAllSessions(db, id);
    return;
  }
  const { table } = REPORT_TARGETS[type];
  await db.query(`UPDATE ${table} SET hidden_at = ${hidden ? 'now()' : 'NULL'} WHERE id = $1`, [id]);
}

// Resolve a report: hide the content, suspend its author, or dismiss.
router.post('/admin/reports/:id', requireAdmin, async (req, res, next) => {
  const db = req.app.locals.db;
  const report = await db.one("SELECT * FROM reports WHERE id = $1 AND status = 'open'", [Number(req.params.id) || 0]);
  if (!report) return next();
  const action = req.body.action;
  const info = await describeTarget(db, report.target_type, report.target_id);
  if (action === 'hide' && info) {
    await setHidden(db, report.target_type, report.target_id, true);
    await audit(db, req.user, report.target_type === 'user' ? 'suspend' : 'hide', report.target_type, report.target_id, `report #${report.id}: ${report.reason}`);
  } else if (action === 'suspend' && info) {
    await setHidden(db, 'user', info.owner_id, true);
    await audit(db, req.user, 'suspend', 'user', info.owner_id, `report #${report.id}: ${report.reason}`);
  } else if (action === 'dismiss') {
    await audit(db, req.user, 'dismiss', 'report', report.id, report.reason);
  } else {
    return res.redirect('/admin');
  }
  await db.query('UPDATE reports SET status = $1, resolved_by = $2, resolved_at = now() WHERE id = $3', [
    action === 'dismiss' ? 'dismissed' : 'actioned',
    req.user.id,
    report.id,
  ]);
  res.redirect('/admin');
});

// Directly hide/unhide content or suspend/restore a user.
router.post('/admin/:type/:id/:action', requireAdmin, async (req, res, next) => {
  const db = req.app.locals.db;
  if (!['hide', 'unhide'].includes(req.params.action)) return next();
  const target = readTarget({ type: req.params.type, id: req.params.id });
  if (!target || !(await describeTarget(db, target.type, target.id))) return next();
  const hide = req.params.action === 'hide';
  await setHidden(db, target.type, target.id, hide);
  const verb = target.type === 'user' ? (hide ? 'suspend' : 'restore') : hide ? 'hide' : 'unhide';
  await audit(db, req.user, verb, target.type, target.id, String(req.body.note || '').slice(0, 300));
  res.redirect(req.body.back === 'users' ? `/admin?user=${encodeURIComponent(req.body.q || '')}` : '/admin');
});

module.exports = router;

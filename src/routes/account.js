const express = require('express');

const {
  requireAuth,
  verifyPassword,
  checkPassword,
  hashPassword,
  destroyAllSessions,
  destroySession,
  createEmailToken,
} = require('../lib/auth');
const { rateLimit } = require('../lib/rateLimit');

const router = express.Router();
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

async function renderAccount(req, res, status = 200, { errors = [], notice = null } = {}) {
  const db = req.app.locals.db;
  const sessions = await db.one('SELECT COUNT(*) AS n FROM sessions WHERE user_id = $1 AND expires_at > now()', [req.user.id]);
  const blocked = await db.query(
    `SELECT u.username, u.display_name FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY u.display_name`,
    [req.user.id],
  );
  res.status(status).render('people/account', { title: 'Account & privacy', errors, notice, sessionCount: sessions.n, blocked });
}

router.get('/settings/account', requireAuth, (req, res) => renderAccount(req, res));

router.post('/settings/password', requireAuth, async (req, res) => {
  const { db, config } = req.app.locals;
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  if (!verifyPassword(current, req.user.password_hash)) {
    return renderAccount(req, res, 422, { errors: ['Your current password is not right.'] });
  }
  const errors = await checkPassword(next, { username: req.user.username, email: req.user.email, checkBreached: config.checkBreachedPasswords });
  if (errors.length) return renderAccount(req, res, 422, { errors });
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(next), req.user.id]);
  // Anyone else signed in to this account is signed out.
  await destroyAllSessions(db, req.user.id, req.sessionToken);
  renderAccount(req, res, 200, { notice: 'Password changed. Every other device has been signed out.' });
});

router.post('/settings/email', requireAuth, rateLimit('emailPerAccount', (req) => req.user.id), async (req, res) => {
  const { db, mailer, config } = req.app.locals;
  const email = String(req.body.email || '').trim();
  if (!verifyPassword(String(req.body.current_password || ''), req.user.password_hash)) {
    return renderAccount(req, res, 422, { errors: ['Your current password is not right.'] });
  }
  if (!EMAIL_RE.test(email)) return renderAccount(req, res, 422, { errors: ['Please enter a valid email address.'] });
  const taken = await db.one('SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2', [email, req.user.id]);
  if (taken) return renderAccount(req, res, 422, { errors: ['That email is already in use.'] });

  const oldEmail = req.user.email;
  const user = await db.one('UPDATE users SET email = $1, email_verified_at = NULL WHERE id = $2 RETURNING *', [email, req.user.id]);
  req.user = user;
  res.locals.currentUser = user;
  const token = await createEmailToken(db, user, 'verify', 48);
  await mailer.send({
    to: email,
    subject: 'Confirm your new email for FilmHouse',
    text: `Confirm this is your new FilmHouse email address:\n\n${config.appUrl}/verify?token=${token}\n\nThis link expires in 48 hours.`,
  });
  // Tell the old address, so a hijacker can't quietly take over the account.
  await mailer.send({
    to: oldEmail,
    subject: 'Your FilmHouse email was changed',
    text: `The email on your FilmHouse account (@${user.username}) was changed to ${email}.\n\nIf you didn't do this, reset your password straight away and contact the FilmHouse team.`,
  });
  renderAccount(req, res, 200, { notice: `We sent a confirmation link to ${email}.` });
});

router.post('/settings/sessions/revoke', requireAuth, async (req, res) => {
  await destroyAllSessions(req.app.locals.db, req.user.id, req.sessionToken);
  renderAccount(req, res, 200, { notice: 'Signed out of every other device.' });
});

// Everything FilmHouse holds about you, as JSON.
router.get('/settings/export.json', requireAuth, async (req, res) => {
  const { db, storage } = req.app.locals;
  const id = req.user.id;
  const profile = { ...req.user };
  delete profile.password_hash;
  const [films, credits, recommendationsWritten, posts, photos, blocks, reports] = await Promise.all([
    db.query('SELECT * FROM films WHERE owner_id = $1 ORDER BY id', [id]),
    db.query('SELECT c.role, c.name, f.id AS film_id, f.title FROM credits c JOIN films f ON f.id = c.film_id WHERE c.user_id = $1 ORDER BY f.id', [id]),
    db.query('SELECT * FROM recommendations WHERE author_id = $1 ORDER BY id', [id]),
    db.query(
      `SELECT p.*, (SELECT array_agg(role) FROM board_post_roles r WHERE r.post_id = p.id) AS roles FROM board_posts p WHERE author_id = $1 ORDER BY id`,
      [id],
    ),
    db.query('SELECT id, film_id, caption, created_at, image_key FROM set_photos WHERE author_id = $1 ORDER BY id', [id]),
    db.query('SELECT u.username, b.created_at FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1', [id]),
    db.query('SELECT target_type, target_id, reason, details, status, created_at FROM reports WHERE reporter_id = $1', [id]),
  ]);
  const data = {
    exported_at: new Date().toISOString(),
    profile,
    films,
    credits,
    recommendations_written: recommendationsWritten,
    bulletins: posts,
    set_photos: photos.map((p) => ({ ...p, url: storage.url(p.image_key) })),
    blocked_users: blocks,
    reports_filed: reports,
  };
  res.set('Content-Disposition', `attachment; filename="filmhouse-${req.user.username}.json"`);
  res.set('Cache-Control', 'no-store');
  res.type('application/json').send(JSON.stringify(data, null, 2));
});

// Permanently delete the account and everything it owns.
router.post('/settings/delete', requireAuth, async (req, res) => {
  const { db, storage } = req.app.locals;
  if (!verifyPassword(String(req.body.current_password || ''), req.user.password_hash)) {
    return renderAccount(req, res, 422, { errors: ['Your current password is not right, so nothing was deleted.'] });
  }
  if (req.body.confirm !== req.user.username) {
    return renderAccount(req, res, 422, { errors: [`Type your username (${req.user.username}) to confirm.`] });
  }
  const photos = await db.query('SELECT image_key, thumb_key FROM set_photos WHERE author_id = $1', [req.user.id]);
  await db.tx(async (tx) => {
    // Credits on other people's films stay, as a plain name, so their credit lists remain complete.
    await tx.query('UPDATE credits SET user_id = NULL WHERE user_id = $1', [req.user.id]);
    await tx.query('UPDATE reports SET details = $1 WHERE target_type = $2 AND target_id = $3', ['[account deleted]', 'user', req.user.id]);
    await tx.query('DELETE FROM users WHERE id = $1', [req.user.id]);
  });
  for (const p of photos) {
    await storage.remove(p.image_key);
    await storage.remove(p.thumb_key);
  }
  await destroySession(req, res);
  res.render('error', { title: 'Account deleted', message: 'Your account and everything you posted have been deleted. Thank you for being part of FilmHouse.' });
});

module.exports = router;

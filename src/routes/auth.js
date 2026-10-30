const express = require('express');
const {
  hashPassword,
  verifyPassword,
  checkPassword,
  createSession,
  destroySession,
  destroyAllSessions,
  requireAuth,
  safeNext,
  createEmailToken,
  consumeEmailToken,
  sha256,
} = require('../lib/auth');
const { consume, peek, rateLimit } = require('../lib/rateLimit');
const { USERNAME_RE, slugifyUsername } = require('../lib/text');
const { MEMBER_STATUSES } = require('../constants');

const router = express.Router();
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

async function sendVerification(req, user) {
  const { db, mailer, config } = req.app.locals;
  const token = await createEmailToken(db, user, 'verify', 48);
  await mailer.send({
    to: user.email,
    subject: 'Confirm your email for FilmHouse',
    text: `Hi ${user.display_name},\n\nConfirm your email to start posting on FilmHouse:\n\n${config.appUrl}/verify?token=${token}\n\nThis link works once and expires in 48 hours. If you didn't sign up, you can ignore this email.\n\n— FilmHouse`,
  });
}

function renderSignup(res, status, form, errors) {
  res.status(status).render('auth/signup', { title: 'Join FilmHouse', form, errors });
}

router.get('/signup', (req, res) => {
  if (req.user) return res.redirect('/');
  renderSignup(res, 200, { invite: req.query.invite || '' }, []);
});

router.post('/signup', rateLimit('signupPerIp', (req) => req.ip), async (req, res) => {
  const { db, config } = req.app.locals;
  const form = {
    username: slugifyUsername(req.body.username),
    email: String(req.body.email || '').trim(),
    display_name: String(req.body.display_name || '').trim(),
    status: req.body.status,
    invite: String(req.body.invite || '').trim(),
  };
  const password = String(req.body.password || '');
  const errors = [];
  if (config.inviteCodes.length && !config.inviteCodes.includes(form.invite)) {
    errors.push('FilmHouse is invite-only during the beta. Please enter a valid invite code.');
  }
  if (!USERNAME_RE.test(form.username)) errors.push('Username must be 3–24 characters: lowercase letters, numbers or underscores.');
  if (!EMAIL_RE.test(form.email)) errors.push('Please enter a valid email address.');
  if (!form.display_name || form.display_name.length > 60) errors.push('Please tell us your name (up to 60 characters).');
  if (!MEMBER_STATUSES.includes(form.status)) errors.push('Pick whether you are a student, freelancer, alumni or institution.');
  if (req.body.age !== 'yes') errors.push(`You must be at least ${config.minAge} to join FilmHouse.`);
  if (req.body.terms !== 'yes') errors.push('Please agree to the terms and community guidelines.');
  errors.push(...(await checkPassword(password, { username: form.username, email: form.email, checkBreached: config.checkBreachedPasswords })));

  if (!errors.length) {
    const taken = await db.one('SELECT username FROM users WHERE lower(username) = $1 OR lower(email) = lower($2)', [form.username, form.email]);
    if (taken) {
      // Same message for both cases, so the form can't be used to find out who has an account.
      errors.push('That username or email is already in use. If it is yours, sign in or reset your password.');
    }
  }
  if (errors.length) return renderSignup(res, 422, form, errors);

  const user = await db.one(
    `INSERT INTO users (username, email, password_hash, display_name, status) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [form.username, form.email, hashPassword(password), form.display_name, form.status],
  );
  await sendVerification(req, user);
  await createSession(req, res, user.id);
  res.redirect('/settings?welcome=1');
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/login', { title: 'Sign in', next: safeNext(req.query.next), error: null, login: '', notice: req.query.reset === '1' ? 'Password changed. Sign in with your new password.' : null });
});

router.post('/login', rateLimit('loginPerIp', (req) => req.ip), async (req, res) => {
  const { db, config } = req.app.locals;
  const login = String(req.body.login || '').trim().slice(0, 254);
  const next = safeNext(req.body.next);
  const fail = (error, status = 401) => res.status(status).render('auth/login', { title: 'Sign in', next, error, login, notice: null });

  const accountKey = `loginFailuresPerAccount:${login.toLowerCase()}`;
  if (!(await peek(db, accountKey, config.rateLimits.loginFailuresPerAccount)).allowed) {
    return fail('Too many failed attempts for this account. Wait 15 minutes, or reset your password.', 429);
  }
  const user = await db.one('SELECT * FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($1)', [login]);
  // verifyPassword runs even when there's no such user, so timing doesn't reveal who has an account.
  const ok = verifyPassword(String(req.body.password || ''), user && user.password_hash);
  if (!user || !ok) {
    await consume(db, accountKey, config.rateLimits.loginFailuresPerAccount);
    return fail('Wrong username or password.');
  }
  if (user.suspended_at) return fail('This account has been suspended. Contact the FilmHouse team if you think this is a mistake.', 403);
  await createSession(req, res, user.id);
  res.redirect(next);
});

router.post('/logout', async (req, res) => {
  await destroySession(req, res);
  res.redirect('/');
});

router.post('/theme', (req, res) => {
  const theme = req.body.theme === 'light' ? 'light' : 'dark';
  res.cookie('fh_theme', theme, { path: '/', sameSite: 'lax', secure: req.app.locals.config.isProd, maxAge: 365 * 864e5 });
  res.redirect(safeNext(req.body.next));
});

// ---------- Email verification ----------

router.get('/verify', async (req, res) => {
  const user = await consumeEmailToken(req.app.locals.db, req.query.token, 'verify');
  if (!user) {
    return res.status(400).render('error', { title: 'Link expired', message: 'That confirmation link is invalid or has expired. Sign in and ask for a new one.' });
  }
  await req.app.locals.db.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [user.id]);
  res.render('auth/verified', { title: 'Email confirmed' });
});

router.post('/verify/resend', requireAuth, rateLimit('emailPerAccount', (req) => req.user.id), async (req, res) => {
  if (!req.user.email_verified_at) await sendVerification(req, req.user);
  res.render('auth/check-email', { title: 'Check your email', email: req.user.email });
});

// ---------- Password reset ----------

router.get('/forgot', (req, res) => {
  res.render('auth/forgot', { title: 'Reset your password' });
});

router.post('/forgot', rateLimit('signupPerIp', (req) => req.ip), async (req, res) => {
  const { db, mailer, config } = req.app.locals;
  const email = String(req.body.email || '').trim();
  const user = EMAIL_RE.test(email) ? await db.one('SELECT * FROM users WHERE lower(email) = lower($1) AND suspended_at IS NULL', [email]) : null;
  if (user && (await consume(db, `emailPerAccount:${user.id}`, config.rateLimits.emailPerAccount)).allowed) {
    const token = await createEmailToken(db, user, 'reset', 1);
    await mailer.send({
      to: user.email,
      subject: 'Reset your FilmHouse password',
      text: `Hi ${user.display_name},\n\nSomeone asked to reset your FilmHouse password. If it was you, choose a new one here:\n\n${config.appUrl}/reset?token=${token}\n\nThis link works once and expires in 1 hour. If it wasn't you, ignore this email — your password hasn't changed.\n\n— FilmHouse`,
    });
  }
  // Always the same answer, whether or not the address has an account.
  res.render('auth/check-email', { title: 'Check your email', email });
});

router.get('/reset', (req, res) => {
  res.render('auth/reset', { title: 'Choose a new password', token: String(req.query.token || ''), errors: [] });
});

router.post('/reset', async (req, res) => {
  const { db, config } = req.app.locals;
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  // Check the token is still good before validating, without using it up.
  const pending = await db.one(
    `SELECT u.* FROM email_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1 AND t.purpose = 'reset' AND t.used_at IS NULL AND t.expires_at > now()`,
    [sha256(token)],
  );
  if (!pending) {
    return res.status(400).render('error', { title: 'Link expired', message: 'That reset link is invalid or has expired. Ask for a new one.' });
  }
  const errors = await checkPassword(password, { username: pending.username, email: pending.email, checkBreached: config.checkBreachedPasswords });
  if (errors.length) return res.status(422).render('auth/reset', { title: 'Choose a new password', token, errors });

  const user = await consumeEmailToken(db, token, 'reset');
  if (!user) return res.status(400).render('error', { title: 'Link expired', message: 'That reset link has already been used.' });
  // The reset link proves they own the email, so it also counts as confirming it.
  await db.query('UPDATE users SET password_hash = $1, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $2', [
    hashPassword(password),
    user.id,
  ]);
  await destroyAllSessions(db, user.id);
  res.redirect('/login?reset=1');
});

module.exports = router;

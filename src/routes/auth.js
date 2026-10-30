const express = require('express');
const { hashPassword, verifyPassword, createSession, destroySession, safeNext } = require('../lib/auth');
const { USERNAME_RE, slugifyUsername } = require('../lib/text');
const { MEMBER_STATUSES } = require('../constants');

const router = express.Router();

router.get('/signup', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/signup', { title: 'Join FilmHouse', form: {}, errors: [] });
});

router.post('/signup', (req, res) => {
  const db = req.app.locals.db;
  const form = {
    username: slugifyUsername(req.body.username),
    email: String(req.body.email || '').trim(),
    display_name: String(req.body.display_name || '').trim(),
    status: req.body.status,
  };
  const password = String(req.body.password || '');
  const errors = [];
  if (!USERNAME_RE.test(form.username)) errors.push('Username must be 3–24 characters: lowercase letters, numbers or underscores.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.push('Please enter a valid email address.');
  if (!form.display_name || form.display_name.length > 60) errors.push('Please tell us your name (up to 60 characters).');
  if (!MEMBER_STATUSES.includes(form.status)) errors.push('Pick whether you are a student, freelancer, alumni or institution.');
  if (password.length < 8) errors.push('Password must be at least 8 characters.');
  if (!errors.length) {
    const taken = db.prepare('SELECT username, email FROM users WHERE username = ? OR email = ?').get(form.username, form.email);
    if (taken) errors.push(taken.username.toLowerCase() === form.username ? 'That username is taken.' : 'An account with that email already exists.');
  }
  if (errors.length) return res.status(422).render('auth/signup', { title: 'Join FilmHouse', form, errors });

  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, email, password_hash, display_name, status) VALUES (?, ?, ?, ?, ?)')
    .run(form.username, form.email, hashPassword(password), form.display_name, form.status);

  createSession(db, req, res, lastInsertRowid);
  res.redirect('/settings?welcome=1');
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/login', { title: 'Sign in', next: safeNext(req.query.next), error: null, login: '' });
});

router.post('/login', (req, res) => {
  const db = req.app.locals.db;
  const login = String(req.body.login || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(slugifyUsername(login), login);
  if (!user || !verifyPassword(String(req.body.password || ''), user.password_hash)) {
    return res.status(401).render('auth/login', { title: 'Sign in', next: safeNext(req.body.next), error: 'Wrong username or password.', login });
  }
  createSession(db, req, res, user.id);
  res.redirect(safeNext(req.body.next));
});

router.post('/logout', (req, res) => {
  destroySession(req.app.locals.db, req, res);
  res.redirect('/');
});

router.post('/theme', (req, res) => {
  const theme = req.body.theme === 'light' ? 'light' : 'dark';
  res.cookie('fh_theme', theme, { path: '/', sameSite: 'lax', maxAge: 365 * 864e5 });
  res.redirect(safeNext(req.body.next));
});

module.exports = router;

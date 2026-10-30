const crypto = require('node:crypto');

const SESSION_COOKIE = 'fh_session';
const CSRF_COOKIE = 'fh_csrf';
const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (key) out[key] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieOptions(req, maxAgeDays) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: maxAgeDays * 24 * 60 * 60 * 1000,
  };
}

function createSession(db, req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  res.cookie(SESSION_COOKIE, token, cookieOptions(req, SESSION_DAYS));
}

function destroySession(db, req, res) {
  if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

// Attaches req.user / res.locals.currentUser and a double-submit CSRF token to every request.
function sessionMiddleware(db) {
  const findSession = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?`);
  return (req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    const token = req.cookies[SESSION_COOKIE];
    req.user = null;
    if (token) {
      const user = findSession.get(token, new Date().toISOString());
      if (user) {
        req.user = user;
        req.sessionToken = token;
      }
    }
    let csrf = req.cookies[CSRF_COOKIE];
    if (!csrf || !/^[a-f0-9]{48}$/.test(csrf)) {
      csrf = crypto.randomBytes(24).toString('hex');
      res.cookie(CSRF_COOKIE, csrf, cookieOptions(req, 365));
    }
    req.csrfToken = csrf;
    res.locals.currentUser = req.user;
    res.locals.csrfToken = csrf;
    next();
  };
}

// Must run after the body has been parsed (including multipart bodies).
function verifyCsrf(req, res, next) {
  const sent = req.body && req.body._csrf;
  const expected = req.cookies && req.cookies[CSRF_COOKIE];
  if (
    typeof sent === 'string' &&
    expected &&
    sent.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))
  ) {
    return next();
  }
  res.status(403).render('error', { title: 'Form expired', message: 'That form has expired. Go back, refresh the page and try again.' });
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

// Only allow redirects to local paths.
function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  sessionMiddleware,
  verifyCsrf,
  requireAuth,
  safeNext,
};

const crypto = require('node:crypto');

const SESSION_DAYS = 30;
const MIN_PASSWORD_LENGTH = 10;

// Compared against when an account doesn't exist, so a failed login takes the same time either way.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || DUMMY_HASH).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual) && Boolean(stored);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

/**
 * Password rules: length, not the username or email, and (in production) not in a known breach.
 * The breach check sends only the first 5 characters of the password's SHA-1 to Have I Been Pwned.
 */
async function checkPassword(password, { username = '', email = '', checkBreached = false } = {}) {
  const errors = [];
  if (password.length < MIN_PASSWORD_LENGTH) errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (password.length > 200) errors.push('Password is too long.');
  const lower = password.toLowerCase();
  if ((username && lower.includes(username.toLowerCase())) || (email && lower === email.toLowerCase())) {
    errors.push("Your password can't contain your username or be your email.");
  }
  if (!errors.length && checkBreached && (await isBreached(password))) {
    errors.push('That password has appeared in a data breach. Please choose a different one.');
  }
  return errors;
}

async function isBreached(password) {
  const hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    return (await res.text()).split('\n').some((line) => {
      const [suffix, count] = line.trim().split(':');
      return suffix === hash.slice(5) && Number(count) > 0;
    });
  } catch {
    return false; // never block sign-up because the check service is down
  }
}

function cookieNames(config) {
  // The __Host- prefix makes browsers refuse cookies set by subdomains or over plain HTTP.
  return config.isProd ? { session: '__Host-fh_session', csrf: '__Host-fh_csrf' } : { session: 'fh_session', csrf: 'fh_csrf' };
}

function cookieOptions(config, maxAgeDays) {
  return { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/', maxAge: maxAgeDays * 864e5 };
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // ignore malformed cookies
    }
  }
  return out;
}

async function createSession(req, res, userId) {
  const { db, config } = req.app.locals;
  const token = randomToken();
  await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`, [
    sha256(token),
    userId,
    SESSION_DAYS,
  ]);
  res.cookie(cookieNames(config).session, token, cookieOptions(config, SESSION_DAYS));
}

async function destroySession(req, res) {
  const { db, config } = req.app.locals;
  if (req.sessionToken) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(req.sessionToken)]);
  res.clearCookie(cookieNames(config).session, { path: '/', secure: config.isProd, httpOnly: true, sameSite: 'lax' });
}

// Sign a user out of every device (optionally keeping the current session).
async function destroyAllSessions(db, userId, keepToken = null) {
  await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, keepToken ? sha256(keepToken) : '']);
}

// Attaches req.user / res.locals.currentUser and a double-submit CSRF token to every request.
function sessionMiddleware() {
  return async (req, res, next) => {
    const { db, config } = req.app.locals;
    const names = cookieNames(config);
    req.cookies = parseCookies(req.headers.cookie);
    req.user = null;
    const token = req.cookies[names.session];
    if (token) {
      const user = await db.one(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [sha256(token)],
      );
      if (user && !user.suspended_at) {
        req.user = user;
        req.sessionToken = token;
      } else if (user) {
        await db.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      }
    }
    let csrf = req.cookies[names.csrf];
    if (!csrf || !/^[a-f0-9]{48}$/.test(csrf)) {
      csrf = crypto.randomBytes(24).toString('hex');
      res.cookie(names.csrf, csrf, cookieOptions(config, 365));
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
  const expected = req.csrfToken;
  if (typeof sent === 'string' && sent.length === expected.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
    return next();
  }
  res.status(403).render('error', { title: 'Form expired', message: 'That form has expired. Go back, refresh the page and try again.' });
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

// Posting, crediting, recommending and uploading need a confirmed email address.
function requireVerified(req, res, next) {
  if (!req.user) return requireAuth(req, res, next);
  if (req.user.email_verified_at) return next();
  res.status(403).render('auth/verify-needed', { title: 'Confirm your email' });
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  res.status(404).render('error', { title: 'Lost in the dark', message: "This reel doesn't exist." });
}

// Only allow redirects to local paths.
function safeNext(next) {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/';
}

/** Create a single-use emailed link token. Only its hash is stored. */
async function createEmailToken(db, user, purpose, hours) {
  const token = randomToken();
  await db.query('DELETE FROM email_tokens WHERE user_id = $1 AND purpose = $2', [user.id, purpose]);
  await db.query(
    `INSERT INTO email_tokens (token_hash, user_id, purpose, email, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
    [sha256(token), user.id, purpose, user.email, hours],
  );
  return token;
}

/** Use up a token; returns the user it belongs to, or null if invalid, used, expired or the email changed. */
async function consumeEmailToken(db, token, purpose) {
  const row = await db.one(
    `UPDATE email_tokens t SET used_at = now()
     FROM users u
     WHERE t.token_hash = $1 AND t.purpose = $2 AND t.used_at IS NULL AND t.expires_at > now()
       AND u.id = t.user_id AND lower(u.email) = lower(t.email)
     RETURNING u.*`,
    [sha256(String(token || '')), purpose],
  );
  return row;
}

module.exports = {
  hashPassword,
  verifyPassword,
  checkPassword,
  createSession,
  destroySession,
  destroyAllSessions,
  sessionMiddleware,
  verifyCsrf,
  requireAuth,
  requireVerified,
  requireAdmin,
  safeNext,
  createEmailToken,
  consumeEmailToken,
  sha256,
};

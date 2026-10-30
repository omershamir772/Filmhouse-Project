const path = require('node:path');
const express = require('express');
const helmet = require('helmet');

const { sessionMiddleware, verifyCsrf } = require('./lib/auth');
const { createMailer } = require('./lib/email');
const { createStorage } = require('./lib/storage');
const constants = require('./constants');

/**
 * Build the Express app. `db` is required; mailer and storage default to the configured ones.
 * `onError` receives unexpected errors (Sentry in production).
 */
function createApp({ config, db, mailer = createMailer(config.email), storage = createStorage(config.storage), onError = () => {} }) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  Object.assign(app.locals, constants, require('./lib/format'), { db, config, mailer, storage });
  app.locals.mediaUrl = (key) => storage.url(key);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", 'https://fonts.googleapis.com'],
          fontSrc: ['https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https://i.ytimg.com', ...(storage.publicOrigin ? [storage.publicOrigin] : [])],
          frameSrc: ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      strictTransportSecurity: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // YouTube and Vimeo players need to load inside our pages.
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.get('/healthz', async (req, res) => {
    await db.one('SELECT 1 AS ok');
    res.set('Cache-Control', 'no-store').json({ ok: true });
  });

  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '1d' : 0 }));
  if (storage.driver === 'local') {
    app.use('/uploads', express.static(storage.root, { maxAge: '7d', dotfiles: 'deny', index: false }));
  }
  app.use(express.urlencoded({ extended: true, limit: '100kb', parameterLimit: 200 }));
  app.use(sessionMiddleware());

  app.use((req, res, next) => {
    res.locals.path = req.path;
    res.locals.theme = req.cookies.fh_theme === 'light' ? 'light' : 'dark';
    res.locals.readOnly = config.readOnly;
    next();
  });

  // Emergency read-only mode: browsing and signing in/out still work, nothing else changes data.
  app.use((req, res, next) => {
    if (!config.readOnly || req.method === 'GET' || ['/login', '/logout', '/theme'].includes(req.path)) return next();
    res.status(503).render('error', { title: 'Read-only for now', message: 'FilmHouse is in read-only mode for maintenance. Please try again soon.' });
  });

  // Upload routes check CSRF themselves once multer has parsed the multipart body.
  const UPLOAD_ROUTES = new Set(['/feed']);
  app.use((req, res, next) => {
    if (req.method !== 'POST' || (UPLOAD_ROUTES.has(req.path) && req.is('multipart/form-data'))) return next();
    verifyCsrf(req, res, next);
  });

  app.use(require('./routes/home'));
  app.use(require('./routes/auth'));
  app.use(require('./routes/account'));
  app.use(require('./routes/profiles'));
  app.use(require('./routes/films'));
  app.use(require('./routes/board'));
  app.use(require('./routes/feed'));
  app.use(require('./routes/moderation'));
  app.use(require('./routes/pages'));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Lost in the dark', message: "This reel doesn't exist. Maybe it ended up on the cutting room floor." });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) {
      onError(err, req);
      console.error(JSON.stringify({ level: 'error', msg: err.message, path: req.path, stack: config.isProd ? undefined : err.stack }));
    }
    if (res.headersSent) return;
    const message = status >= 500 ? 'The projector jammed. Please try again.' : status === 413 ? 'That was too much to send at once.' : 'That request was not valid.';
    res.status(status).render('error', { title: 'Something went wrong', message });
  });

  return app;
}

module.exports = { createApp };

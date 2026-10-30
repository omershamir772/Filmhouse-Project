const path = require('node:path');
const fs = require('node:fs');
const express = require('express');

const { openDb } = require('./db');
const { sessionMiddleware, verifyCsrf } = require('./lib/auth');
const constants = require('./constants');

function createApp({ db = openDb(), uploadDir = path.join(__dirname, '..', 'uploads') } = {}) {
  fs.mkdirSync(uploadDir, { recursive: true });

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', 'loopback');
  app.locals.db = db;
  app.locals.uploadDir = uploadDir;
  Object.assign(app.locals, constants, require('./lib/format'));

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
    });
    next();
  });

  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
  app.use('/uploads', express.static(uploadDir, { maxAge: '7d' }));
  app.use(express.urlencoded({ extended: true, limit: '200kb' }));
  app.use(sessionMiddleware(db));

  app.use((req, res, next) => {
    res.locals.path = req.path;
    res.locals.theme = req.cookies.fh_theme === 'light' ? 'light' : 'dark';
    next();
  });

  // Upload routes check CSRF themselves once multer has parsed the multipart body.
  const UPLOAD_ROUTES = new Set(['/feed']);
  app.use((req, res, next) => {
    if (req.method !== 'POST' || (UPLOAD_ROUTES.has(req.path) && req.is('multipart/form-data'))) return next();
    verifyCsrf(req, res, next);
  });

  app.use(require('./routes/home'));
  app.use(require('./routes/auth'));
  app.use(require('./routes/profiles'));
  app.use(require('./routes/films'));
  app.use(require('./routes/board'));
  app.use(require('./routes/feed'));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Lost in the dark', message: "This reel doesn't exist. Maybe it ended up on the cutting room floor." });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    const status = err.status || 500;
    const message = status === 500 ? 'The projector jammed. Please try again.' : err.message;
    res.status(status).render('error', { title: 'Something went wrong', message });
  });

  return app;
}

module.exports = { createApp };

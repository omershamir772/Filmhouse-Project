const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

const { requireAuth, verifyCsrf } = require('../lib/auth');

const router = express.Router();
const PAGE_SIZE = 18;
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

function upload(req, res, next) {
  const handler = multer({
    storage: multer.diskStorage({
      destination: req.app.locals.uploadDir,
      filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + IMAGE_TYPES[file.mimetype]),
    }),
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 10 },
    fileFilter: (req, file, cb) => cb(null, Boolean(IMAGE_TYPES[file.mimetype])),
  }).single('photo');
  handler(req, res, (err) => {
    if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'Photos must be under 8 MB.' : 'That upload failed.';
    next();
  });
}

function removeUpload(req) {
  if (req.file) fs.rm(req.file.path, { force: true }, () => {});
}

// Films the user can attach a set photo to: ones they own or are credited on.
function myFilms(db, userId) {
  return db
    .prepare(`
      SELECT DISTINCT f.id, f.title FROM films f LEFT JOIN credits c ON c.film_id = f.id
      WHERE f.owner_id = :id OR c.user_id = :id ORDER BY f.created_at DESC`)
    .all({ id: userId });
}

function renderFeed(req, res, status, { errors = [], form = {} } = {}) {
  const db = req.app.locals.db;
  const page = Math.max(1, Number(req.query.page) || 1);
  const photos = db
    .prepare(`
      SELECT p.*, u.username, u.display_name, u.status, f.title AS film_title
      FROM set_photos p JOIN users u ON u.id = p.author_id LEFT JOIN films f ON f.id = p.film_id
      ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`)
    .all(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
  res.status(status).render('feed/index', {
    title: 'From the set',
    photos: photos.slice(0, PAGE_SIZE),
    page,
    hasMore: photos.length > PAGE_SIZE,
    myFilms: req.user ? myFilms(db, req.user.id) : [],
    errors,
    form,
  });
}

router.get('/feed', (req, res) => renderFeed(req, res, 200));

// CSRF can only be checked once multer has parsed the body; discard the file if it fails.
function verifyCsrfAfterUpload(req, res, next) {
  let ok = false;
  verifyCsrf(req, res, () => {
    ok = true;
  });
  if (ok) next();
  else removeUpload(req);
}

router.post('/feed', requireAuth, upload, verifyCsrfAfterUpload, (req, res) => {
  const db = req.app.locals.db;
  const caption = String(req.body.caption || '').trim();
  const filmId = req.body.film_id ? Number(req.body.film_id) : null;
  const errors = [];
  if (req.uploadError) errors.push(req.uploadError);
  else if (!req.file) errors.push('Choose a JPEG, PNG, WebP or GIF photo from your set.');
  if (caption.length > 500) errors.push('Keep captions under 500 characters.');
  if (filmId && !myFilms(db, req.user.id).some((f) => f.id === filmId)) errors.push('You can only tag films you worked on.');
  if (errors.length) {
    removeUpload(req);
    return renderFeed(req, res, 422, { errors, form: { caption, film_id: filmId } });
  }
  db.prepare('INSERT INTO set_photos (author_id, film_id, image_path, caption) VALUES (?, ?, ?, ?)')
    .run(req.user.id, filmId, req.file.filename, caption);
  res.redirect('/feed');
});

router.post('/feed/:id/delete', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const photo = db.prepare('SELECT * FROM set_photos WHERE id = ?').get(Number(req.params.id) || 0);
  if (photo && photo.author_id === req.user.id) {
    db.prepare('DELETE FROM set_photos WHERE id = ?').run(photo.id);
    fs.rm(path.join(req.app.locals.uploadDir, path.basename(photo.image_path)), { force: true }, () => {});
  }
  res.redirect(req.get('referer')?.includes('/u/') ? `/u/${req.user.username}` : '/feed');
});

module.exports = router;

const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');

const { requireAuth, requireVerified, verifyCsrf } = require('../lib/auth');
const { rateLimit } = require('../lib/rateLimit');
const { processImage, ImageError } = require('../lib/images');
const { blockedIds } = require('../lib/moderation');

const router = express.Router();
const PAGE_SIZE = 18;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

// Files are kept in memory only long enough to be re-encoded; the original bytes are never stored.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10, parts: 12 },
}).single('photo');

function parseUpload(req, res, next) {
  upload(req, res, (err) => {
    if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'Photos must be under 8 MB.' : 'That upload failed.';
    next();
  });
}

// Films the user can attach a set photo to: ones they own or are credited on.
async function myFilms(db, userId) {
  return db.query(
    `SELECT DISTINCT f.id, f.title, f.created_at FROM films f LEFT JOIN credits c ON c.film_id = f.id
     WHERE f.owner_id = $1 OR c.user_id = $1 ORDER BY f.created_at DESC`,
    [userId],
  );
}

async function renderFeed(req, res, status, { errors = [], form = {} } = {}) {
  const db = req.app.locals.db;
  const page = Math.min(500, Math.max(1, Number(req.query.page) || 1));
  const blocked = await blockedIds(db, req.user);
  const photos = await db.query(
    `SELECT p.*, u.username, u.display_name, u.status, f.title AS film_title
     FROM set_photos p JOIN users u ON u.id = p.author_id LEFT JOIN films f ON f.id = p.film_id AND f.hidden_at IS NULL
     WHERE p.hidden_at IS NULL AND u.suspended_at IS NULL
     ORDER BY p.created_at DESC, p.id DESC LIMIT $1 OFFSET $2`,
    [PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
  );
  res.status(status).render('feed/index', {
    title: 'From the set',
    photos: photos.slice(0, PAGE_SIZE).filter((p) => !blocked.has(p.author_id)),
    page,
    hasMore: photos.length > PAGE_SIZE,
    myFilms: req.user ? await myFilms(db, req.user.id) : [],
    errors,
    form,
  });
}

router.get('/feed', (req, res) => renderFeed(req, res, 200));

router.post('/feed', requireVerified, rateLimit('uploadsPerUser', (req) => req.user.id), parseUpload, verifyCsrf, async (req, res) => {
  const { db, storage } = req.app.locals;
  const caption = String(req.body.caption || '').trim();
  const filmId = req.body.film_id ? Number(req.body.film_id) : null;
  const errors = [];
  if (req.uploadError) errors.push(req.uploadError);
  else if (!req.file) errors.push('Choose a JPEG, PNG, WebP or GIF photo from your set.');
  if (caption.length > 500) errors.push('Keep captions under 500 characters.');
  if (filmId && !(await myFilms(db, req.user.id)).some((f) => f.id === filmId)) errors.push('You can only tag films you worked on.');

  let image;
  if (!errors.length) {
    try {
      image = await processImage(req.file.buffer);
    } catch (err) {
      if (!(err instanceof ImageError)) throw err;
      errors.push(err.message);
    }
  }
  if (errors.length) return renderFeed(req, res, 422, { errors, form: { caption, film_id: filmId } });

  const id = crypto.randomBytes(16).toString('hex');
  const imageKey = `photos/${id}.webp`;
  const thumbKey = `photos/${id}-thumb.webp`;
  await storage.put(imageKey, image.full, 'image/webp');
  await storage.put(thumbKey, image.thumb, 'image/webp');
  await db.query(
    'INSERT INTO set_photos (author_id, film_id, image_key, thumb_key, width, height, caption) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [req.user.id, filmId, imageKey, thumbKey, image.width, image.height, caption],
  );
  res.redirect('/feed');
});

router.post('/feed/:id/delete', requireAuth, async (req, res) => {
  const { db, storage } = req.app.locals;
  const photo = await db.one('DELETE FROM set_photos WHERE id = $1 AND author_id = $2 RETURNING *', [Number(req.params.id) || 0, req.user.id]);
  if (photo) {
    await storage.remove(photo.image_key);
    await storage.remove(photo.thumb_key);
  }
  res.redirect('/feed');
});

module.exports = router;

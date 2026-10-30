const express = require('express');
const { popularFilms, withDirectors } = require('../lib/films');

const router = express.Router();

router.get('/', async (req, res) => {
  const db = req.app.locals.db;
  const [today, week, newestRows, photos, posts, latestRec, stats] = await Promise.all([
    popularFilms(db, '1 day', 4),
    popularFilms(db, '7 days', 8),
    db.query(
      `SELECT f.* FROM films f JOIN users u ON u.id = f.owner_id
       WHERE f.hidden_at IS NULL AND u.suspended_at IS NULL ORDER BY f.created_at DESC, f.id DESC LIMIT 4`,
    ),
    db.query(
      `SELECT p.*, u.username, u.display_name FROM set_photos p JOIN users u ON u.id = p.author_id
       WHERE p.hidden_at IS NULL AND u.suspended_at IS NULL ORDER BY p.created_at DESC, p.id DESC LIMIT 6`,
    ),
    db.query(
      `SELECT p.*, u.username, u.display_name,
         (SELECT string_agg(role, ', ' ORDER BY role) FROM board_post_roles r WHERE r.post_id = p.id) AS roles
       FROM board_posts p JOIN users u ON u.id = p.author_id
       WHERE p.hidden_at IS NULL AND u.suspended_at IS NULL
         AND (COALESCE(p.end_date, p.start_date) IS NULL OR COALESCE(p.end_date, p.start_date) >= current_date)
       ORDER BY p.created_at DESC, p.id DESC LIMIT 4`,
    ),
    db.one(
      `SELECT r.*, f.title AS film_title, u.username, u.display_name
       FROM recommendations r JOIN films f ON f.id = r.film_id JOIN users u ON u.id = r.author_id
       WHERE r.hidden_at IS NULL AND f.hidden_at IS NULL AND u.suspended_at IS NULL
       ORDER BY r.created_at DESC, r.id DESC LIMIT 1`,
    ),
    db.one(
      `SELECT (SELECT COUNT(*) FROM users WHERE suspended_at IS NULL) AS members,
              (SELECT COUNT(*) FROM films WHERE hidden_at IS NULL) AS films,
              (SELECT COUNT(*) FROM credits WHERE user_id IS NOT NULL) AS credits`,
    ),
  ]);
  const newest = await withDirectors(db, newestRows);
  res.render('home', { title: null, today, week, newest, photos, posts, latestRec, stats });
});

module.exports = router;

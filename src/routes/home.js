const express = require('express');
const { popularFilms, withDirectors } = require('../lib/films');

const router = express.Router();

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const today = popularFilms(db, '-1 day', 4);
  const week = popularFilms(db, '-7 days', 8);
  const newest = withDirectors(
    db,
    db.prepare('SELECT * FROM films ORDER BY created_at DESC, id DESC LIMIT 4').all(),
  );
  const photos = db
    .prepare(`
      SELECT p.*, u.username, u.display_name FROM set_photos p JOIN users u ON u.id = p.author_id
      ORDER BY p.created_at DESC, p.id DESC LIMIT 6`)
    .all();
  const posts = db
    .prepare(`
      SELECT p.*, u.username, u.display_name,
        (SELECT group_concat(role, ', ') FROM board_post_roles r WHERE r.post_id = p.id) AS roles
      FROM board_posts p JOIN users u ON u.id = p.author_id
      WHERE COALESCE(p.end_date, p.start_date) IS NULL OR COALESCE(p.end_date, p.start_date) >= date('now')
      ORDER BY p.created_at DESC, p.id DESC LIMIT 4`)
    .all();
  const latestRec = db
    .prepare(`
      SELECT r.*, f.title AS film_title, u.username, u.display_name
      FROM recommendations r JOIN films f ON f.id = r.film_id JOIN users u ON u.id = r.author_id
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1`)
    .get();
  const stats = db
    .prepare(`SELECT (SELECT COUNT(*) FROM users) AS members, (SELECT COUNT(*) FROM films) AS films,
                     (SELECT COUNT(*) FROM credits WHERE user_id IS NOT NULL) AS credits`)
    .get();

  res.render('home', { title: null, today, week, newest, photos, posts, latestRec, stats });
});

module.exports = router;

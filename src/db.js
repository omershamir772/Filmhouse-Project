const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY,
  username           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash      TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'Student',
  crafts             TEXT NOT NULL DEFAULT '',   -- comma separated roles, e.g. "Cinematographer,Gaffer / Lighting"
  location           TEXT NOT NULL DEFAULT '',
  school             TEXT NOT NULL DEFAULT '',
  bio                TEXT NOT NULL DEFAULT '',
  letterboxd         TEXT NOT NULL DEFAULT '',   -- Letterboxd username
  website            TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS films (
  id           INTEGER PRIMARY KEY,
  owner_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  year         INTEGER,
  runtime_min  INTEGER,
  logline      TEXT NOT NULL DEFAULT '',
  video_url    TEXT NOT NULL,
  provider     TEXT NOT NULL,               -- 'youtube' | 'vimeo'
  video_id     TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A credit links a film to a role and, when the person is on FilmHouse, to their profile.
-- People who haven't joined yet are credited by name only.
CREATE TABLE IF NOT EXISTS credits (
  id        INTEGER PRIMARY KEY,
  film_id   INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  role      TEXT NOT NULL,
  user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name      TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS credits_user ON credits(user_id);
CREATE INDEX IF NOT EXISTS credits_film ON credits(film_id);

-- One row per visitor per film per day, so refreshing a page doesn't inflate "popular".
CREATE TABLE IF NOT EXISTS film_views (
  id         INTEGER PRIMARY KEY,
  film_id    INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  viewer     TEXT NOT NULL,
  day        TEXT NOT NULL DEFAULT (date('now')),
  viewed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (film_id, viewer, day)
);
CREATE INDEX IF NOT EXISTS film_views_film_time ON film_views(film_id, viewed_at);

-- Role-specific, long-form recommendations (our answer to the "like" button).
CREATE TABLE IF NOT EXISTS recommendations (
  id          INTEGER PRIMARY KEY,
  film_id     INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  body        TEXT NOT NULL,
  word_count  INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (film_id, author_id, role)
);

CREATE TABLE IF NOT EXISTS board_posts (
  id           INTEGER PRIMARY KEY,
  author_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,              -- 'crew_call' | 'available'
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  location     TEXT NOT NULL DEFAULT '',
  start_date   TEXT,                       -- YYYY-MM-DD
  end_date     TEXT,
  compensation TEXT NOT NULL DEFAULT '',
  contact      TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS board_post_roles (
  post_id  INTEGER NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
  role     TEXT NOT NULL,
  PRIMARY KEY (post_id, role)
);

-- Behind-the-scenes photos from set.
CREATE TABLE IF NOT EXISTS set_photos (
  id          INTEGER PRIMARY KEY,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  film_id     INTEGER REFERENCES films(id) ON DELETE SET NULL,
  image_path  TEXT NOT NULL,
  caption     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function openDb(file = process.env.FILMHOUSE_DB || path.join(__dirname, '..', 'data', 'filmhouse.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

// Run fn inside a transaction, rolling back if it throws.
function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDb, transaction };

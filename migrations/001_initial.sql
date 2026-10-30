-- FilmHouse initial schema (PostgreSQL).

CREATE TABLE users (
  id                 SERIAL PRIMARY KEY,
  username           TEXT NOT NULL,
  email              TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'Student',
  crafts             TEXT NOT NULL DEFAULT '',   -- comma separated roles
  location           TEXT NOT NULL DEFAULT '',
  school             TEXT NOT NULL DEFAULT '',
  bio                TEXT NOT NULL DEFAULT '',
  letterboxd         TEXT NOT NULL DEFAULT '',
  website            TEXT NOT NULL DEFAULT '',
  role               TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  email_verified_at  TIMESTAMPTZ,
  suspended_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_key ON users (lower(username));
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Only a SHA-256 of each session token is stored, so a database leak doesn't leak live sessions.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Single-use links for email verification and password resets (also stored hashed).
CREATE TABLE email_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  email       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE TABLE films (
  id           SERIAL PRIMARY KEY,
  owner_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  year         INTEGER,
  runtime_min  INTEGER,
  logline      TEXT NOT NULL DEFAULT '',
  video_url    TEXT NOT NULL,
  provider     TEXT NOT NULL,
  video_id     TEXT NOT NULL,
  hidden_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE credits (
  id        SERIAL PRIMARY KEY,
  film_id   INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  role      TEXT NOT NULL,
  user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name      TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX credits_user ON credits (user_id);
CREATE INDEX credits_film ON credits (film_id);

CREATE TABLE film_views (
  id         SERIAL PRIMARY KEY,
  film_id    INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  viewer     TEXT NOT NULL,
  day        DATE NOT NULL DEFAULT current_date,
  viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (film_id, viewer, day)
);
CREATE INDEX film_views_time ON film_views (film_id, viewed_at);

CREATE TABLE recommendations (
  id          SERIAL PRIMARY KEY,
  film_id     INTEGER NOT NULL REFERENCES films(id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  body        TEXT NOT NULL,
  word_count  INTEGER NOT NULL,
  hidden_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (film_id, author_id, role)
);

CREATE TABLE board_posts (
  id           SERIAL PRIMARY KEY,
  author_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('crew_call', 'available')),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  location     TEXT NOT NULL DEFAULT '',
  start_date   DATE,
  end_date     DATE,
  compensation TEXT NOT NULL DEFAULT '',
  contact      TEXT NOT NULL DEFAULT '',
  hidden_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE board_post_roles (
  post_id  INTEGER NOT NULL REFERENCES board_posts(id) ON DELETE CASCADE,
  role     TEXT NOT NULL,
  PRIMARY KEY (post_id, role)
);

CREATE TABLE set_photos (
  id          SERIAL PRIMARY KEY,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  film_id     INTEGER REFERENCES films(id) ON DELETE SET NULL,
  image_key   TEXT NOT NULL,
  thumb_key   TEXT NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  caption     TEXT NOT NULL DEFAULT '',
  hidden_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Moderation.
CREATE TABLE reports (
  id           SERIAL PRIMARY KEY,
  reporter_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_type  TEXT NOT NULL CHECK (target_type IN ('user', 'film', 'recommendation', 'post', 'photo')),
  target_id    INTEGER NOT NULL,
  reason       TEXT NOT NULL,
  details      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  resolved_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reports_open ON reports (status, created_at);

CREATE TABLE blocks (
  blocker_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

-- Every admin action, kept even when the admin's account is deleted.
CREATE TABLE audit_log (
  id           SERIAL PRIMARY KEY,
  actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name   TEXT NOT NULL,
  action       TEXT NOT NULL,
  target_type  TEXT NOT NULL,
  target_id    INTEGER,
  details      TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fixed-window counters for rate limiting, shared by every app instance.
CREATE TABLE rate_limits (
  key           TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE IF NOT EXISTS films (
  id           TEXT PRIMARY KEY,
  owner_hash   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('unlisted', 'pending', 'public', 'hidden')),
  created      INTEGER NOT NULL,
  shared       INTEGER NOT NULL,
  title        TEXT NOT NULL,
  subtitle     TEXT NOT NULL DEFAULT '',
  topic        TEXT NOT NULL DEFAULT '',
  lang         TEXT NOT NULL DEFAULT 'en',
  style        TEXT NOT NULL DEFAULT '',
  style_label  TEXT NOT NULL DEFAULT '',
  narrator     TEXT NOT NULL DEFAULT '',
  voice        TEXT NOT NULL DEFAULT '',
  character_id TEXT NOT NULL DEFAULT '',
  minutes      INTEGER,
  duration     REAL NOT NULL DEFAULT 0,
  media        TEXT NOT NULL,
  story        TEXT NOT NULL,
  views        INTEGER NOT NULL DEFAULT 0,
  reports      INTEGER NOT NULL DEFAULT 0,
  ip_hash      TEXT NOT NULL DEFAULT '',
  link_at      INTEGER,
  link_ip      TEXT NOT NULL DEFAULT '',
  flag         TEXT NOT NULL DEFAULT '',
  moderation   TEXT NOT NULL DEFAULT '',
  wants        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS films_status ON films (status, shared DESC);
CREATE INDEX IF NOT EXISTS films_ip ON films (ip_hash, shared);
CREATE INDEX IF NOT EXISTS films_links ON films (link_ip, link_at);

CREATE TABLE IF NOT EXISTS reports (
  film_id  TEXT NOT NULL,
  ip_hash  TEXT NOT NULL,
  reason   TEXT NOT NULL DEFAULT '',
  created  INTEGER NOT NULL,
  PRIMARY KEY (film_id, ip_hash)
);

CREATE TABLE IF NOT EXISTS issues (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  film_id  TEXT NOT NULL,
  kind     TEXT NOT NULL,
  note     TEXT NOT NULL DEFAULT '',
  title    TEXT NOT NULL DEFAULT '',
  video    TEXT NOT NULL DEFAULT '',
  at       REAL,
  ip_hash  TEXT NOT NULL DEFAULT '',
  created  INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS issues_created ON issues (resolved, created DESC);
CREATE INDEX IF NOT EXISTS issues_ip ON issues (ip_hash, created);

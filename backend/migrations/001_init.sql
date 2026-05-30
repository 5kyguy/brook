-- Tracks (populated/refreshed on scan)
CREATE TABLE IF NOT EXISTS tracks (
  id              TEXT PRIMARY KEY,
  absolute_path   TEXT NOT NULL,
  extension       TEXT NOT NULL,
  file_size       INTEGER NOT NULL,
  modified_ms     INTEGER NOT NULL,
  title           TEXT,
  artist          TEXT,
  album           TEXT,
  year            INTEGER,
  duration_secs   REAL,
  cover_hash      TEXT,
  has_lrc         INTEGER NOT NULL DEFAULT 0,
  lrc_path        TEXT,
  embedded_lyrics TEXT,
  scanned_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
CREATE INDEX IF NOT EXISTS idx_tracks_year ON tracks(year);

CREATE TABLE IF NOT EXISTS favorites (
  track_id        TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  added_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id     TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id        TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS play_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id          TEXT NOT NULL REFERENCES tracks(id),
  played_at         INTEGER NOT NULL,
  duration_listened REAL NOT NULL,
  completed         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS listening_stats (
  track_id        TEXT PRIMARY KEY REFERENCES tracks(id),
  play_count      INTEGER NOT NULL DEFAULT 0,
  total_secs      REAL NOT NULL DEFAULT 0,
  full_listens    INTEGER NOT NULL DEFAULT 0,
  last_played_at  INTEGER
);

CREATE TABLE IF NOT EXISTS app_settings (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL
);

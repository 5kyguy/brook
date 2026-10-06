pub mod charts;
pub mod stats;

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::metadata::TrackMetadata;
use crate::models::{
    LibraryFacets, Playlist, PlaylistKind, SmartPlaylistConfig, Track, TrackFilter,
};
use crate::scanner::ScannedFile;

#[derive(Debug, Clone)]
pub struct TrackRow {
    pub id: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub extension: String,
    pub file_size: u64,
    pub modified_ms: i128,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub duration_secs: Option<f64>,
    pub has_lrc: bool,
    pub lrc_path: Option<String>,
    pub embedded_lyrics: Option<String>,
    /// ReplayGain track gain in dB (negative usually reduces volume).
    pub replay_gain_track_db: Option<f64>,
    /// ReplayGain track peak (0..1) used to clamp the gain to avoid clipping.
    pub replay_gain_track_peak: Option<f64>,
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| e.to_string())?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<(), String> {
        let sql = include_str!("../../migrations/001_init.sql");
        self.conn.execute_batch(sql).map_err(|e| e.to_string())?;
        self.migrate_stats_charts()?;
        self.migrate_track_genre()?;
        self.migrate_smart_playlists()
    }

    fn migrate_smart_playlists(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS smart_playlist_rules (
                    playlist_id TEXT PRIMARY KEY REFERENCES playlists(id) ON DELETE CASCADE,
                    config     TEXT NOT NULL
                );",
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn migrate_track_genre(&self) -> Result<(), String> {
        if !self.tracks_has_column("genre")? {
            self.conn
                .execute("ALTER TABLE tracks ADD COLUMN genre TEXT", [])
                .map_err(|e| e.to_string())?;
        }
        self.migrate_replaygain()
    }

    fn tracks_has_column(&self, name: &str) -> Result<bool, String> {
        let mut stmt = self
            .conn
            .prepare("PRAGMA table_info(tracks)")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        for col in rows.flatten() {
            if col == name {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn migrate_replaygain(&self) -> Result<(), String> {
        if !self.tracks_has_column("replay_gain_track_db")? {
            self.conn
                .execute(
                    "ALTER TABLE tracks ADD COLUMN replay_gain_track_db REAL",
                    [],
                )
                .map_err(|e| e.to_string())?;
        }
        if !self.tracks_has_column("replay_gain_track_peak")? {
            self.conn
                .execute(
                    "ALTER TABLE tracks ADD COLUMN replay_gain_track_peak REAL",
                    [],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn migrate_stats_charts(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at);
                 CREATE INDEX IF NOT EXISTS idx_play_history_track_id ON play_history(track_id);",
            )
            .map_err(|e| e.to_string())?;

        let has_kind = self.playlists_has_kind_column()?;
        if !has_kind {
            self.conn
                .execute(
                    "ALTER TABLE playlists ADD COLUMN kind TEXT NOT NULL DEFAULT 'user'",
                    [],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn playlists_has_kind_column(&self) -> Result<bool, String> {
        let mut stmt = self
            .conn
            .prepare("PRAGMA table_info(playlists)")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        for name in rows.flatten() {
            if name == "kind" {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM app_settings WHERE key = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![key]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            Ok(Some(row.get(0).map_err(|e| e.to_string())?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Last-saved playback position for resume-on-launch.
    pub fn get_resume_state(&self) -> Result<Option<crate::models::ResumeState>, String> {
        match self.get_setting("resume_state")? {
            Some(json) => serde_json::from_str(&json)
                .map(Some)
                .map_err(|e| format!("Failed to parse resume state: {e}")),
            None => Ok(None),
        }
    }

    pub fn set_resume_state(&self, state: &crate::models::ResumeState) -> Result<(), String> {
        let json = serde_json::to_string(state).map_err(|e| e.to_string())?;
        self.set_setting("resume_state", &json)
    }

    pub fn get_scan_fingerprints(
        &self,
    ) -> Result<std::collections::HashMap<String, (i64, i64)>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, modified_ms, file_size FROM tracks")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut map = std::collections::HashMap::new();
        for row in rows {
            let (id, mtime, size) = row.map_err(|e| e.to_string())?;
            map.insert(id, (mtime, size));
        }
        Ok(map)
    }

    pub fn delete_tracks_not_in(&mut self, keep_ids: &[String]) -> Result<usize, String> {
        if keep_ids.is_empty() {
            let removed = self
                .conn
                .execute("DELETE FROM tracks", [])
                .map_err(|e| e.to_string())?;
            return Ok(removed);
        }

        let placeholders = keep_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!("DELETE FROM tracks WHERE id NOT IN ({placeholders})");
        let params: Vec<&dyn rusqlite::ToSql> = keep_ids
            .iter()
            .map(|id| id as &dyn rusqlite::ToSql)
            .collect();
        self.conn
            .execute(&sql, params.as_slice())
            .map_err(|e| e.to_string())
    }

    pub fn begin_batch(&mut self) -> Result<(), String> {
        self.conn
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())
    }

    pub fn commit_batch(&mut self) -> Result<(), String> {
        self.conn.execute_batch("COMMIT").map_err(|e| e.to_string())
    }

    pub fn get_library_facets(&self) -> Result<LibraryFacets, String> {
        let mut artist_stmt = self
            .conn
            .prepare(
                "SELECT DISTINCT artist FROM tracks
                 WHERE artist IS NOT NULL AND TRIM(artist) != ''
                 ORDER BY artist COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let artists = artist_stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut album_stmt = self
            .conn
            .prepare(
                "SELECT DISTINCT album FROM tracks
                 WHERE album IS NOT NULL AND TRIM(album) != ''
                 ORDER BY album COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let albums = album_stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut year_stmt = self
            .conn
            .prepare(
                "SELECT DISTINCT year FROM tracks
                 WHERE year IS NOT NULL
                 ORDER BY year DESC",
            )
            .map_err(|e| e.to_string())?;
        let years = year_stmt
            .query_map([], |row| row.get::<_, i32>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let track_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;

        Ok(LibraryFacets {
            artists,
            albums,
            years,
            track_count: track_count.max(0) as usize,
        })
    }

    pub fn upsert_track(&mut self, file: &ScannedFile, meta: &TrackMetadata) -> Result<(), String> {
        let scanned_at = now_ms();
        self.conn
            .execute(
                "INSERT INTO tracks (
                    id, absolute_path, extension, file_size, modified_ms,
                    title, artist, album, genre, year, duration_secs,
                    has_lrc, lrc_path, embedded_lyrics, scanned_at,
                    replay_gain_track_db, replay_gain_track_peak
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
                ON CONFLICT(id) DO UPDATE SET
                    absolute_path = excluded.absolute_path,
                    extension = excluded.extension,
                    file_size = excluded.file_size,
                    modified_ms = excluded.modified_ms,
                    title = excluded.title,
                    artist = excluded.artist,
                    album = excluded.album,
                    genre = excluded.genre,
                    year = excluded.year,
                    duration_secs = excluded.duration_secs,
                    has_lrc = excluded.has_lrc,
                    lrc_path = excluded.lrc_path,
                    embedded_lyrics = excluded.embedded_lyrics,
                    scanned_at = excluded.scanned_at,
                    replay_gain_track_db = excluded.replay_gain_track_db,
                    replay_gain_track_peak = excluded.replay_gain_track_peak",
                params![
                    file.id,
                    file.absolute_path,
                    file.extension,
                    file.file_size as i64,
                    file.modified_ms as i64,
                    meta.title,
                    meta.artist,
                    meta.album,
                    meta.genre,
                    meta.year,
                    meta.duration_secs,
                    i32::from(file.has_lrc),
                    file.lrc_path,
                    meta.embedded_lyrics,
                    scanned_at,
                    meta.replay_gain_track_db,
                    meta.replay_gain_track_peak,
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_track_row(&self, id: &str) -> Result<TrackRow, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, id, absolute_path, extension, file_size, modified_ms,
                        title, artist, album, genre, year, duration_secs,
                        has_lrc, lrc_path, embedded_lyrics,
                        replay_gain_track_db, replay_gain_track_peak
                 FROM tracks WHERE id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let row = stmt
            .query_row(params![id], map_track_row_full)
            .map_err(|e| format!("Track not found: {id} ({e})"))?;
        Ok(row)
    }

    pub fn get_track(&self, id: &str) -> Result<Track, String> {
        let row = self.get_track_row(id)?;
        Ok(row_to_track(row, self.is_favorite(id)?))
    }

    pub fn get_tracks(&self, filter: Option<&TrackFilter>) -> Result<Vec<Track>, String> {
        let filter = filter.cloned().unwrap_or_default();
        let mut sql = String::from(
            "SELECT t.id, t.id, t.absolute_path, t.extension, t.file_size, t.modified_ms,
                    t.title, t.artist, t.album, t.genre, t.year, t.duration_secs,
                    t.has_lrc, t.lrc_path, t.embedded_lyrics,
                    CASE WHEN f.track_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
             FROM tracks t
             LEFT JOIN favorites f ON f.track_id = t.id
             WHERE 1=1",
        );

        let mut bind: Vec<rusqlite::types::Value> = Vec::new();

        if let Some(artist) = filter.artist.filter(|s| !s.is_empty()) {
            sql.push_str(" AND t.artist = ?");
            bind.push(artist.into());
        }
        if let Some(album) = filter.album.filter(|s| !s.is_empty()) {
            sql.push_str(" AND t.album = ?");
            bind.push(album.into());
        }
        if let Some(year) = filter.year {
            sql.push_str(" AND t.year = ?");
            bind.push(year.into());
        }
        if let Some(query) = filter
            .query
            .as_ref()
            .map(|q| q.trim())
            .filter(|q| !q.is_empty())
        {
            sql.push_str(
                " AND (t.title LIKE ? OR t.artist LIKE ? OR t.album LIKE ? OR t.id LIKE ?)",
            );
            let pattern = format!("%{query}%");
            bind.push(pattern.clone().into());
            bind.push(pattern.clone().into());
            bind.push(pattern.clone().into());
            bind.push(pattern.into());
        }

        let sort_by = filter.sort_by.as_deref().unwrap_or("title");
        let sort_order = filter.sort_order.as_deref().unwrap_or("asc");
        let sort_dir = if sort_order.eq_ignore_ascii_case("desc") {
            "DESC"
        } else {
            "ASC"
        };
        let order_by = match sort_by {
            "artist" => format!("t.artist COLLATE NOCASE {sort_dir}"),
            "album" => format!("t.album COLLATE NOCASE {sort_dir}"),
            "year" => format!("t.year {sort_dir}"),
            "dateAdded" | "date_added" => format!("t.scanned_at {sort_dir}"),
            _ => format!("t.title COLLATE NOCASE {sort_dir}"),
        };
        sql.push_str(&format!(" ORDER BY {order_by}"));

        if let Some(limit) = filter.limit {
            let limit = limit.max(0) as i64;
            sql.push_str(" LIMIT ? OFFSET ?");
            bind.push(limit.into());
            let offset = filter.offset.unwrap_or(0).max(0) as i64;
            bind.push(offset.into());
        }

        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;

        fn collect_tracks(mut rows: rusqlite::Rows<'_>) -> Result<Vec<Track>, String> {
            let mut tracks = Vec::new();
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let track_row = map_track_row(&row).map_err(|e| e.to_string())?;
                let is_favorite: i32 = row.get(15).map_err(|e| e.to_string())?;
                tracks.push(row_to_track(track_row, is_favorite != 0));
            }
            Ok(tracks)
        }

        let param_refs: Vec<&dyn rusqlite::ToSql> =
            bind.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        let rows = stmt
            .query(param_refs.as_slice())
            .map_err(|e| e.to_string())?;
        collect_tracks(rows)
    }

    fn is_favorite(&self, track_id: &str) -> Result<bool, String> {
        let count: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM favorites WHERE track_id = ?1",
                params![track_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(count > 0)
    }

    /// Count of tracks matching `filter`, ignoring `limit`/`offset`. Used by
    /// the paged list to size a scroll sentinel without re-running the row
    /// query.
    pub fn get_tracks_count(&self, filter: Option<&TrackFilter>) -> Result<usize, String> {
        let filter = filter.cloned().unwrap_or_default();
        let mut sql = String::from("SELECT COUNT(*) FROM tracks t WHERE 1=1");
        let mut bind: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(artist) = filter.artist.filter(|s| !s.is_empty()) {
            sql.push_str(" AND t.artist = ?");
            bind.push(artist.into());
        }
        if let Some(album) = filter.album.filter(|s| !s.is_empty()) {
            sql.push_str(" AND t.album = ?");
            bind.push(album.into());
        }
        if let Some(year) = filter.year {
            sql.push_str(" AND t.year = ?");
            bind.push(year.into());
        }
        if let Some(query) = filter
            .query
            .as_ref()
            .map(|q| q.trim())
            .filter(|q| !q.is_empty())
        {
            sql.push_str(
                " AND (t.title LIKE ? OR t.artist LIKE ? OR t.album LIKE ? OR t.id LIKE ?)",
            );
            let pattern = format!("%{query}%");
            bind.push(pattern.clone().into());
            bind.push(pattern.clone().into());
            bind.push(pattern.clone().into());
            bind.push(pattern.into());
        }
        let param_refs: Vec<&dyn rusqlite::ToSql> =
            bind.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        let count: i64 = self
            .conn
            .query_row(&sql, param_refs.as_slice(), |row| row.get(0))
            .map_err(|e| e.to_string())?;
        Ok(count.max(0) as usize)
    }

    pub fn toggle_favorite(&self, track_id: &str) -> Result<bool, String> {
        self.get_track_row(track_id)?;
        if self.is_favorite(track_id)? {
            self.conn
                .execute(
                    "DELETE FROM favorites WHERE track_id = ?1",
                    params![track_id],
                )
                .map_err(|e| e.to_string())?;
            Ok(false)
        } else {
            self.conn
                .execute(
                    "INSERT INTO favorites (track_id, added_at) VALUES (?1, ?2)",
                    params![track_id, now_ms()],
                )
                .map_err(|e| e.to_string())?;
            Ok(true)
        }
    }

    pub fn get_favorites(&self) -> Result<Vec<Track>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT t.id, t.id, t.absolute_path, t.extension, t.file_size, t.modified_ms,
                        t.title, t.artist, t.album, t.genre, t.year, t.duration_secs,
                        t.has_lrc, t.lrc_path, t.embedded_lyrics
                 FROM tracks t
                 INNER JOIN favorites f ON f.track_id = t.id
                 ORDER BY f.added_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], map_track_row)
            .map_err(|e| e.to_string())?;
        rows.map(|row| row.map(|r| row_to_track(r, true)))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn get_playlists(&self) -> Result<Vec<Playlist>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT p.id, p.name, p.created_at, p.updated_at, p.kind,
                        COUNT(pt.track_id) AS track_count
                 FROM playlists p
                 LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
                 GROUP BY p.id
                 ORDER BY
                   CASE p.kind
                     WHEN 'weekly_top' THEN 1
                     WHEN 'monthly_top' THEN 2
                     WHEN 'quarterly_top' THEN 3
                     WHEN 'yearly_top' THEN 4
                     ELSE 10
                   END,
                   p.updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Playlist {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    kind: PlaylistKind::from_db_str(row.get::<_, String>(4)?.as_str()),
                    track_count: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn get_playlist_tracks(&self, playlist_id: &str) -> Result<Vec<Track>, String> {
        // Smart playlists are evaluated live from their rules, not stored rows.
        let playlist = self.get_playlist_by_id(playlist_id)?;
        if matches!(playlist.kind, PlaylistKind::Smart) {
            if let Some(config) = self.get_smart_playlist_config(playlist_id)? {
                return self.evaluate_smart_playlist(&config);
            }
            return Ok(Vec::new());
        }

        let mut stmt = self
            .conn
            .prepare(
                "SELECT t.id, t.id, t.absolute_path, t.extension, t.file_size, t.modified_ms,
                        t.title, t.artist, t.album, t.genre, t.year, t.duration_secs,
                        t.has_lrc, t.lrc_path, t.embedded_lyrics
                 FROM tracks t
                 INNER JOIN playlist_tracks pt ON pt.track_id = t.id
                 WHERE pt.playlist_id = ?1
                 ORDER BY pt.position ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![playlist_id], map_track_row)
            .map_err(|e| e.to_string())?;
        let mut tracks = Vec::new();
        for row in rows {
            let track_row = row.map_err(|e| e.to_string())?;
            let is_favorite = self.is_favorite(&track_row.id)?;
            tracks.push(row_to_track(track_row, is_favorite));
        }
        Ok(tracks)
    }

    /// Saved configuration for a smart playlist, or `None` if it is not smart.
    pub fn get_smart_playlist_config(
        &self,
        playlist_id: &str,
    ) -> Result<Option<SmartPlaylistConfig>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT config FROM smart_playlist_rules WHERE playlist_id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query(params![playlist_id])
            .map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let json: String = row.get(0).map_err(|e| e.to_string())?;
            let config = serde_json::from_str(&json)
                .map_err(|e| format!("Failed to parse smart playlist rules: {e}"))?;
            Ok(Some(config))
        } else {
            Ok(None)
        }
    }

    pub fn create_smart_playlist(
        &self,
        name: &str,
        config: &SmartPlaylistConfig,
    ) -> Result<Playlist, String> {
        let id = Uuid::new_v4().to_string();
        let now = now_ms();
        let json = serde_json::to_string(config).map_err(|e| e.to_string())?;
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO playlists (id, name, created_at, updated_at, kind) VALUES (?1, ?2, ?3, ?4, 'smart')",
            params![id, name, now, now],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO smart_playlist_rules (playlist_id, config) VALUES (?1, ?2)",
            params![id, json],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(Playlist {
            id,
            name: name.to_string(),
            created_at: now,
            updated_at: now,
            track_count: 0,
            kind: PlaylistKind::Smart,
        })
    }

    pub fn update_smart_playlist(
        &self,
        id: &str,
        name: Option<&str>,
        config: Option<&SmartPlaylistConfig>,
    ) -> Result<Playlist, String> {
        self.ensure_user_playlist(id)?;
        let now = now_ms();
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        if let Some(name) = name {
            tx.execute(
                "UPDATE playlists SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![name, now, id],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(config) = config {
            let json = serde_json::to_string(config).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO smart_playlist_rules (playlist_id, config) VALUES (?1, ?2)
                 ON CONFLICT(playlist_id) DO UPDATE SET config = excluded.config",
                params![id, json],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        self.get_playlist_by_id(id)
    }

    /// Evaluate a smart playlist config into a live track list. Rules that
    /// fail to parse (bad value for the field/op) are skipped so one bad rule
    /// never blanks the whole playlist.
    pub fn evaluate_smart_playlist(
        &self,
        config: &SmartPlaylistConfig,
    ) -> Result<Vec<Track>, String> {
        let mut sql = String::from(
            "SELECT t.id, t.id, t.absolute_path, t.extension, t.file_size, t.modified_ms,
                    t.title, t.artist, t.album, t.genre, t.year, t.duration_secs,
                    t.has_lrc, t.lrc_path, t.embedded_lyrics,
                    CASE WHEN f.track_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
             FROM tracks t
             LEFT JOIN favorites f ON f.track_id = t.id
             LEFT JOIN listening_stats s ON s.track_id = t.id
             WHERE 1=1",
        );
        let mut bind: Vec<rusqlite::types::Value> = Vec::new();

        for rule in &config.rules {
            match smart_rule_fragment(rule) {
                Some((fragment, value)) => {
                    sql.push_str(" AND ");
                    sql.push_str(&fragment);
                    if let Some(v) = value {
                        bind.push(v);
                    }
                }
                None => {
                    eprintln!(
                        "[brook] skipping invalid smart playlist rule: {:?} {:?} {:?}",
                        rule.field, rule.op, rule.value
                    );
                }
            }
        }

        let order_by = smart_order_by(config.sort_by.as_deref(), config.sort_order.as_deref());
        sql.push_str(&format!(" ORDER BY {order_by}"));

        if let Some(limit) = config.limit {
            let limit = limit.max(0) as i64;
            sql.push_str(" LIMIT ?");
            bind.push(limit.into());
        }

        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let param_refs: Vec<&dyn rusqlite::ToSql> =
            bind.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        let rows = stmt
            .query(param_refs.as_slice())
            .map_err(|e| e.to_string())?;
        let mut tracks = Vec::new();
        let mut rows = rows;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let track_row = map_track_row(&row).map_err(|e| e.to_string())?;
            let is_favorite: i32 = row.get(15).map_err(|e| e.to_string())?;
            tracks.push(row_to_track(track_row, is_favorite != 0));
        }
        Ok(tracks)
    }

    pub fn create_playlist(&self, name: &str) -> Result<Playlist, String> {
        let id = Uuid::new_v4().to_string();
        let now = now_ms();
        self.conn
            .execute(
                "INSERT INTO playlists (id, name, created_at, updated_at, kind) VALUES (?1, ?2, ?3, ?4, 'user')",
                params![id, name, now, now],
            )
            .map_err(|e| e.to_string())?;
        Ok(Playlist {
            id,
            name: name.to_string(),
            created_at: now,
            updated_at: now,
            track_count: 0,
            kind: PlaylistKind::User,
        })
    }

    fn get_playlist_by_id(&self, id: &str) -> Result<Playlist, String> {
        self.conn
            .query_row(
                "SELECT p.id, p.name, p.created_at, p.updated_at, p.kind,
                        COUNT(pt.track_id) AS track_count
                 FROM playlists p
                 LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
                 WHERE p.id = ?1
                 GROUP BY p.id",
                params![id],
                |row| {
                    Ok(Playlist {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        created_at: row.get(2)?,
                        updated_at: row.get(3)?,
                        kind: PlaylistKind::from_db_str(row.get::<_, String>(4)?.as_str()),
                        track_count: row.get(5)?,
                    })
                },
            )
            .map_err(|e| format!("Playlist not found: {id} ({e})"))
    }

    pub fn update_playlist(&self, id: &str, name: Option<&str>) -> Result<Playlist, String> {
        self.ensure_user_playlist(id)?;
        if let Some(name) = name {
            let now = now_ms();
            let updated = self
                .conn
                .execute(
                    "UPDATE playlists SET name = ?1, updated_at = ?2 WHERE id = ?3",
                    params![name, now, id],
                )
                .map_err(|e| e.to_string())?;
            if updated == 0 {
                return Err(format!("Playlist not found: {id}"));
            }
        }
        self.get_playlist_by_id(id)
    }

    fn ensure_user_playlist(&self, id: &str) -> Result<(), String> {
        if charts::is_chart_playlist_id(id) {
            return Err("Chart playlists are updated automatically".into());
        }
        Ok(())
    }

    /// Playlists that can hold manually added tracks: user playlists only.
    /// Chart playlists update automatically; smart playlists are rule-based.
    fn ensure_manual_track_playlist(&self, id: &str) -> Result<(), String> {
        let playlist = self.get_playlist_by_id(id)?;
        if playlist.kind.is_chart() {
            return Err("Chart playlists are updated automatically".into());
        }
        if matches!(playlist.kind, PlaylistKind::Smart) {
            return Err("Smart playlists are rule-based; edit the rules instead".into());
        }
        Ok(())
    }

    pub fn add_to_playlist(&self, playlist_id: &str, track_id: &str) -> Result<(), String> {
        self.ensure_manual_track_playlist(playlist_id)?;
        self.get_playlist_by_id(playlist_id)?;
        self.get_track_row(track_id)?;

        let position: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        self.conn
            .execute(
                "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position)
                 VALUES (?1, ?2, ?3)",
                params![playlist_id, track_id, position],
            )
            .map_err(|e| e.to_string())?;

        self.conn
            .execute(
                "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
                params![now_ms(), playlist_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_playlist(&self, id: &str) -> Result<(), String> {
        self.ensure_user_playlist(id)?;
        let deleted = self
            .conn
            .execute("DELETE FROM playlists WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if deleted == 0 {
            return Err(format!("Playlist not found: {id}"));
        }
        Ok(())
    }

    pub fn remove_from_playlist(&self, playlist_id: &str, track_id: &str) -> Result<(), String> {
        self.ensure_manual_track_playlist(playlist_id)?;
        let deleted = self
            .conn
            .execute(
                "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
                params![playlist_id, track_id],
            )
            .map_err(|e| e.to_string())?;
        if deleted == 0 {
            return Err(format!("Track not in playlist: {track_id}"));
        }
        self.conn
            .execute(
                "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
                params![now_ms(), playlist_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Drop scanned library data when the music root changes (stats/history too).
    pub fn reset_library_tracks(&mut self) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM play_history", [])
            .map_err(|e| e.to_string())?;
        self.conn
            .execute("DELETE FROM listening_stats", [])
            .map_err(|e| e.to_string())?;
        self.conn
            .execute("DELETE FROM tracks", [])
            .map_err(|e| e.to_string())?;
        for id in [
            charts::ID_WEEKLY_TOP,
            charts::ID_MONTHLY_TOP,
            charts::ID_QUARTERLY_TOP,
            charts::ID_YEARLY_TOP,
        ] {
            self.conn
                .execute(
                    "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
                    params![id],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

fn map_track_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TrackRow> {
    Ok(TrackRow {
        id: row.get(0)?,
        relative_path: row.get(1)?,
        absolute_path: row.get(2)?,
        extension: row.get(3)?,
        file_size: row.get::<_, i64>(4)? as u64,
        modified_ms: row.get::<_, i64>(5)? as i128,
        title: row.get::<_, Option<String>>(6)?,
        artist: row.get::<_, Option<String>>(7)?,
        album: row.get::<_, Option<String>>(8)?,
        genre: row.get::<_, Option<String>>(9)?,
        year: row.get::<_, Option<i32>>(10)?,
        duration_secs: row.get::<_, Option<f64>>(11)?,
        has_lrc: row.get::<_, i32>(12)? != 0,
        lrc_path: row.get::<_, Option<String>>(13)?,
        embedded_lyrics: row.get::<_, Option<String>>(14)?,
        replay_gain_track_db: None,
        replay_gain_track_peak: None,
    })
}

/// Mapper for SELECTs that include the ReplayGain columns (indices 15,16).
/// Used by `get_track_row`, which feeds the audio engine.
fn map_track_row_full(row: &rusqlite::Row<'_>) -> rusqlite::Result<TrackRow> {
    let mut track_row = map_track_row(row)?;
    track_row.replay_gain_track_db = row.get::<_, Option<f64>>(15)?;
    track_row.replay_gain_track_peak = row.get::<_, Option<f64>>(16)?;
    Ok(track_row)
}

fn row_to_track(row: TrackRow, is_favorite: bool) -> Track {
    Track {
        id: row.id.clone(),
        relative_path: row.relative_path,
        absolute_path: row.absolute_path,
        extension: row.extension,
        file_size: row.file_size,
        modified_ms: row.modified_ms as u128,
        title: row.title,
        artist: row.artist,
        album: row.album,
        year: row.year,
        duration_secs: row.duration_secs,
        has_lrc: row.has_lrc,
        is_favorite,
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Build the WHERE fragment and bind value for one smart playlist rule.
/// Returns `None` for an unsupported field/op or a value that does not parse
/// for the field's type, so the caller can skip it without failing the whole
/// query.
fn smart_rule_fragment(
    rule: &crate::models::SmartPlaylistRule,
) -> Option<(String, Option<rusqlite::types::Value>)> {
    use rusqlite::types::Value;

    let field = rule.field.to_ascii_lowercase();
    let op = rule.op.to_ascii_lowercase();
    let raw = rule.value.trim();

    let text_col = match field.as_str() {
        "title" => "t.title",
        "artist" => "t.artist",
        "album" => "t.album",
        "genre" => "t.genre",
        _ => "",
    };
    if !text_col.is_empty() {
        let fragment = match op.as_str() {
            "is" | "equals" => format!("{text_col} = ?"),
            "contains" => format!("{text_col} LIKE ?"),
            "startswith" | "starts_with" => format!("{text_col} LIKE ?"),
            "endswith" | "ends_with" => format!("{text_col} LIKE ?"),
            _ => return None,
        };
        let pattern = match op.as_str() {
            "contains" => format!("%{raw}%"),
            "startswith" | "starts_with" => format!("{raw}%"),
            "endswith" | "ends_with" => format!("%{raw}"),
            _ => raw.to_string(),
        };
        return Some((fragment, Some(Value::Text(pattern))));
    }

    match field.as_str() {
        "year" => {
            let v: i64 = raw.parse().ok()?;
            let frag = match op.as_str() {
                "is" | "equals" | "eq" => "t.year = ?",
                "gt" => "t.year > ?",
                "lt" => "t.year < ?",
                "gte" => "t.year >= ?",
                "lte" => "t.year <= ?",
                _ => return None,
            };
            Some((frag.to_string(), Some(Value::Integer(v))))
        }
        "duration" => {
            let v: f64 = raw.parse().ok()?;
            let frag = match op.as_str() {
                "is" | "equals" | "eq" => "t.duration_secs = ?",
                "gt" => "t.duration_secs > ?",
                "lt" => "t.duration_secs < ?",
                "gte" => "t.duration_secs >= ?",
                "lte" => "t.duration_secs <= ?",
                _ => return None,
            };
            Some((frag.to_string(), Some(Value::Real(v))))
        }
        "playcount" | "play_count" => {
            let v: i64 = raw.parse().ok()?;
            let frag = match op.as_str() {
                "is" | "equals" | "eq" => "COALESCE(s.play_count, 0) = ?",
                "gt" => "COALESCE(s.play_count, 0) > ?",
                "lt" => "COALESCE(s.play_count, 0) < ?",
                "gte" => "COALESCE(s.play_count, 0) >= ?",
                "lte" => "COALESCE(s.play_count, 0) <= ?",
                _ => return None,
            };
            Some((frag.to_string(), Some(Value::Integer(v))))
        }
        "liked" => match op.as_str() {
            "is" | "equals" => match raw.to_ascii_lowercase().as_str() {
                "true" | "1" | "yes" => Some(("f.track_id IS NOT NULL".to_string(), None)),
                "false" | "0" | "no" => Some(("f.track_id IS NULL".to_string(), None)),
                _ => None,
            },
            _ => None,
        },
        "haslyrics" | "has_lyrics" => {
            let has = "(t.has_lrc = 1 OR t.embedded_lyrics IS NOT NULL)";
            match op.as_str() {
                "is" | "equals" => match raw.to_ascii_lowercase().as_str() {
                    "true" | "1" | "yes" => Some((has.to_string(), None)),
                    "false" | "0" | "no" => Some((format!("NOT ({has})"), None)),
                    _ => None,
                },
                _ => None,
            }
        }
        "lastplayed" | "last_played" => match op.as_str() {
            "withindays" | "within_days" => {
                let days: i64 = raw.parse().ok()?;
                let cutoff = now_ms() - days * 86_400_000;
                Some((
                    "s.last_played_at IS NOT NULL AND s.last_played_at >= ?".to_string(),
                    Some(Value::Integer(cutoff)),
                ))
            }
            "never" => Some(("s.last_played_at IS NULL".to_string(), None)),
            _ => None,
        },
        _ => None,
    }
}

fn smart_order_by(sort_by: Option<&str>, sort_order: Option<&str>) -> String {
    let sort_dir = if sort_order
        .map(|s| s.eq_ignore_ascii_case("desc"))
        .unwrap_or(false)
    {
        "DESC"
    } else {
        "ASC"
    };
    let col = match sort_by.map(|s| s.to_ascii_lowercase()).as_deref() {
        Some("artist") => "t.artist COLLATE NOCASE",
        Some("album") => "t.album COLLATE NOCASE",
        Some("genre") => "t.genre COLLATE NOCASE",
        Some("year") => "t.year",
        Some("duration") => "t.duration_secs",
        Some("playcount") | Some("play_count") => "COALESCE(s.play_count, 0)",
        Some("lastplayed") | Some("last_played") => "s.last_played_at",
        Some("dateadded") | Some("date_added") => "t.scanned_at",
        _ => "t.title COLLATE NOCASE",
    };
    format!("{col} {sort_dir}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scanner::ScannedFile;

    #[test]
    fn upsert_and_query_track() {
        let dir = std::env::temp_dir().join(format!("brook-db-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        let mut db = Database::open(&db_path).unwrap();

        let file = ScannedFile {
            id: "song.flac".into(),
            relative_path: "song.flac".into(),
            absolute_path: "/music/song.flac".into(),
            extension: "flac".into(),
            file_size: 1234,
            modified_ms: 1,
            has_lrc: false,
            lrc_path: None,
        };
        let meta = TrackMetadata {
            title: Some("Song".into()),
            artist: Some("Artist".into()),
            album: Some("Album".into()),
            genre: None,
            year: Some(2024),
            duration_secs: Some(180.0),
            embedded_lyrics: None,
            replay_gain_track_db: None,
            replay_gain_track_peak: None,
        };

        db.upsert_track(&file, &meta).unwrap();
        let track = db.get_track("song.flac").unwrap();
        assert_eq!(track.title.as_deref(), Some("Song"));
        assert!(!track.is_favorite);

        assert!(db.toggle_favorite("song.flac").unwrap());
        let track = db.get_track("song.flac").unwrap();
        assert!(track.is_favorite);
    }

    #[test]
    fn get_tracks_sort_by_title_uses_collate_before_direction() {
        use crate::models::TrackFilter;

        let dir = std::env::temp_dir().join(format!("brook-db-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut db = Database::open(&dir.join("test.db")).unwrap();

        let file = ScannedFile {
            id: "z.flac".into(),
            relative_path: "z.flac".into(),
            absolute_path: "/music/z.flac".into(),
            extension: "flac".into(),
            file_size: 1,
            modified_ms: 1,
            has_lrc: false,
            lrc_path: None,
        };
        db.upsert_track(
            &file,
            &TrackMetadata {
                title: Some("Zebra".into()),
                artist: None,
                album: None,
                genre: None,
                year: None,
                duration_secs: None,
                embedded_lyrics: None,
                replay_gain_track_db: None,
                replay_gain_track_peak: None,
            },
        )
        .unwrap();

        let filter = TrackFilter {
            sort_by: Some("title".into()),
            sort_order: Some("asc".into()),
            ..Default::default()
        };
        assert!(db.get_tracks(Some(&filter)).is_ok());
    }

    #[test]
    fn get_tracks_sort_by_year_does_not_use_collate() {
        use crate::models::TrackFilter;

        let dir = std::env::temp_dir().join(format!("brook-db-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        let mut db = Database::open(&db_path).unwrap();

        for (id, year) in [("a.flac", 2020), ("b.flac", 2024)] {
            let file = ScannedFile {
                id: id.into(),
                relative_path: id.into(),
                absolute_path: format!("/music/{id}"),
                extension: "flac".into(),
                file_size: 1,
                modified_ms: 1,
                has_lrc: false,
                lrc_path: None,
            };
            let meta = TrackMetadata {
                title: Some(id.into()),
                artist: None,
                album: None,
                genre: None,
                year: Some(year),
                duration_secs: None,
                embedded_lyrics: None,
                replay_gain_track_db: None,
                replay_gain_track_peak: None,
            };
            db.upsert_track(&file, &meta).unwrap();
        }

        let filter = TrackFilter {
            sort_by: Some("year".into()),
            sort_order: Some("desc".into()),
            ..Default::default()
        };
        let tracks = db.get_tracks(Some(&filter)).unwrap();
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].year, Some(2024));
    }

    #[test]
    fn smart_playlist_evaluates_rules_and_sort() {
        use crate::models::{SmartPlaylistConfig, SmartPlaylistRule};

        let dir = std::env::temp_dir().join(format!("brook-db-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        let mut db = Database::open(&db_path).unwrap();

        let metas = [
            ("rock1.flac", "Rock", 2020, 200.0),
            ("rock2.flac", "Rock", 2024, 180.0),
            ("jazz.flac", "Jazz", 1990, 240.0),
        ];
        for (id, genre, year, dur) in metas {
            let file = ScannedFile {
                id: id.into(),
                relative_path: id.into(),
                absolute_path: format!("/music/{id}"),
                extension: "flac".into(),
                file_size: 1,
                modified_ms: 1,
                has_lrc: false,
                lrc_path: None,
            };
            let meta = TrackMetadata {
                title: Some(id.into()),
                artist: None,
                album: None,
                genre: Some(genre.into()),
                year: Some(year),
                duration_secs: Some(dur),
                embedded_lyrics: None,
                replay_gain_track_db: None,
                replay_gain_track_peak: None,
            };
            db.upsert_track(&file, &meta).unwrap();
        }

        // genre = Rock, sorted by year desc, limited to 1.
        let config = SmartPlaylistConfig {
            rules: vec![SmartPlaylistRule {
                field: "genre".into(),
                op: "is".into(),
                value: "Rock".into(),
            }],
            sort_by: Some("year".into()),
            sort_order: Some("desc".into()),
            limit: Some(1),
        };
        let tracks = db.evaluate_smart_playlist(&config).unwrap();
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].id, "rock2.flac");

        // genre contains "azz" → the jazz track only.
        let config = SmartPlaylistConfig {
            rules: vec![SmartPlaylistRule {
                field: "genre".into(),
                op: "contains".into(),
                value: "azz".into(),
            }],
            ..Default::default()
        };
        let tracks = db.evaluate_smart_playlist(&config).unwrap();
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].id, "jazz.flac");

        // An invalid rule is skipped, not fatal: the rest still apply.
        let config = SmartPlaylistConfig {
            rules: vec![
                SmartPlaylistRule {
                    field: "year".into(),
                    op: "gt".into(),
                    value: "not-a-number".into(),
                },
                SmartPlaylistRule {
                    field: "genre".into(),
                    op: "is".into(),
                    value: "Jazz".into(),
                },
            ],
            ..Default::default()
        };
        let tracks = db.evaluate_smart_playlist(&config).unwrap();
        assert_eq!(tracks.len(), 1);
    }
}

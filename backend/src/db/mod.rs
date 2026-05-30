pub mod charts;
pub mod stats;

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::metadata::TrackMetadata;
use crate::models::{Playlist, PlaylistKind, Track, TrackFilter};
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
    pub year: Option<i32>,
    pub duration_secs: Option<f64>,
    pub has_lrc: bool,
    pub lrc_path: Option<String>,
    pub embedded_lyrics: Option<String>,
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
        self.migrate_stats_charts()
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

    pub fn list_track_ids(&self) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM tracks")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn upsert_track(
        &mut self,
        file: &ScannedFile,
        meta: &TrackMetadata,
    ) -> Result<(), String> {
        let scanned_at = now_ms();
        self.conn
            .execute(
                "INSERT INTO tracks (
                    id, absolute_path, extension, file_size, modified_ms,
                    title, artist, album, year, duration_secs,
                    has_lrc, lrc_path, embedded_lyrics, scanned_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                ON CONFLICT(id) DO UPDATE SET
                    absolute_path = excluded.absolute_path,
                    extension = excluded.extension,
                    file_size = excluded.file_size,
                    modified_ms = excluded.modified_ms,
                    title = excluded.title,
                    artist = excluded.artist,
                    album = excluded.album,
                    year = excluded.year,
                    duration_secs = excluded.duration_secs,
                    has_lrc = excluded.has_lrc,
                    lrc_path = excluded.lrc_path,
                    embedded_lyrics = excluded.embedded_lyrics,
                    scanned_at = excluded.scanned_at",
                params![
                    file.id,
                    file.absolute_path,
                    file.extension,
                    file.file_size as i64,
                    file.modified_ms as i64,
                    meta.title,
                    meta.artist,
                    meta.album,
                    meta.year,
                    meta.duration_secs,
                    i32::from(file.has_lrc),
                    file.lrc_path,
                    meta.embedded_lyrics,
                    scanned_at,
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
                        title, artist, album, year, duration_secs,
                        has_lrc, lrc_path, embedded_lyrics
                 FROM tracks WHERE id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let row = stmt
            .query_row(params![id], map_track_row)
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
                    t.title, t.artist, t.album, t.year, t.duration_secs,
                    t.has_lrc, t.lrc_path, t.embedded_lyrics,
                    CASE WHEN f.track_id IS NOT NULL THEN 1 ELSE 0 END AS is_favorite
             FROM tracks t
             LEFT JOIN favorites f ON f.track_id = t.id
             WHERE 1=1",
        );

        let mut artist = filter.artist.clone();
        let mut album = filter.album.clone();
        let mut year = filter.year;

        if artist.is_some() {
            sql.push_str(" AND t.artist = ?");
        }
        if album.is_some() {
            sql.push_str(" AND t.album = ?");
        }
        if year.is_some() {
            sql.push_str(" AND t.year = ?");
        }

        let sort_by = filter.sort_by.as_deref().unwrap_or("title");
        let sort_order = filter.sort_order.as_deref().unwrap_or("asc");
        let sort_dir = if sort_order.eq_ignore_ascii_case("desc") {
            "DESC"
        } else {
            "ASC"
        };
        // COLLATE must precede ASC/DESC: `col COLLATE NOCASE ASC`, not `col ASC COLLATE NOCASE`.
        // NOCASE applies only to text columns (not INTEGER year).
        let order_by = match sort_by {
            "artist" => format!("t.artist COLLATE NOCASE {sort_dir}"),
            "album" => format!("t.album COLLATE NOCASE {sort_dir}"),
            "year" => format!("t.year {sort_dir}"),
            _ => format!("t.title COLLATE NOCASE {sort_dir}"),
        };
        sql.push_str(&format!(" ORDER BY {order_by}"));

        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;

        fn collect_tracks(mut rows: rusqlite::Rows<'_>) -> Result<Vec<Track>, String> {
            let mut tracks = Vec::new();
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let track_row = map_track_row(&row).map_err(|e| e.to_string())?;
                let is_favorite: i32 = row.get(14).map_err(|e| e.to_string())?;
                tracks.push(row_to_track(track_row, is_favorite != 0));
            }
            Ok(tracks)
        }

        match (artist.take(), album.take(), year.take()) {
            (Some(a), Some(al), Some(y)) => {
                let rows = stmt.query(params![a, al, y]).map_err(|e| e.to_string())?;
                collect_tracks(rows)
            }
            (Some(a), Some(al), None) => {
                let rows = stmt.query(params![a, al]).map_err(|e| e.to_string())?;
                collect_tracks(rows)
            }
            (Some(a), None, Some(y)) => {
                let rows = stmt.query(params![a, y]).map_err(|e| e.to_string())?;
                collect_tracks(rows)
            }
            (None, Some(al), Some(y)) => {
                let rows = stmt.query(params![al, y]).map_err(|e| e.to_string())?;
                collect_tracks(rows)
            }
            (Some(a), None, None) => {
                let rows = stmt.query(params![a]).map_err(|e| e.to_string())?;
                collect_tracks(rows)
            }
            (None, Some(al), None) => {
                let rows = stmt.query(params![al]).map_err(|e| e.to_string())?;
                collect_tracks(rows)
            }
            (None, None, Some(y)) => {
                let rows = stmt.query(params![y]).map_err(|e| e.to_string())?;
                collect_tracks(rows)
            }
            (None, None, None) => {
                let rows = stmt.query([]).map_err(|e| e.to_string())?;
                collect_tracks(rows)
            }
        }
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
                        t.title, t.artist, t.album, t.year, t.duration_secs,
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
        let mut stmt = self
            .conn
            .prepare(
                "SELECT t.id, t.id, t.absolute_path, t.extension, t.file_size, t.modified_ms,
                        t.title, t.artist, t.album, t.year, t.duration_secs,
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

    fn ensure_user_playlist(&self, id: &str) -> Result<(), String> {
        if charts::is_chart_playlist_id(id) {
            return Err("Chart playlists are updated automatically".into());
        }
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

    pub fn add_to_playlist(&self, playlist_id: &str, track_id: &str) -> Result<(), String> {
        self.ensure_user_playlist(playlist_id)?;
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

    pub fn remove_from_playlist(&self, playlist_id: &str, track_id: &str) -> Result<(), String> {
        self.ensure_user_playlist(playlist_id)?;
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
}

fn map_track_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TrackRow> {
    Ok(TrackRow {
        id: row.get(0)?,
        relative_path: row.get(1)?,
        absolute_path: row.get(2)?,
        extension: row.get(3)?,
        file_size: row.get::<_, i64>(4)? as u64,
        modified_ms: row.get::<_, i64>(5)? as i128,
        title: row.get(6)?,
        artist: row.get(7)?,
        album: row.get(8)?,
        year: row.get(9)?,
        duration_secs: row.get(10)?,
        has_lrc: row.get::<_, i32>(11)? != 0,
        lrc_path: row.get(12)?,
        embedded_lyrics: row.get(13)?,
    })
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
            year: Some(2024),
            duration_secs: Some(180.0),
            embedded_lyrics: None,
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
                year: None,
                duration_secs: None,
                embedded_lyrics: None,
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
                year: Some(year),
                duration_secs: None,
                embedded_lyrics: None,
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
}

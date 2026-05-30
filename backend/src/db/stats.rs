use rusqlite::params;

use super::Database;
use crate::models::{
    RankedAlbum, RankedArtist, RankedTrack, RankedYear, StatsSummary, Track, YearlyWrap,
};

const MIN_LISTEN_SECS: f64 = 15.0;
const FULL_LISTEN_RATIO: f64 = 0.85;

impl Database {
    pub fn record_play(
        &mut self,
        track_id: &str,
        duration_listened: f64,
        track_duration: f64,
    ) -> Result<(), String> {
        if duration_listened < MIN_LISTEN_SECS {
            return Ok(());
        }
        self.get_track_row(track_id)?;

        let played_at = super::now_ms();
        let completed = i32::from(is_full_listen(duration_listened, track_duration));
        let listened = duration_listened.min(track_duration.max(0.0));

        self.conn
            .execute(
                "INSERT INTO play_history (track_id, played_at, duration_listened, completed)
                 VALUES (?1, ?2, ?3, ?4)",
                params![track_id, played_at, listened, completed],
            )
            .map_err(|e| e.to_string())?;

        self.conn
            .execute(
                "INSERT INTO listening_stats (track_id, play_count, total_secs, full_listens, last_played_at)
                 VALUES (?1, 1, ?2, ?3, ?4)
                 ON CONFLICT(track_id) DO UPDATE SET
                    play_count = play_count + 1,
                    total_secs = total_secs + excluded.total_secs,
                    full_listens = full_listens + excluded.full_listens,
                    last_played_at = excluded.last_played_at",
                params![track_id, listened, completed, played_at],
            )
            .map_err(|e| e.to_string())?;

        let _ = self.refresh_chart_playlists_if_due();
        Ok(())
    }

    pub fn top_track_ids_between(
        &self,
        start_ms: i64,
        end_ms: i64,
        limit: usize,
    ) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT ph.track_id
                 FROM play_history ph
                 INNER JOIN tracks t ON t.id = ph.track_id
                 WHERE ph.played_at >= ?1 AND ph.played_at < ?2
                 GROUP BY ph.track_id
                 ORDER BY COUNT(*) DESC, SUM(ph.duration_listened) DESC
                 LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![start_ms, end_ms, limit as i64], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn get_stats_summary(&self) -> Result<StatsSummary, String> {
        let totals = self.query_totals(None, None)?;
        let top_tracks = self.query_top_tracks(None, None, 20)?;
        let top_artist = self.query_top_artist(None, None)?;
        let top_album = self.query_top_album(None, None)?;
        let top_year = self.query_top_year(None, None)?;

        Ok(StatsSummary {
            total_plays: totals.0,
            total_listen_secs: totals.1,
            unique_tracks: totals.2,
            full_listens: totals.3,
            top_tracks,
            top_artist,
            top_album,
            top_year,
        })
    }

    pub fn get_yearly_wrap(&self, year: i32) -> Result<YearlyWrap, String> {
        let start = year_start_ms(year);
        let end = year_start_ms(year + 1);
        let totals = self.query_totals(Some(start), Some(end))?;
        let top_tracks = self.query_top_tracks(Some(start), Some(end), 25)?;
        let top_artists = self.query_top_artists(Some(start), Some(end), 10)?;
        let top_albums = self.query_top_albums(Some(start), Some(end), 10)?;

        Ok(YearlyWrap {
            year,
            total_plays: totals.0,
            total_listen_secs: totals.1,
            unique_tracks: totals.2,
            full_listens: totals.3,
            top_tracks,
            top_artists,
            top_albums,
        })
    }

    pub fn get_recent_tracks(&self, limit: usize) -> Result<Vec<Track>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT t.id, t.id, t.absolute_path, t.extension, t.file_size, t.modified_ms,
                        t.title, t.artist, t.album, t.year, t.duration_secs,
                        t.has_lrc, t.lrc_path, t.embedded_lyrics
                 FROM play_history ph
                 INNER JOIN tracks t ON t.id = ph.track_id
                 ORDER BY ph.played_at DESC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;

        let mut seen = std::collections::HashSet::new();
        let rows = stmt
            .query_map(params![(limit * 3) as i64], super::map_track_row)
            .map_err(|e| e.to_string())?;

        let mut tracks = Vec::new();
        for row in rows {
            let track_row = row.map_err(|e| e.to_string())?;
            if !seen.insert(track_row.id.clone()) {
                continue;
            }
            let is_favorite = self.is_favorite(&track_row.id)?;
            tracks.push(super::row_to_track(track_row, is_favorite));
            if tracks.len() >= limit {
                break;
            }
        }
        Ok(tracks)
    }

    pub fn clear_play_history(&mut self) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM play_history", [])
            .map_err(|e| e.to_string())?;
        self.conn
            .execute("DELETE FROM listening_stats", [])
            .map_err(|e| e.to_string())?;
        for id in [
            super::charts::ID_WEEKLY_TOP,
            super::charts::ID_MONTHLY_TOP,
            super::charts::ID_QUARTERLY_TOP,
            super::charts::ID_YEARLY_TOP,
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

    fn query_totals(
        &self,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
    ) -> Result<(u64, f64, u64, u64), String> {
        let (sql, params_vec): (String, Vec<rusqlite::types::Value>) = match (start_ms, end_ms) {
            (Some(start), Some(end)) => (
                "SELECT COUNT(*), COALESCE(SUM(duration_listened), 0),
                        COUNT(DISTINCT track_id), COALESCE(SUM(completed), 0)
                 FROM play_history WHERE played_at >= ?1 AND played_at < ?2".into(),
                vec![start.into(), end.into()],
            ),
            _ => (
                "SELECT COUNT(*), COALESCE(SUM(duration_listened), 0),
                        COUNT(DISTINCT track_id), COALESCE(SUM(completed), 0)
                 FROM play_history".into(),
                vec![],
            ),
        };
        self.conn
            .query_row(&sql, rusqlite::params_from_iter(params_vec), |row| {
                Ok((
                    row.get::<_, i64>(0)? as u64,
                    row.get::<_, f64>(1)?,
                    row.get::<_, i64>(2)? as u64,
                    row.get::<_, i64>(3)? as u64,
                ))
            })
            .map_err(|e| e.to_string())
    }

    fn query_top_tracks(
        &self,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
        limit: usize,
    ) -> Result<Vec<RankedTrack>, String> {
        let (sql, start, end) = ranked_tracks_sql(start_ms, end_ms);
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mut rows = if let (Some(s), Some(e)) = (start, end) {
            stmt.query(params![s, e, limit as i64])
        } else {
            stmt.query(params![limit as i64])
        }
        .map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let play_count = row.get::<_, i64>(1).map_err(|e| e.to_string())? as u64;
            let total_secs = row.get::<_, f64>(2).map_err(|e| e.to_string())?;
            let track_row = super::TrackRow {
                id: row.get(3).map_err(|e| e.to_string())?,
                relative_path: row.get(4).map_err(|e| e.to_string())?,
                absolute_path: row.get(5).map_err(|e| e.to_string())?,
                extension: row.get(6).map_err(|e| e.to_string())?,
                file_size: row.get::<_, i64>(7).map_err(|e| e.to_string())? as u64,
                modified_ms: row.get::<_, i64>(8).map_err(|e| e.to_string())? as i128,
                title: row.get(9).map_err(|e| e.to_string())?,
                artist: row.get(10).map_err(|e| e.to_string())?,
                album: row.get(11).map_err(|e| e.to_string())?,
                year: row.get(12).map_err(|e| e.to_string())?,
                duration_secs: row.get(13).map_err(|e| e.to_string())?,
                has_lrc: row.get::<_, i32>(14).map_err(|e| e.to_string())? != 0,
                lrc_path: row.get(15).map_err(|e| e.to_string())?,
                embedded_lyrics: row.get(16).map_err(|e| e.to_string())?,
            };
            let is_favorite = self.is_favorite(&track_row.id)?;
            out.push(RankedTrack {
                track: super::row_to_track(track_row, is_favorite),
                play_count,
                total_secs,
            });
        }
        Ok(out)
    }

    fn query_top_artist(
        &self,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
    ) -> Result<Option<RankedArtist>, String> {
        Ok(self
            .query_top_artists(start_ms, end_ms, 1)?
            .into_iter()
            .next())
    }

    fn query_top_artists(
        &self,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
        limit: usize,
    ) -> Result<Vec<RankedArtist>, String> {
        let sql = if start_ms.is_some() {
            "SELECT COALESCE(t.artist, 'Unknown Artist') AS name,
                    COUNT(*) AS play_count,
                    COALESCE(SUM(ph.duration_listened), 0) AS total_secs
             FROM play_history ph
             INNER JOIN tracks t ON t.id = ph.track_id
             WHERE ph.played_at >= ?1 AND ph.played_at < ?2
             GROUP BY name
             ORDER BY play_count DESC, total_secs DESC
             LIMIT ?3"
        } else {
            "SELECT COALESCE(t.artist, 'Unknown Artist') AS name,
                    COUNT(*) AS play_count,
                    COALESCE(SUM(ph.duration_listened), 0) AS total_secs
             FROM play_history ph
             INNER JOIN tracks t ON t.id = ph.track_id
             GROUP BY name
             ORDER BY play_count DESC, total_secs DESC
             LIMIT ?1"
        };
        let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = if let (Some(s), Some(e)) = (start_ms, end_ms) {
            stmt.query_map(params![s, e, limit as i64], map_ranked_artist)
        } else {
            stmt.query_map(params![limit as i64], map_ranked_artist)
        }
        .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn query_top_album(
        &self,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
    ) -> Result<Option<RankedAlbum>, String> {
        Ok(self
            .query_top_albums(start_ms, end_ms, 1)?
            .into_iter()
            .next())
    }

    fn query_top_albums(
        &self,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
        limit: usize,
    ) -> Result<Vec<RankedAlbum>, String> {
        let sql = if start_ms.is_some() {
            "SELECT COALESCE(t.album, 'Unknown Album') AS name,
                    COUNT(*) AS play_count,
                    COALESCE(SUM(ph.duration_listened), 0) AS total_secs
             FROM play_history ph
             INNER JOIN tracks t ON t.id = ph.track_id
             WHERE ph.played_at >= ?1 AND ph.played_at < ?2
             GROUP BY name
             ORDER BY play_count DESC, total_secs DESC
             LIMIT ?3"
        } else {
            "SELECT COALESCE(t.album, 'Unknown Album') AS name,
                    COUNT(*) AS play_count,
                    COALESCE(SUM(ph.duration_listened), 0) AS total_secs
             FROM play_history ph
             INNER JOIN tracks t ON t.id = ph.track_id
             GROUP BY name
             ORDER BY play_count DESC, total_secs DESC
             LIMIT ?1"
        };
        let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = if let (Some(s), Some(e)) = (start_ms, end_ms) {
            stmt.query_map(params![s, e, limit as i64], map_ranked_album)
        } else {
            stmt.query_map(params![limit as i64], map_ranked_album)
        }
        .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn query_top_year(
        &self,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
    ) -> Result<Option<RankedYear>, String> {
        let sql = if start_ms.is_some() {
            "SELECT t.year AS release_year,
                    COUNT(*) AS play_count,
                    COALESCE(SUM(ph.duration_listened), 0) AS total_secs
             FROM play_history ph
             INNER JOIN tracks t ON t.id = ph.track_id
             WHERE ph.played_at >= ?1 AND ph.played_at < ?2 AND t.year IS NOT NULL
             GROUP BY t.year
             ORDER BY play_count DESC, total_secs DESC
             LIMIT 1"
        } else {
            "SELECT t.year AS release_year,
                    COUNT(*) AS play_count,
                    COALESCE(SUM(ph.duration_listened), 0) AS total_secs
             FROM play_history ph
             INNER JOIN tracks t ON t.id = ph.track_id
             WHERE t.year IS NOT NULL
             GROUP BY t.year
             ORDER BY play_count DESC, total_secs DESC
             LIMIT 1"
        };
        let mut stmt = self.conn.prepare(sql).map_err(|e| e.to_string())?;
        let result = if let (Some(s), Some(e)) = (start_ms, end_ms) {
            stmt.query_row(params![s, e], |row| {
                Ok(RankedYear {
                    year: row.get(0)?,
                    play_count: row.get::<_, i64>(1)? as u64,
                    total_secs: row.get(2)?,
                })
            })
        } else {
            stmt.query_row([], |row| {
                Ok(RankedYear {
                    year: row.get(0)?,
                    play_count: row.get::<_, i64>(1)? as u64,
                    total_secs: row.get(2)?,
                })
            })
        };
        match result {
            Ok(row) => Ok(Some(row)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
}

fn map_ranked_artist(row: &rusqlite::Row<'_>) -> rusqlite::Result<RankedArtist> {
    Ok(RankedArtist {
        name: row.get(0)?,
        play_count: row.get::<_, i64>(1)? as u64,
        total_secs: row.get(2)?,
    })
}

fn map_ranked_album(row: &rusqlite::Row<'_>) -> rusqlite::Result<RankedAlbum> {
    Ok(RankedAlbum {
        name: row.get(0)?,
        play_count: row.get::<_, i64>(1)? as u64,
        total_secs: row.get(2)?,
    })
}

fn is_full_listen(listened: f64, duration: f64) -> bool {
    if duration <= 0.0 {
        return listened >= MIN_LISTEN_SECS;
    }
    listened >= duration * FULL_LISTEN_RATIO || listened >= duration - 3.0
}

fn year_start_ms(year: i32) -> i64 {
    use chrono::{Local, NaiveDate, TimeZone};
    let start = NaiveDate::from_ymd_opt(year, 1, 1).unwrap();
    Local
        .from_local_datetime(&start.and_hms_opt(0, 0, 0).unwrap())
        .unwrap()
        .timestamp_millis()
}

fn ranked_tracks_sql(start_ms: Option<i64>, end_ms: Option<i64>) -> (String, Option<i64>, Option<i64>) {
    if start_ms.is_some() {
        (
            "SELECT ls.track_id, ls.play_count, ls.total_secs,
                    t.id, t.id, t.absolute_path, t.extension, t.file_size, t.modified_ms,
                    t.title, t.artist, t.album, t.year, t.duration_secs,
                    t.has_lrc, t.lrc_path, t.embedded_lyrics
             FROM (
                 SELECT ph.track_id,
                        COUNT(*) AS play_count,
                        COALESCE(SUM(ph.duration_listened), 0) AS total_secs
                 FROM play_history ph
                 WHERE ph.played_at >= ?1 AND ph.played_at < ?2
                 GROUP BY ph.track_id
                 ORDER BY play_count DESC, total_secs DESC
                 LIMIT ?3
             ) ls
             INNER JOIN tracks t ON t.id = ls.track_id
             ORDER BY ls.play_count DESC, ls.total_secs DESC"
                .into(),
            start_ms,
            end_ms,
        )
    } else {
        (
            "SELECT ls.track_id, ls.play_count, ls.total_secs,
                    t.id, t.id, t.absolute_path, t.extension, t.file_size, t.modified_ms,
                    t.title, t.artist, t.album, t.year, t.duration_secs,
                    t.has_lrc, t.lrc_path, t.embedded_lyrics
             FROM (
                 SELECT track_id, play_count, total_secs
                 FROM listening_stats
                 ORDER BY play_count DESC, total_secs DESC
                 LIMIT ?1
             ) ls
             INNER JOIN tracks t ON t.id = ls.track_id
             ORDER BY ls.play_count DESC, ls.total_secs DESC"
                .into(),
            None,
            None,
        )
    }
}

use chrono::{Datelike, Local, NaiveDate, TimeZone};
use rusqlite::params;

use super::Database;
use crate::models::PlaylistKind;

pub const CHART_TRACK_LIMIT: usize = 100;
const MS_DAY: i64 = 86_400_000;
const MS_WEEK: i64 = 7 * MS_DAY;
const MS_MONTH: i64 = 30 * MS_DAY;

pub const ID_WEEKLY_TOP: &str = "__brook_weekly_top__";
pub const ID_MONTHLY_TOP: &str = "__brook_monthly_top__";
pub const ID_QUARTERLY_TOP: &str = "__brook_quarterly_top__";
pub const ID_YEARLY_TOP: &str = "__brook_yearly_top__";

const SETTINGS_CHARTS_DAY: &str = "charts_last_refresh_day";
const SETTINGS_CHARTS_QUARTER: &str = "charts_last_refresh_quarter";
const SETTINGS_CHARTS_YEAR: &str = "charts_last_refresh_year";

pub fn is_chart_playlist_id(id: &str) -> bool {
    matches!(
        id,
        ID_WEEKLY_TOP | ID_MONTHLY_TOP | ID_QUARTERLY_TOP | ID_YEARLY_TOP
    )
}

pub fn kind_from_id(id: &str) -> Option<PlaylistKind> {
    match id {
        ID_WEEKLY_TOP => Some(PlaylistKind::WeeklyTop),
        ID_MONTHLY_TOP => Some(PlaylistKind::MonthlyTop),
        ID_QUARTERLY_TOP => Some(PlaylistKind::QuarterlyTop),
        ID_YEARLY_TOP => Some(PlaylistKind::YearlyTop),
        _ => None,
    }
}

impl Database {
    pub fn refresh_chart_playlists_if_due(&mut self) -> Result<(), String> {
        let today = Local::now().date_naive();
        let quarter_key = quarter_key(today);
        let year_key = today.year();

        let last_day = self.get_setting(SETTINGS_CHARTS_DAY)?;
        let last_quarter = self.get_setting(SETTINGS_CHARTS_QUARTER)?;
        let last_year = self
            .get_setting(SETTINGS_CHARTS_YEAR)?
            .and_then(|v| v.parse::<i32>().ok());

        let day_changed = last_day.as_deref() != Some(today.format("%Y-%m-%d").to_string().as_str());
        let quarter_changed = last_quarter.as_deref() != Some(quarter_key.as_str());
        let year_changed = last_year != Some(year_key);

        if !day_changed && !quarter_changed && !year_changed {
            return Ok(());
        }

        let now = super::now_ms();
        let week_start = now - MS_WEEK;
        let month_start = now - MS_MONTH;
        let (q_start, q_end) = quarter_bounds(today);
        let (y_start, y_end) = year_bounds(today.year());

        self.ensure_chart_playlist(
            ID_WEEKLY_TOP,
            "Weekly Top 100",
            PlaylistKind::WeeklyTop,
        )?;
        self.ensure_chart_playlist(
            ID_MONTHLY_TOP,
            "Monthly Top 100",
            PlaylistKind::MonthlyTop,
        )?;
        self.ensure_chart_playlist(
            ID_QUARTERLY_TOP,
            &quarterly_playlist_name(today),
            PlaylistKind::QuarterlyTop,
        )?;
        self.ensure_chart_playlist(
            ID_YEARLY_TOP,
            &format!("{} Top 100", today.year()),
            PlaylistKind::YearlyTop,
        )?;

        self.replace_chart_tracks(ID_WEEKLY_TOP, week_start, now)?;
        self.replace_chart_tracks(ID_MONTHLY_TOP, month_start, now)?;
        self.replace_chart_tracks(ID_QUARTERLY_TOP, q_start, q_end)?;
        self.replace_chart_tracks(ID_YEARLY_TOP, y_start, y_end)?;

        self.set_setting(
            SETTINGS_CHARTS_DAY,
            &today.format("%Y-%m-%d").to_string(),
        )?;
        self.set_setting(SETTINGS_CHARTS_QUARTER, &quarter_key)?;
        self.set_setting(SETTINGS_CHARTS_YEAR, &year_key.to_string())?;
        Ok(())
    }

    fn ensure_chart_playlist(
        &self,
        id: &str,
        name: &str,
        kind: PlaylistKind,
    ) -> Result<(), String> {
        let kind_str = kind.as_db_str();
        let exists: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM playlists WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let now = super::now_ms();
        if exists == 0 {
            self.conn
                .execute(
                    "INSERT INTO playlists (id, name, created_at, updated_at, kind)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![id, name, now, now, kind_str],
                )
                .map_err(|e| e.to_string())?;
        } else {
            self.conn
                .execute(
                    "UPDATE playlists SET name = ?1, updated_at = ?2, kind = ?3 WHERE id = ?4",
                    params![name, now, kind_str, id],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn replace_chart_tracks(
        &mut self,
        playlist_id: &str,
        start_ms: i64,
        end_ms: i64,
    ) -> Result<(), String> {
        let track_ids = self.top_track_ids_between(start_ms, end_ms, CHART_TRACK_LIMIT)?;
        self.conn
            .execute(
                "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id],
            )
            .map_err(|e| e.to_string())?;
        for (position, track_id) in track_ids.iter().enumerate() {
            self.conn
                .execute(
                    "INSERT INTO playlist_tracks (playlist_id, track_id, position)
                     VALUES (?1, ?2, ?3)",
                    params![playlist_id, track_id, position as i64],
                )
                .map_err(|e| e.to_string())?;
        }
        self.conn
            .execute(
                "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
                params![super::now_ms(), playlist_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
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
}

fn quarter_key(date: NaiveDate) -> String {
    let q = (date.month() - 1) / 3 + 1;
    format!("{}-Q{q}", date.year())
}

fn quarterly_playlist_name(date: NaiveDate) -> String {
    let q = (date.month() - 1) / 3 + 1;
    format!("Q{q} {} Top 100", date.year())
}

fn quarter_bounds(date: NaiveDate) -> (i64, i64) {
    let q = (date.month() - 1) / 3;
    let start_month = q * 3 + 1;
    let start = NaiveDate::from_ymd_opt(date.year(), start_month, 1).unwrap();
    let end = if start_month == 10 {
        NaiveDate::from_ymd_opt(date.year() + 1, 1, 1).unwrap()
    } else {
        NaiveDate::from_ymd_opt(date.year(), start_month + 3, 1).unwrap()
    };
    (date_to_ms(start), date_to_ms(end))
}

fn year_bounds(year: i32) -> (i64, i64) {
    let start = NaiveDate::from_ymd_opt(year, 1, 1).unwrap();
    let end = NaiveDate::from_ymd_opt(year + 1, 1, 1).unwrap();
    (date_to_ms(start), date_to_ms(end))
}

fn date_to_ms(date: NaiveDate) -> i64 {
    Local
        .from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
        .unwrap()
        .timestamp_millis()
}

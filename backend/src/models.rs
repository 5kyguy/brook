use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub extension: String,
    pub file_size: u64,
    pub modified_ms: u128,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<i32>,
    pub duration_secs: Option<f64>,
    pub has_lrc: bool,
    pub is_favorite: bool,
}

/// One page of tracks plus the total row count for the same filter, so the
/// list can render a page and a scroll sentinel without re-querying.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TracksPage {
    pub tracks: Vec<Track>,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackFilter {
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<i32>,
    pub query: Option<String>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    /// Page size. When `None`, `get_tracks` returns the whole result set (the
    /// legacy path used by search, entity pages, and anywhere that wants all
    /// rows). When `Some`, the query gets a `LIMIT ? OFFSET ?`.
    pub limit: Option<i64>,
    /// Row offset for paged queries. Ignored when `limit` is `None`.
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoritesChangedPayload {
    pub track_id: String,
    pub liked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistsChangedPayload {
    pub playlist_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFacets {
    pub artists: Vec<String>,
    pub albums: Vec<String>,
    pub years: Vec<i32>,
    pub track_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub track_count: usize,
    pub added: usize,
    pub updated: usize,
    pub skipped: usize,
    pub removed: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub track_count: i64,
    pub kind: PlaylistKind,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlaylistKind {
    User,
    Smart,
    WeeklyTop,
    MonthlyTop,
    QuarterlyTop,
    YearlyTop,
}

impl PlaylistKind {
    pub fn from_db_str(value: &str) -> Self {
        match value {
            "smart" => Self::Smart,
            "weekly_top" => Self::WeeklyTop,
            "monthly_top" => Self::MonthlyTop,
            "quarterly_top" => Self::QuarterlyTop,
            "yearly_top" => Self::YearlyTop,
            _ => Self::User,
        }
    }

    pub fn as_db_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Smart => "smart",
            Self::WeeklyTop => "weekly_top",
            Self::MonthlyTop => "monthly_top",
            Self::QuarterlyTop => "quarterly_top",
            Self::YearlyTop => "yearly_top",
        }
    }

    pub fn is_chart(self) -> bool {
        !matches!(self, Self::User | Self::Smart)
    }
}

/// One rule in a smart playlist. `value` is stored as a string and parsed
/// per `field`/`op` when the playlist is evaluated against SQLite.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartPlaylistRule {
    pub field: String,
    pub op: String,
    pub value: String,
}

/// A smart playlist's saved configuration: the rule set, sort, and optional
/// row limit. Evaluated as a live SQLite query, never a cached track copy.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartPlaylistConfig {
    pub rules: Vec<SmartPlaylistRule>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub limit: Option<i64>,
}

/// Saved playback position so the next launch can resume where the last one
/// left off. `track_id` is `None` when playback is stopped (nothing to resume).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeState {
    pub track_id: Option<String>,
    pub position_secs: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedTrack {
    pub track: Track,
    pub play_count: u64,
    pub total_secs: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedArtist {
    pub name: String,
    pub play_count: u64,
    pub total_secs: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedAlbum {
    pub name: String,
    pub play_count: u64,
    pub total_secs: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedGenre {
    pub name: String,
    pub play_count: u64,
    pub total_secs: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedYear {
    pub year: i32,
    pub play_count: u64,
    pub total_secs: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsSummary {
    pub total_plays: u64,
    pub total_listen_secs: f64,
    pub unique_tracks: u64,
    pub full_listens: u64,
    pub top_tracks: Vec<RankedTrack>,
    pub top_artist: Option<RankedArtist>,
    pub top_album: Option<RankedAlbum>,
    pub top_genre: Option<RankedGenre>,
    pub top_year: Option<RankedYear>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YearlyWrap {
    pub year: i32,
    pub total_plays: u64,
    pub total_listen_secs: f64,
    pub unique_tracks: u64,
    pub full_listens: u64,
    pub top_tracks: Vec<RankedTrack>,
    pub top_artists: Vec<RankedArtist>,
    pub top_albums: Vec<RankedAlbum>,
    pub top_genre: Option<RankedGenre>,
    pub top_year: Option<RankedYear>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackStatus {
    Playing,
    Paused,
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    pub status: PlaybackStatus,
    pub track_id: Option<String>,
    pub position_secs: f64,
    pub duration_secs: f64,
    pub volume: f32,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            status: PlaybackStatus::Stopped,
            track_id: None,
            position_secs: 0.0,
            duration_secs: 0.0,
            volume: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanProgressPayload {
    pub current: usize,
    pub total: usize,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanCompletePayload {
    pub track_count: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub struct PlaybackStatePayload {
    pub status: PlaybackStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackPositionPayload {
    pub position_secs: f64,
    pub duration_secs: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackEndedPayload {
    pub track_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackAdvancedPayload {
    pub track: Track,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSpectrumPayload {
    pub bins: Vec<f32>,
}

pub mod models;

pub mod paths {
    use std::path::PathBuf;

    use crate::db::Database;

    pub fn default_music_root() -> Result<PathBuf, String> {
        dirs::home_dir()
            .map(|home| home.join("Music"))
            .ok_or_else(|| "Could not resolve home directory".to_string())
    }

    pub fn resolve_music_root(db: &Database) -> Result<PathBuf, String> {
        if let Some(value) = db.get_setting("music_root")? {
            if !value.is_empty() {
                return Ok(PathBuf::from(value));
            }
        }
        default_music_root()
    }
}

pub mod scanner {
    use std::path::{Path, PathBuf};

    use serde::Serialize;

    pub const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav"];

    #[derive(Debug, Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ScannedFile {
        pub id: String,
        pub relative_path: String,
        pub absolute_path: String,
        pub extension: String,
        pub file_size: u64,
        pub modified_ms: u128,
        pub has_lrc: bool,
        pub lrc_path: Option<String>,
    }

    pub fn scan_files(music_root: &Path) -> Result<Vec<ScannedFile>, String> {
        if !music_root.is_dir() {
            return Err(format!(
                "Music directory not found: {}",
                music_root.display()
            ));
        }

        let mut files = Vec::new();

        for entry in walkdir::WalkDir::new(music_root)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let Some(ext) = audio_extension(path) else {
                continue;
            };
            let Some(stem) = file_stem(path) else {
                continue;
            };

            let absolute_path = path.to_path_buf();
            let relative_path = absolute_path
                .strip_prefix(music_root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| absolute_path.to_string_lossy().into_owned());

            let metadata = std::fs::metadata(path).map_err(|e| {
                format!("Failed to read metadata for {}: {e}", path.display())
            })?;

            let lrc = resolve_lrc(path, &stem);
            let has_lrc = lrc.is_some();

            files.push(ScannedFile {
                id: relative_path.clone(),
                relative_path,
                absolute_path: absolute_path.to_string_lossy().into_owned(),
                extension: ext,
                file_size: metadata.len(),
                modified_ms: metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis())
                    .unwrap_or(0),
                has_lrc,
                lrc_path: lrc.map(|p| p.to_string_lossy().into_owned()),
            });
        }

        files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        Ok(files)
    }

    fn file_stem(path: &Path) -> Option<String> {
        path.file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_string)
    }

    fn audio_extension(path: &Path) -> Option<String> {
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .filter(|ext| AUDIO_EXTENSIONS.contains(&ext.as_str()))
            .map(|ext| ext.to_string())
    }

    fn resolve_lrc(audio_path: &Path, stem: &str) -> Option<PathBuf> {
        let lrc = audio_path
            .parent()
            .map(|p| p.join(format!("{stem}.lrc")))
            .unwrap_or_else(|| audio_path.with_extension("lrc"));
        lrc.is_file().then_some(lrc)
    }
}

pub mod metadata {
    use std::path::Path;

    use lofty::file::{AudioFile, TaggedFileExt};
    use lofty::probe::Probe;
    use lofty::tag::Accessor;

    #[derive(Debug, Clone, Default)]
    pub struct TrackMetadata {
        pub title: Option<String>,
        pub artist: Option<String>,
        pub album: Option<String>,
        pub year: Option<i32>,
        pub duration_secs: Option<f64>,
        pub embedded_lyrics: Option<String>,
    }

    pub fn read_metadata(path: &Path) -> Result<TrackMetadata, String> {
        let tagged = Probe::open(path)
            .map_err(|e| format!("Failed to open {}: {e}", path.display()))?
            .read()
            .map_err(|e| format!("Failed to read tags from {}: {e}", path.display()))?;

        let properties = tagged.properties();
        let duration_secs = properties.duration().as_secs_f64();
        let duration_secs = if duration_secs > 0.0 {
            Some(duration_secs)
        } else {
            None
        };

        let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
        let mut meta = TrackMetadata {
            duration_secs,
            ..Default::default()
        };

        if let Some(tag) = tag {
            meta.title = tag.title().map(|s| s.to_string());
            meta.artist = tag.artist().map(|s| s.to_string());
            meta.album = tag.album().map(|s| s.to_string());
            meta.year = tag.year().map(|y| y as i32);
            meta.embedded_lyrics = extract_embedded_lyrics(tag);
        }

        if meta.title.is_none() {
            meta.title = path
                .file_stem()
                .and_then(|s| s.to_str())
                .map(str::to_string);
        }

        Ok(meta)
    }

    fn extract_embedded_lyrics(
        tag: &lofty::tag::Tag,
    ) -> Option<String> {
        for item in tag.items() {
            if let lofty::tag::ItemValue::Text(text) = item.value() {
                let key = format!("{:?}", item.key()).to_lowercase();
                if key.contains("lyric") || key.contains("unsync") {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
        None
    }
}

pub mod lyrics {
    use std::fs;
    use std::path::Path;

    use serde::Serialize;

    use crate::db::TrackRow;

    #[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "lowercase")]
    pub enum LyricsSource {
        Lrc,
        Embedded,
        None,
    }

    #[derive(Debug, Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct LyricsResult {
        pub source: LyricsSource,
        pub text: Option<String>,
    }

    pub fn resolve_for_track(track: &TrackRow) -> Result<LyricsResult, String> {
        if let Some(lrc_path) = &track.lrc_path {
            let path = Path::new(lrc_path);
            if path.is_file() {
                let text = fs::read_to_string(path)
                    .map_err(|e| format!("Failed to read lyrics file {}: {e}", path.display()))?;
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Ok(LyricsResult {
                        source: LyricsSource::Lrc,
                        text: Some(trimmed.to_string()),
                    });
                }
            }
        }

        if let Some(text) = &track.embedded_lyrics {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Ok(LyricsResult {
                    source: LyricsSource::Embedded,
                    text: Some(trimmed.to_string()),
                });
            }
        }

        Ok(LyricsResult {
            source: LyricsSource::None,
            text: None,
        })
    }
}

pub mod db;
pub mod audio;
pub mod commands;
pub mod state;

use tauri::Manager;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;

            let db_path = app_data.join("brook.db");
            let db = db::Database::open(&db_path)?;
            let music_root = paths::resolve_music_root(&db)?;

            app.manage(AppState::new(db, music_root, app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library::get_music_root,
            commands::library::scan_library,
            commands::library::get_tracks,
            commands::library::get_track,
            commands::lyrics::read_lyrics,
            commands::favorites::toggle_favorite,
            commands::favorites::get_favorites,
            commands::playlists::get_playlists,
            commands::playlists::get_playlist_tracks,
            commands::playlists::create_playlist,
            commands::playlists::update_playlist,
            commands::playlists::delete_playlist,
            commands::playlists::add_to_playlist,
            commands::playlists::remove_from_playlist,
            commands::playback::get_playback_state,
            commands::playback::play_track,
            commands::playback::pause,
            commands::playback::resume,
            commands::playback::stop,
            commands::playback::seek,
            commands::playback::set_volume,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

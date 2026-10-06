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

            let metadata = std::fs::metadata(path)
                .map_err(|e| format!("Failed to read metadata for {}: {e}", path.display()))?;

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
        pub genre: Option<String>,
        pub year: Option<i32>,
        pub duration_secs: Option<f64>,
        pub embedded_lyrics: Option<String>,
        /// ReplayGain track gain in dB (e.g. -7.43 means reduce by 7.43 dB).
        pub replay_gain_track_db: Option<f64>,
        /// ReplayGain track peak amplitude (0..1), used to clamp the applied gain.
        pub replay_gain_track_peak: Option<f64>,
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
            meta.genre = tag.genre().map(|s| s.to_string());
            meta.year = tag.year().map(|y| y as i32);
            meta.embedded_lyrics = extract_embedded_lyrics(tag);
            extract_replaygain(tag, &mut meta);
        }

        if meta.title.is_none() {
            meta.title = path
                .file_stem()
                .and_then(|s| s.to_str())
                .map(str::to_string);
        }

        Ok(meta)
    }

    fn extract_embedded_lyrics(tag: &lofty::tag::Tag) -> Option<String> {
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

    /// Read read-only ReplayGain tags (REPLAYGAIN_TRACK_GAIN / REPLAYGAIN_TRACK_PEAK)
    /// from any tag format lofty exposes. Values look like "-7.43 dB" or "0.98123";
    /// we parse the leading numeric token.
    fn extract_replaygain(tag: &lofty::tag::Tag, meta: &mut TrackMetadata) {
        for item in tag.items() {
            let lofty::tag::ItemValue::Text(text) = item.value() else {
                continue;
            };
            let key = format!("{:?}", item.key()).to_lowercase();
            let key = key.replace('_', "");
            let value = match parse_replaygain_value(text) {
                Some(v) => v,
                None => continue,
            };
            if key.contains("replaygaintrackgain") {
                meta.replay_gain_track_db = Some(value);
            } else if key.contains("replaygaintrackpeak") {
                meta.replay_gain_track_peak = Some(value);
            }
        }
    }

    fn parse_replaygain_value(text: &str) -> Option<f64> {
        text.split_whitespace()
            .next()
            .and_then(|token| token.parse::<f64>().ok())
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

mod cli;

pub mod audio;
pub mod commands;
pub mod cover_art;
pub mod db;
pub mod dev_log;
pub mod library_scan;
pub mod playback_session;
pub mod queue;
pub mod session;
pub mod state;
pub mod theme;

use tauri::Manager;

use state::AppState;

#[cfg(target_os = "linux")]
fn configure_linux_webview() {
    if std::env::var_os("APPIMAGE").is_none() {
        return;
    }

    // AppImage on rolling distros (Arch, etc.) can crash in WebKitGPUProcess when
    // bundled EGL libs mismatch the host Mesa stack.
    unsafe {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_webview() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_linux_webview();
    let headless = arg_flag("--headless");
    let quit = arg_flag("--quit");
    if arg_flag("--uninstall") {
        if let Err(error) = uninstall(arg_flag("--clear-history")) {
            eprintln!("brook: {error}");
            std::process::exit(1);
        }
    }
    if arg_flag("--search") {
        let query = arg_value("--search").unwrap_or_default();
        if let Err(error) = cli::print_search(&query) {
            eprintln!("brook: {error}");
            std::process::exit(1);
        }
        return;
    }

    tauri::Builder::default()
        // Single-instance guard: a second launch hands its argv to the
        // running process and exits. `--search` never reaches this plugin.
        // Play flags run here and do not open a window. `--headless` alone
        // is a no-op when a session is already up. A normal launch opens the
        // window. `--quit` and `--uninstall` exit. File removal for
        // `--uninstall` already happened in this process, before the builder
        // started.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // The D-Bus callback is not the GTK thread. Window creation has to
            // hop to the main thread.
            let app = app.clone();
            let argv = argv.clone();
            let _ = app.clone().run_on_main_thread(move || {
                let uninstalling = argv.iter().any(|arg| arg == "--uninstall");
                if uninstalling || argv.iter().any(|arg| arg == "--quit") {
                    if uninstalling && argv.iter().any(|arg| arg == "--clear-history") {
                        if let Err(error) = clear_listening_history(Some(&app)) {
                            eprintln!("brook: {error}");
                        }
                    }
                    app.exit(0);
                    return;
                }
                if apply_play_argv(&app, &argv) {
                    return;
                }
                if argv.iter().any(|arg| arg == "--headless") {
                    return;
                }
                present_main_window(&app);
            });
        }))
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let keep_alive = window
                    .app_handle()
                    .try_state::<AppState>()
                    .is_some_and(|state| state.started_headless);
                if keep_alive {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(move |app| {
            if arg_flag("--uninstall") || quit {
                app.handle().exit(0);
                return Ok(());
            }

            let setup_timer = dev_log::Timer::new("setup", "tauri setup");

            let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
            setup_timer.log_step("app_data_dir");

            let db_path = app_data.join("brook.db");
            let covers_dir = app_data.join("covers");
            std::fs::create_dir_all(&covers_dir).map_err(|e| e.to_string())?;

            let db_timer = dev_log::Timer::new("setup", "database open + migrate");
            let db = db::Database::open(&db_path)?;
            db_timer.finish(format!("db_path={}", db_path.display()));

            #[cfg(target_os = "linux")]
            let mpris_handle = {
                let mpris_timer = dev_log::Timer::new("setup", "MPRIS launch");
                let handle = crate::audio::mpris::launch(app.handle().clone(), covers_dir.clone());
                mpris_timer.finish("registered");
                Some(handle)
            };
            #[cfg(not(target_os = "linux"))]
            let mpris_handle: Option<()> = None;

            app.manage(AppState::new(
                db,
                app.handle().clone(),
                covers_dir,
                mpris_handle,
                headless,
            ));
            session::install(app.handle());
            session::restore_resume(app.handle());
            apply_play_argv(app.handle(), &std::env::args().collect::<Vec<_>>());
            commands::theme::install(app.handle())?;
            setup_timer.log_step("AppState ready");

            if !headless {
                create_main_window(app.handle())?;
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    let state = app_handle.state::<AppState>();
                    let charts_timer =
                        dev_log::Timer::new("setup", "refresh_chart_playlists_if_due (background)");
                    let mut db = match state.db.lock() {
                        Ok(guard) => guard,
                        Err(e) => {
                            dev_log::append("setup", &format!("charts refresh lock error: {e}"));
                            return;
                        }
                    };
                    if let Err(e) = db.refresh_chart_playlists_if_due() {
                        dev_log::append("setup", &format!("charts refresh error: {e}"));
                    } else {
                        charts_timer.finish("ok");
                    }
                })
                .await;
            });

            setup_timer.finish(if headless {
                "headless session ready (charts deferred)"
            } else {
                "window ready (charts deferred)"
            });
            dev_log::append(
                "setup",
                &format!("dev logs → {}", dev_log::log_file_path().display()),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library::get_music_root,
            commands::library::pick_music_folder,
            commands::library::set_music_root,
            commands::library::start_library_scan,
            commands::library::get_library_facets,
            commands::library::get_tracks,
            commands::library::get_tracks_page,
            commands::library::get_tracks_count,
            commands::library::get_track,
            commands::library::get_album_art,
            commands::library::get_album_art_thumb,
            commands::library::get_album_art_batch,
            commands::lyrics::read_lyrics,
            commands::favorites::toggle_favorite,
            commands::favorites::get_favorites,
            commands::playlists::get_playlists,
            commands::playlists::get_playlist_tracks,
            commands::playlists::create_playlist,
            commands::playlists::create_smart_playlist,
            commands::playlists::update_smart_playlist,
            commands::playlists::get_smart_playlist_config,
            commands::playlists::update_playlist,
            commands::playlists::delete_playlist,
            commands::playlists::add_to_playlist,
            commands::playlists::remove_from_playlist,
            commands::playback::get_playback_state,
            commands::playback::get_resume_state,
            commands::playback::save_resume_state,
            commands::playback::load_track_paused,
            commands::playback::play_track,
            commands::playback::set_upcoming_track,
            commands::playback::pause,
            commands::playback::resume,
            commands::playback::seek,
            commands::playback::set_volume,
            commands::playback::set_visualizer_active,
            commands::playback::stop,
            #[cfg(target_os = "linux")]
            commands::playback::set_mpris_controls,
            commands::queue::get_queue,
            commands::queue::play_queue,
            commands::queue::queue_insert_next,
            commands::queue::queue_append,
            commands::queue::queue_remove,
            commands::queue::queue_reorder,
            commands::queue::queue_jump,
            commands::queue::queue_clear,
            commands::queue::queue_toggle_shuffle,
            commands::queue::queue_cycle_repeat,
            commands::queue::queue_next,
            commands::queue::queue_previous,
            commands::queue::play_current,
            commands::stats::get_stats,
            commands::stats::get_stats_years,
            commands::stats::get_yearly_wrap,
            commands::stats::get_recent_tracks,
            commands::dev::dev_log_append,
            commands::theme::get_shared_theme,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                let keep_alive = code.is_none()
                    && app
                        .try_state::<AppState>()
                        .is_some_and(|state| state.started_headless);
                if keep_alive {
                    api.prevent_exit();
                }
            }
        });
}

fn arg_flag(flag: &str) -> bool {
    std::env::args().any(|arg| arg == flag)
}

fn arg_value(flag: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    argv_value(&args, flag)
}

fn argv_value(args: &[String], flag: &str) -> Option<String> {
    let pos = args.iter().position(|arg| arg == flag)?;
    match args.get(pos + 1) {
        Some(value) if !value.starts_with('-') => Some(value.clone()),
        _ => Some(String::new()),
    }
}

/// `--play-track` queues that track's album. `--play-playlist` queues the playlist.
/// Returns whether a play flag was present.
fn apply_play_argv(app: &tauri::AppHandle, argv: &[String]) -> bool {
    let track = argv_value(argv, "--play-track").filter(|id| !id.is_empty());
    let playlist = argv_value(argv, "--play-playlist").filter(|id| !id.is_empty());
    if track.is_none() && playlist.is_none() {
        return false;
    }
    if app.try_state::<AppState>().is_none() {
        eprintln!("brook: player is still starting");
        return true;
    }
    if let Some(id) = track {
        if let Err(error) = session::play_track_album(app, &id) {
            eprintln!("brook: {error}");
        }
        return true;
    }
    if let Some(id) = playlist {
        if let Err(error) = session::play_playlist(app, &id) {
            eprintln!("brook: {error}");
        }
    }
    true
}

/// Remove the AppImage install: the bundle, the `brook` command, the desktop
/// entry, and the icon. The music folder stays. `clear_history` also removes
/// listening history and cached cover art.
fn uninstall(clear_history: bool) -> Result<(), String> {
    let appimage = std::env::var_os("APPIMAGE")
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_file())
        .ok_or_else(|| {
            "this copy was not installed as an AppImage, so nothing was removed".to_string()
        })?;

    let mut failed = false;
    if let Some(launcher) = launcher_for(&appimage) {
        failed |= !remove_install_file(&launcher);
    }
    if let Some(data) = xdg_data_home() {
        failed |= !remove_install_file(&data.join("applications/brook.desktop"));
        failed |= !remove_install_file(&data.join("icons/hicolor/256x256/apps/brook.png"));
    }
    failed |= !remove_install_file(&appimage);
    if clear_history {
        if let Err(error) = clear_listening_history(None) {
            eprintln!("brook: {error}");
        }
    }
    if failed {
        return Err("uninstall did not remove every file".to_string());
    }
    println!("Brook uninstalled.");
    Ok(())
}

/// App data directory from `tauri.conf.json` identifier `dev.skyguy.brook`.
fn app_data_dir() -> Option<std::path::PathBuf> {
    xdg_data_home().map(|data| data.join("dev.skyguy.brook"))
}

/// Delete listening history and cached cover art. Tracks, likes, and playlists stay.
fn clear_listening_history(app: Option<&tauri::AppHandle>) -> Result<(), String> {
    let cleared = if let Some(state) = app.and_then(|app| app.try_state::<AppState>()) {
        let mut db = state
            .db
            .lock()
            .map_err(|_| "listening history database is busy".to_string())?;
        db.clear_listening_history()?;
        true
    } else {
        clear_listening_history_file()?
    };
    let covers_removed = remove_cover_cache()?;
    if cleared {
        println!("removed listening history");
    }
    if let Some(covers) = covers_removed {
        println!("removed {}", covers.display());
    }
    Ok(())
}

fn clear_listening_history_file() -> Result<bool, String> {
    let Some(dir) = app_data_dir() else {
        return Err("could not find the home directory".to_string());
    };
    let db_path = dir.join("brook.db");
    if !db_path.is_file() {
        return Ok(false);
    }
    let mut db = db::Database::open(&db_path)?;
    db.clear_listening_history()?;
    Ok(true)
}

fn remove_cover_cache() -> Result<Option<std::path::PathBuf>, String> {
    let Some(covers) = app_data_dir().map(|dir| dir.join("covers")) else {
        return Ok(None);
    };
    if !covers.exists() {
        return Ok(None);
    }
    std::fs::remove_dir_all(&covers)
        .map_err(|error| format!("could not remove {}: {error}", covers.display()))?;
    Ok(Some(covers))
}

fn launcher_for(appimage: &std::path::Path) -> Option<std::path::PathBuf> {
    launcher_candidates(appimage)
        .into_iter()
        .find(|launcher| launcher != appimage && launcher_text_matches(launcher, appimage))
}

/// The AppImage lives in `~/Applications`. The `brook` command is
/// `~/.local/bin/brook`, or a `brook` script beside the bundle.
fn launcher_candidates(appimage: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();
    if let Some(parent) = appimage.parent() {
        paths.push(parent.join("brook"));
    }
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".local/bin/brook"));
    }
    paths
}

fn launcher_text_matches(launcher: &std::path::Path, appimage: &std::path::Path) -> bool {
    let Ok(text) = std::fs::read_to_string(launcher) else {
        return false;
    };
    if text.contains(&appimage.display().to_string()) {
        return true;
    }
    let Some(recorded) = recorded_appimage(&text) else {
        return false;
    };
    let Some(running_name) = appimage.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(recorded_name) = recorded.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(recorded_stem) = recorded_name.strip_suffix(".AppImage") else {
        return false;
    };
    running_name
        .strip_suffix(".AppImage")
        .is_some_and(|name| name.starts_with(&format!("{recorded_stem}_")))
}

fn recorded_appimage(text: &str) -> Option<std::path::PathBuf> {
    text.lines().find_map(|line| {
        let path = line.trim().strip_prefix("APPIMAGE=")?.trim_matches('"');
        (!path.is_empty()).then(|| std::path::PathBuf::from(path))
    })
}

fn xdg_data_home() -> Option<std::path::PathBuf> {
    if let Some(path) = std::env::var_os("XDG_DATA_HOME") {
        if !path.is_empty() {
            return Some(std::path::PathBuf::from(path));
        }
    }
    dirs::home_dir().map(|home| home.join(".local/share"))
}

/// `true` when the path is gone. A missing file counts as success.
fn remove_install_file(path: &std::path::Path) -> bool {
    match std::fs::remove_file(path) {
        Ok(()) => {
            println!("removed {}", path.display());
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(error) => {
            eprintln!("brook: could not remove {}: {error}", path.display());
            false
        }
    }
}

fn create_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
        .title("Brook")
        .inner_size(1280.0, 800.0)
        .resizable(true)
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn present_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }
    if let Err(error) = create_main_window(app) {
        eprintln!("[brook] failed to open window: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::launcher_for;

    #[test]
    fn launcher_is_the_sibling_script_that_points_at_the_appimage() {
        let dir = std::env::temp_dir().join(format!("brook-uninstall-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let appimage = dir.join("Brook_0.0.6_amd64.AppImage");
        std::fs::write(&appimage, b"appimage").unwrap();
        let launcher = dir.join("brook");
        std::fs::write(
            &launcher,
            format!(
                "#!/bin/bash\nAPPIMAGE=\"{}\"\nexec \"$APPIMAGE\" \"$@\"\n",
                appimage.display()
            ),
        )
        .unwrap();

        assert_eq!(launcher_for(&appimage), Some(launcher.clone()));
        assert_eq!(launcher_for(&dir.join("missing.AppImage")), None);

        let moved = dir.join("Brook_0.0.6_amd64_deadbeef.AppImage");
        std::fs::write(&moved, b"appimage").unwrap();
        std::fs::write(
            &launcher,
            "#!/bin/bash\n# brook-cli: uninstall\nAPPIMAGE=\"/tmp/not/Brook_0.0.6_amd64.AppImage\"\n",
        )
        .unwrap();
        assert_eq!(launcher_for(&moved), Some(launcher));
        assert_eq!(launcher_for(&dir.join("Other.AppImage")), None);

        let _ = std::fs::remove_dir_all(&dir);
    }
}

//! MPRIS (Media Player Remote Interfacing Specification) bridge.
//!
//! Linux only. Registers a `brook` player on the session D-Bus so media keys,
//! `playerctl`, and Waybar widgets can observe and control playback.
//!
//! The player thread owns a current-thread tokio runtime with a `LocalSet`
//! (`mpris_server::Player` is not `Send`). It receives [`MprisUpdate`]s from
//! the app and pushes them to D-Bus. Incoming D-Bus commands either call the
//! audio engine directly (play, pause, seek, volume, stop) or emit Tauri
//! events (`mpris:next`, `mpris:previous`, `mpris:shuffle`, `mpris:loop`) that
//! the frontend routes through its playback queue.

#![cfg(target_os = "linux")]

use std::path::PathBuf;
use std::sync::Mutex;

use mpris_server::{Metadata, PlaybackStatus, Player, Time};
use tauri::{AppHandle, Emitter, Listener, Manager};
use tokio::sync::mpsc;

use crate::models::{PlaybackStatus as BrookStatus, Track};
use crate::state::AppState;

pub use mpris_server::LoopStatus;

#[derive(Debug, Clone)]
pub enum MprisUpdate {
    Metadata {
        title: String,
        artist: String,
        album: String,
        duration_us: i64,
        art_url: String,
    },
    Status(PlaybackStatus),
    Volume(f64),
    Position(std::time::Duration),
    Shuffle(bool),
    Loop(LoopStatus),
}

/// Shared handle held by [`AppState`] so commands can push control changes.
#[derive(Clone)]
pub struct MprisHandle {
    tx: mpsc::UnboundedSender<MprisUpdate>,
}

impl MprisHandle {
    pub fn push(&self, update: MprisUpdate) {
        let _ = self.tx.send(update);
    }
}

/// Launch the MPRIS player and wire Tauri events → D-Bus updates.
///
/// Returns a handle that can push control updates (shuffle/loop) to the player.
pub fn launch(app: AppHandle, covers_dir: PathBuf) -> MprisHandle {
    let (tx, rx) = mpsc::unbounded_channel::<MprisUpdate>();

    spawn_player_thread(app.clone(), rx);

    // Forward Tauri playback events to D-Bus updates.
    forward_events(app, covers_dir, tx.clone());

    MprisHandle { tx }
}

fn spawn_player_thread(app: AppHandle, mut rx: mpsc::UnboundedReceiver<MprisUpdate>) {
    std::thread::Builder::new()
        .name("brook-mpris".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    eprintln!("[brook-mpris] runtime build failed: {e}");
                    return;
                }
            };

            let local = tokio::task::LocalSet::new();
            local.block_on(&rt, async move {
                let player = match Player::builder("brook")
                    .identity("Brook")
                    .can_play(true)
                    .can_pause(true)
                    .can_go_next(true)
                    .can_go_previous(true)
                    .can_seek(true)
                    .can_control(true)
                    .build()
                    .await
                {
                    Ok(p) => p,
                    Err(e) => {
                        eprintln!("[brook-mpris] failed to register on D-Bus: {e}");
                        return;
                    }
                };

                register_callbacks(&player, app);

                // Run the player's D-Bus loop in parallel with the update loop.
                tokio::task::spawn_local(player.run());

                while let Some(update) = rx.recv().await {
                    apply_update(&player, update).await;
                }
            });
        })
        .expect("failed to spawn mpris thread");
}

fn register_callbacks(player: &Player, app: AppHandle) {
    player.connect_play({
        let app = app.clone();
        move |_| {
            let _ = app.state::<AppState>().audio.resume();
        }
    });

    player.connect_pause({
        let app = app.clone();
        move |_| {
            let _ = app.state::<AppState>().audio.pause();
        }
    });

    player.connect_play_pause({
        let app = app.clone();
        move |_| {
            let state = app.state::<AppState>();
            let status = state.audio.state().status;
            match status {
                BrookStatus::Playing => {
                    let _ = state.audio.pause();
                }
                _ => {
                    let _ = state.audio.resume();
                }
            }
        }
    });

    player.connect_next({
        let app = app.clone();
        move |_| {
            let _ = app.emit("mpris:next", ());
        }
    });

    player.connect_previous({
        let app = app.clone();
        move |_| {
            let _ = app.emit("mpris:previous", ());
        }
    });

    player.connect_stop({
        let app = app.clone();
        move |_| {
            let _ = app.state::<AppState>().audio.stop();
        }
    });

    player.connect_set_volume({
        let app = app.clone();
        move |_, v| {
            let _ = app.state::<AppState>().audio.set_volume(v as f32);
        }
    });

    player.connect_set_position({
        let app = app.clone();
        move |_, _track_id, pos| {
            let secs = pos.as_micros() as f64 / 1_000_000.0;
            let _ = app.state::<AppState>().audio.seek(secs);
        }
    });

    player.connect_seek({
        let app = app.clone();
        move |_, offset| {
            let secs = offset.as_micros() as f64 / 1_000_000.0;
            let state = app.state::<AppState>();
            let cur = state.audio.state();
            let target = (cur.position_secs + secs).max(0.0).min(cur.duration_secs);
            let _ = state.audio.seek(target);
        }
    });

    player.connect_set_shuffle({
        let app = app.clone();
        move |_, s| {
            let _ = app.emit("mpris:shuffle", s);
        }
    });

    player.connect_set_loop_status({
        let app = app.clone();
        move |_, l| {
            let _ = app.emit("mpris:loop", loop_status_to_str(l));
        }
    });
}

async fn apply_update(player: &Player, update: MprisUpdate) {
    match update {
        MprisUpdate::Metadata {
            title,
            artist,
            album,
            duration_us,
            art_url,
        } => {
            let mut builder = Metadata::builder()
                .title(title)
                .artist([artist])
                .album(album)
                .length(Time::from_micros(duration_us));
            if !art_url.is_empty() {
                builder = builder.art_url(art_url);
            }
            let _ = player.set_metadata(builder.build()).await;
        }
        MprisUpdate::Status(s) => {
            let _ = player.set_playback_status(s).await;
        }
        MprisUpdate::Volume(v) => {
            let _ = player.set_volume(v).await;
        }
        MprisUpdate::Position(d) => {
            player.set_position(Time::from_micros(d.as_micros() as i64));
        }
        MprisUpdate::Shuffle(s) => {
            let _ = player.set_shuffle(s).await;
        }
        MprisUpdate::Loop(l) => {
            let _ = player.set_loop_status(l).await;
        }
    }
}

fn loop_status_to_str(l: LoopStatus) -> &'static str {
    match l {
        LoopStatus::None => "none",
        LoopStatus::Track => "one",
        LoopStatus::Playlist => "all",
    }
}

fn forward_events(app: AppHandle, covers_dir: PathBuf, tx: mpsc::UnboundedSender<MprisUpdate>) {
    let tx_meta = tx.clone();
    let covers = covers_dir.clone();
    let on_track = move |event: &tauri::Event| {
        let Some(track) = serde_json::from_str::<Track>(event.payload()).ok() else {
            return;
        };
        let title = track.title.clone().unwrap_or_else(|| "Unknown".to_string());
        let artist = track.artist.clone().unwrap_or_else(|| "Unknown artist".to_string());
        let album = track.album.clone().unwrap_or_default();
        let duration_us = (track.duration_secs.unwrap_or(0.0) * 1_000_000.0) as i64;
        let art_url = cover_url_for(&covers, &track.id);
        let _ = tx_meta.send(MprisUpdate::Metadata {
            title,
            artist,
            album,
            duration_us,
            art_url,
        });
    };
    // Manual play_track emits track-changed; the gapless engine path emits
    // playback:advanced. Both carry the new Track and must refresh MPRIS
    // metadata, so the desktop controls show the now-playing track.
    let _ = app.listen("playback:track-changed", {
        let on_track = on_track.clone();
        move |event| on_track(&event)
    });
    let _ = app.listen("playback:advanced", {
        let on_track = on_track.clone();
        move |event| on_track(&event)
    });

    let tx_state = tx.clone();
    let _ = app.listen("playback:state", move |event| {
        let Ok(payload) = serde_json::from_str::<crate::models::PlaybackStatePayload>(event.payload())
        else {
            return;
        };
        let _ = tx_state.send(MprisUpdate::Status(map_status(payload.status)));
    });

    // Throttle position updates to ~1 second for D-Bus.
    let tx_pos = tx.clone();
    let last = std::sync::Arc::new(Mutex::new(std::time::Instant::now()));
    let app_for_volume = app.clone();
    let _ = app.listen("playback:position", move |event| {
        let Ok(payload) =
            serde_json::from_str::<crate::models::PlaybackPositionPayload>(event.payload())
        else {
            return;
        };
        let now = std::time::Instant::now();
        let should_emit = {
            let mut guard = last.lock().expect("mpris throttle lock");
            if guard.elapsed() >= std::time::Duration::from_secs(1) {
                *guard = now;
                true
            } else {
                false
            }
        };
        if !should_emit {
            return;
        }
        let pos = std::time::Duration::from_secs_f64(payload.position_secs.max(0.0));
        let _ = tx_pos.send(MprisUpdate::Position(pos));
        // Also push the current volume so playerctl's volume reflects reality.
        let state = app_for_volume.state::<AppState>();
        let vol = state.audio.state().volume as f64;
        let _ = tx_pos.send(MprisUpdate::Volume(vol));
    });
}

fn map_status(status: BrookStatus) -> PlaybackStatus {
    match status {
        BrookStatus::Playing => PlaybackStatus::Playing,
        BrookStatus::Paused => PlaybackStatus::Paused,
        BrookStatus::Stopped => PlaybackStatus::Stopped,
    }
}

/// Resolve a `file://` URL for the cached cover of `track_id`, if any.
fn cover_url_for(covers_dir: &PathBuf, track_id: &str) -> String {
    let key = track_id.replace('/', "__");
    for ext in ["jpg", "jpeg", "png", "webp"] {
        let path = covers_dir.join(format!("{key}.{ext}"));
        if path.is_file() {
            if let Ok(url) = path_to_file_url(&path) {
                return url;
            }
        }
    }
    String::new()
}

fn path_to_file_url(path: &std::path::Path) -> Result<String, ()> {
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::fs::canonicalize(path).map_err(|_| ())?
    };
    let mut s = String::from("file://");
    for &b in abs.as_os_str().as_encoded_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'/' | b'.' | b'_' | b'-') {
            s.push(b as char);
        } else {
            s.push_str(&format!("%{b:02X}"));
        }
    }
    Ok(s)
}


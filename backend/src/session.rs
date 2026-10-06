//! Playback session: the queue plus the calls that keep the engine and MPRIS
//! in step with it. Desktop controls talk to this module, not the webview.

use tauri::{AppHandle, Emitter, Listener, Manager};

use crate::models::{PlaybackAdvancedPayload, QueueSnapshot, RepeatMode};
use crate::playback_session::finalize_current_listen;
use crate::queue::PlaybackQueue;
use crate::state::AppState;

pub struct Session {
    queue: std::sync::Mutex<PlaybackQueue>,
}

impl Session {
    pub fn new() -> Self {
        Self {
            queue: std::sync::Mutex::new(PlaybackQueue::default()),
        }
    }

    pub fn snapshot(&self) -> Result<QueueSnapshot, String> {
        let queue = self.queue.lock().map_err(|e| e.to_string())?;
        Ok(queue.snapshot())
    }

    /// Ids in play order when `track_id` is in the queue. Empty when it is not,
    /// so a save does not attach this track to an unrelated list.
    pub fn queue_ids_for(&self, track_id: Option<&str>) -> Vec<String> {
        let Some(id) = track_id else {
            return Vec::new();
        };
        let Ok(snap) = self.snapshot() else {
            return Vec::new();
        };
        if snap.tracks.iter().any(|track| track.id == id) {
            snap.tracks.into_iter().map(|track| track.id).collect()
        } else {
            Vec::new()
        }
    }
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}

/// Follow gapless handoffs and natural ends. Installed once during setup.
pub fn install(app: &AppHandle) {
    let advanced = app.clone();
    let _ = app.listen("playback:advanced", move |event| {
        let Ok(payload) = serde_json::from_str::<PlaybackAdvancedPayload>(event.payload()) else {
            return;
        };
        on_advanced(&advanced, &payload.track.id);
    });

    let ended = app.clone();
    let _ = app.listen("playback:ended", move |_| {
        on_ended(&ended);
    });
}

/// Load the saved track paused inside its saved queue. An older save with no
/// queue ids uses that track's album, in path order. No-op when nothing was
/// saved. Runs for every launch, including `--headless`.
pub fn restore_resume(app: &AppHandle) {
    let Some(resume) = saved_resume(app) else {
        return;
    };
    let Some(id) = resume.track_id else {
        return;
    };
    let ids = if resume.queue_ids.iter().any(|queued| queued == &id) {
        resume.queue_ids
    } else {
        album_ids(app, &id).unwrap_or_else(|_| vec![id.clone()])
    };
    let Ok(tracks) = load_existing(app, &ids) else {
        return;
    };
    if tracks.is_empty() {
        return;
    }
    let current = if tracks.iter().any(|track| track.id == id) {
        id
    } else {
        tracks[0].id.clone()
    };
    if queue_mut(app, |queue| {
        queue.set_queue(tracks, &current);
    })
    .is_err()
    {
        return;
    }
    let Ok((row, track)) = load_pair(app, &current) else {
        return;
    };
    let state = app.state::<AppState>();
    if state
        .audio
        .load_paused(&row, &track, resume.position_secs)
        .is_err()
    {
        return;
    }
    let _ = publish(app);
}

/// Queue the album this track belongs to (same artist and album, path order)
/// and start the track. A track with no album is a one-track queue.
pub fn play_track_album(app: &AppHandle, id: &str) -> Result<QueueSnapshot, String> {
    let ids = album_ids(app, id)?;
    let current = if ids.iter().any(|queued| queued == id) {
        id.to_string()
    } else {
        ids.first()
            .cloned()
            .ok_or_else(|| format!("Track not found: {id}"))?
    };
    replace_queue_and_play(app, &ids, &current)
}

/// Queue every track on the playlist and start the first one.
pub fn play_playlist(app: &AppHandle, id: &str) -> Result<QueueSnapshot, String> {
    let tracks = {
        let state = app.state::<AppState>();
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.get_playlist_tracks(id)?
    };
    if tracks.is_empty() {
        return Err("Playlist is empty".to_string());
    }
    let ids: Vec<String> = tracks.into_iter().map(|track| track.id).collect();
    let current = ids[0].clone();
    replace_queue_and_play(app, &ids, &current)
}

pub fn replace_queue_and_play(
    app: &AppHandle,
    ids: &[String],
    current_id: &str,
) -> Result<QueueSnapshot, String> {
    if !ids.iter().any(|id| id == current_id) {
        return Err(format!("Track is not in the queue: {current_id}"));
    }
    let tracks = load_many(app, ids)?;
    queue_mut(app, |queue| queue.set_queue(tracks, current_id))?;
    play_id(app, current_id)?;
    publish(app)
}

pub fn insert_next(app: &AppHandle, id: &str) -> Result<QueueSnapshot, String> {
    let (_row, track) = load_pair(app, id)?;
    queue_mut(app, |queue| queue.insert_next(track))?;
    publish(app)
}

pub fn append(app: &AppHandle, id: &str) -> Result<QueueSnapshot, String> {
    let (_row, track) = load_pair(app, id)?;
    queue_mut(app, |queue| queue.append(track))?;
    publish(app)
}

pub fn remove(app: &AppHandle, id: &str) -> Result<QueueSnapshot, String> {
    let replacement = queue_mut(app, |queue| queue.remove(id))?;
    if let Some(track) = replacement {
        play_id(app, &track.id)?;
    }
    publish(app)
}

pub fn reorder(
    app: &AppHandle,
    from_index: usize,
    to_index: usize,
) -> Result<QueueSnapshot, String> {
    queue_mut(app, |queue| queue.reorder(from_index, to_index))?;
    publish(app)
}

pub fn jump(app: &AppHandle, id: &str) -> Result<QueueSnapshot, String> {
    let track = queue_mut(app, |queue| queue.jump_to(id))?
        .ok_or_else(|| format!("Track is not in the queue: {id}"))?;
    play_id(app, &track.id)?;
    publish(app)
}

pub fn clear(app: &AppHandle) -> Result<QueueSnapshot, String> {
    queue_mut(app, |queue| queue.clear())?;
    publish(app)
}

pub fn toggle_shuffle(app: &AppHandle) -> Result<QueueSnapshot, String> {
    queue_mut(app, |queue| queue.toggle_shuffle())?;
    publish(app)
}

pub fn set_shuffle(app: &AppHandle, shuffle: bool) -> Result<QueueSnapshot, String> {
    queue_mut(app, |queue| queue.set_shuffle(shuffle))?;
    publish(app)
}

pub fn cycle_repeat(app: &AppHandle) -> Result<QueueSnapshot, String> {
    queue_mut(app, |queue| queue.cycle_repeat())?;
    publish(app)
}

pub fn set_repeat(app: &AppHandle, repeat: RepeatMode) -> Result<QueueSnapshot, String> {
    queue_mut(app, |queue| queue.set_repeat(repeat))?;
    publish(app)
}

pub fn go_next(app: &AppHandle) -> Result<QueueSnapshot, String> {
    let next = queue_mut(app, |queue| queue.advance())?;
    if let Some(track) = next {
        play_id(app, &track.id)?;
    }
    publish(app)
}

pub fn go_previous(app: &AppHandle) -> Result<QueueSnapshot, String> {
    let position = app.state::<AppState>().audio.state().position_secs;
    if position > 3.0 {
        app.state::<AppState>().audio.seek(0.0)?;
        return publish(app);
    }
    let prev = queue_mut(app, |queue| queue.retreat())?;
    if let Some(track) = prev {
        play_id(app, &track.id)?;
    }
    publish(app)
}

/// MPRIS Play / PlayPause when the engine is stopped: start the queued track.
pub fn play_current(app: &AppHandle) -> Result<(), String> {
    let id = snapshot(app)?
        .current_id
        .ok_or_else(|| "Nothing queued".to_string())?;
    play_id(app, &id)?;
    publish(app)?;
    Ok(())
}

/// Open `id` paused and make it the sole queue entry. Used when the window
/// restores a track the backend did not already load.
pub fn adopt_paused(app: &AppHandle, id: &str, position_secs: f64) -> Result<(), String> {
    let (row, track) = load_pair(app, id)?;
    queue_mut(app, |queue| {
        queue.set_queue(vec![track.clone()], id);
    })?;
    app.state::<AppState>()
        .audio
        .load_paused(&row, &track, position_secs)?;
    publish(app)?;
    Ok(())
}

fn on_advanced(app: &AppHandle, track_id: &str) {
    if queue_mut(app, |queue| queue.note_playing(track_id)).is_err() {
        return;
    }
    let _ = publish(app);
}

fn on_ended(app: &AppHandle) {
    let next = match queue_mut(app, |queue| {
        if queue.repeat() == RepeatMode::One {
            queue.current().cloned()
        } else {
            queue.advance()
        }
    }) {
        Ok(next) => next,
        Err(_) => return,
    };
    if let Some(track) = next {
        if play_id(app, &track.id).is_ok() {
            let _ = publish(app);
            return;
        }
    }
    let _ = publish(app);
    let _ = app.emit("playback:session-idle", ());
}

fn saved_resume(app: &AppHandle) -> Option<crate::models::ResumeState> {
    let state = app.state::<AppState>();
    let db = state.db.lock().ok()?;
    db.get_resume_state().ok()?
}

fn album_ids(app: &AppHandle, id: &str) -> Result<Vec<String>, String> {
    let state = app.state::<AppState>();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let track = db.get_track(id)?;
    match track.album.as_deref().filter(|album| !album.is_empty()) {
        Some(album) => db.album_track_ids(track.artist.as_deref(), album),
        None => Ok(vec![id.to_string()]),
    }
}

fn play_id(app: &AppHandle, id: &str) -> Result<(), String> {
    let (row, track) = {
        let state = app.state::<AppState>();
        finalize_current_listen(&state);
        load_pair_from(&state, id)?
    };
    app.state::<AppState>().audio.play(&row, &track)
}

fn publish(app: &AppHandle) -> Result<QueueSnapshot, String> {
    sync_upcoming(app)?;
    let snap = snapshot(app)?;
    let _ = app.emit("queue:changed", &snap);
    Ok(snap)
}

fn sync_upcoming(app: &AppHandle) -> Result<(), String> {
    let (next_id, shuffle, repeat) = {
        let state = app.state::<AppState>();
        let queue = state.session.queue.lock().map_err(|e| e.to_string())?;
        (
            queue.next().map(|track| track.id.clone()),
            queue.is_shuffled(),
            queue.repeat(),
        )
    };
    push_mpris(app, shuffle, repeat);
    let upcoming = match next_id {
        Some(id) => match load_pair(app, &id) {
            Ok(pair) => Some(pair),
            Err(error) => {
                eprintln!("[brook] upcoming track unavailable: {error}");
                None
            }
        },
        None => None,
    };
    let state = app.state::<AppState>();
    match upcoming {
        Some((row, track)) => state.audio.set_upcoming(Some(row), Some(track)),
        None => state.audio.set_upcoming(None, None),
    }
}

fn snapshot(app: &AppHandle) -> Result<QueueSnapshot, String> {
    app.state::<AppState>().session.snapshot()
}

fn queue_mut<T>(app: &AppHandle, f: impl FnOnce(&mut PlaybackQueue) -> T) -> Result<T, String> {
    let state = app.state::<AppState>();
    let mut queue = state.session.queue.lock().map_err(|e| e.to_string())?;
    Ok(f(&mut queue))
}

fn load_many(app: &AppHandle, ids: &[String]) -> Result<Vec<crate::models::Track>, String> {
    let state = app.state::<AppState>();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut tracks = Vec::with_capacity(ids.len());
    for id in ids {
        tracks.push(db.get_track(id)?);
    }
    Ok(tracks)
}

fn load_existing(app: &AppHandle, ids: &[String]) -> Result<Vec<crate::models::Track>, String> {
    let state = app.state::<AppState>();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut tracks = Vec::new();
    for id in ids {
        if let Ok(track) = db.get_track(id) {
            tracks.push(track);
        }
    }
    Ok(tracks)
}

fn load_pair(
    app: &AppHandle,
    id: &str,
) -> Result<(crate::db::TrackRow, crate::models::Track), String> {
    let state = app.state::<AppState>();
    load_pair_from(&state, id)
}

fn load_pair_from(
    state: &AppState,
    id: &str,
) -> Result<(crate::db::TrackRow, crate::models::Track), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let row = db.get_track_row(id)?;
    let track = db.get_track(id)?;
    Ok((row, track))
}

fn push_mpris(app: &AppHandle, shuffle: bool, repeat: RepeatMode) {
    #[cfg(target_os = "linux")]
    {
        use crate::audio::mpris::{LoopStatus, MprisUpdate};
        let state = app.state::<AppState>();
        if let Some(handle) = &state.mpris {
            handle.push(MprisUpdate::Shuffle(shuffle));
            let loop_status = match repeat {
                RepeatMode::One => LoopStatus::Track,
                RepeatMode::All => LoopStatus::Playlist,
                RepeatMode::Off => LoopStatus::None,
            };
            handle.push(MprisUpdate::Loop(loop_status));
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, shuffle, repeat);
    }
}

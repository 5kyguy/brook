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

/// Load the saved track paused and put it alone in the queue. No-op when
/// nothing was saved. Runs for every launch, including `--headless`.
pub fn restore_resume(app: &AppHandle) {
    let Some((id, position)) = saved_resume(app) else {
        return;
    };
    let Ok((row, track)) = load_pair(app, &id) else {
        return;
    };
    if queue_mut(app, |queue| {
        queue.set_queue(vec![track.clone()], &id);
    })
    .is_err()
    {
        return;
    }
    let state = app.state::<AppState>();
    if state.audio.load_paused(&row, &track, position).is_err() {
        return;
    }
    let _ = publish(app);
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
    match prev {
        Some(track) => play_id(app, &track.id)?,
        None => app.state::<AppState>().audio.seek(0.0)?,
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

fn saved_resume(app: &AppHandle) -> Option<(String, f64)> {
    let state = app.state::<AppState>();
    let db = state.db.lock().ok()?;
    let resume = db.get_resume_state().ok()??;
    let id = resume.track_id?;
    Some((id, resume.position_secs))
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

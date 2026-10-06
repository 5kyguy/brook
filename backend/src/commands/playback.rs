use tauri::State;

use crate::models::{PlaybackState, ResumeState};
use crate::playback_session::finalize_current_listen;
use crate::state::AppState;

#[tauri::command]
pub fn get_playback_state(state: State<'_, AppState>) -> Result<PlaybackState, String> {
    Ok(state.audio.state())
}

#[tauri::command]
pub fn get_resume_state(state: State<'_, AppState>) -> Result<Option<ResumeState>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_resume_state()
}

#[tauri::command]
pub fn save_resume_state(
    state: State<'_, AppState>,
    track_id: Option<String>,
    position_secs: f64,
) -> Result<(), String> {
    let queue_ids = state.session.queue_ids_for(track_id.as_deref());
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_resume_state(&ResumeState {
        track_id,
        position_secs,
        queue_ids,
    })
}

#[tauri::command]
pub fn load_track_paused(
    app: tauri::AppHandle,
    id: String,
    position_secs: f64,
) -> Result<(), String> {
    crate::session::adopt_paused(&app, &id, position_secs)
}

#[tauri::command]
pub fn play_track(state: State<'_, AppState>, id: String) -> Result<(), String> {
    finalize_current_listen(&state);

    let (track, track_row) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let row = db.get_track_row(&id)?;
        let track = db.get_track(&id)?;
        (track, row)
    };

    state.audio.play(&track_row, &track)?;
    // `playback:track-changed` is emitted by the audio thread after the
    // session opens successfully, so the frontend never sees a track-changed
    // for a file that failed to open.
    Ok(())
}

/// Tell the engine which track is next in the queue so it can preload it for a
/// gapless handoff. Pass `null` to drop the preload (end of queue).
#[tauri::command]
pub fn set_upcoming_track(state: State<'_, AppState>, id: Option<String>) -> Result<(), String> {
    let (row, track) = match id {
        Some(id) => {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let row = db.get_track_row(&id)?;
            let track = db.get_track(&id)?;
            (Some(row), Some(track))
        }
        None => (None, None),
    };
    state.audio.set_upcoming(row, track)
}

#[tauri::command]
pub fn pause(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.pause()
}

#[tauri::command]
pub fn resume(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.resume()
}

#[tauri::command]
pub fn seek(state: State<'_, AppState>, position_secs: f64) -> Result<(), String> {
    state.audio.seek(position_secs)
}

#[tauri::command]
pub fn set_volume(state: State<'_, AppState>, volume: f32) -> Result<(), String> {
    state.audio.set_volume(volume)
}

#[tauri::command]
pub fn set_visualizer_active(state: State<'_, AppState>, active: bool) -> Result<(), String> {
    state.audio.set_visualizer_active(active)
}

/// Stop playback without emitting `playback:ended` (used by MPRIS Stop).
#[tauri::command]
pub fn stop(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.stop()
}

/// Push shuffle/loop state to the MPRIS player (no-op off Linux).
#[cfg(target_os = "linux")]
#[tauri::command]
pub fn set_mpris_controls(
    app: tauri::AppHandle,
    shuffle: bool,
    repeat: String,
) -> Result<(), String> {
    crate::session::set_shuffle(&app, shuffle)?;
    crate::session::set_repeat(&app, crate::models::RepeatMode::parse(&repeat))?;
    Ok(())
}

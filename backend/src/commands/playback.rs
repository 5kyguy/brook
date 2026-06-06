use tauri::{AppHandle, Emitter, State};

use crate::models::PlaybackState;
use crate::playback_session::finalize_current_listen;
use crate::state::AppState;

#[tauri::command]
pub fn get_playback_state(state: State<'_, AppState>) -> Result<PlaybackState, String> {
    Ok(state.audio.state())
}

#[tauri::command]
pub fn play_track(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    finalize_current_listen(&state);

    let (track, track_row) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let row = db.get_track_row(&id)?;
        let track = db.get_track(&id)?;
        (track, row)
    };

    state.audio.play(&track_row)?;
    let _ = app.emit("playback:track-changed", track);
    Ok(())
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

use tauri::State;

use crate::models::PlaybackState;
use crate::state::AppState;

#[tauri::command]
pub fn get_playback_state(state: State<'_, AppState>) -> Result<PlaybackState, String> {
    let audio = state.audio.lock().map_err(|e| e.to_string())?;
    Ok(audio.state())
}

#[tauri::command]
pub fn play_track(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let track = db.get_track_row(&id)?;
    drop(db);

    let mut audio = state.audio.lock().map_err(|e| e.to_string())?;
    audio.load_track(&track)
}

#[tauri::command]
pub fn pause(state: State<'_, AppState>) -> Result<(), String> {
    let mut audio = state.audio.lock().map_err(|e| e.to_string())?;
    audio.pause()
}

#[tauri::command]
pub fn resume(state: State<'_, AppState>) -> Result<(), String> {
    let mut audio = state.audio.lock().map_err(|e| e.to_string())?;
    audio.resume()
}

#[tauri::command]
pub fn stop(state: State<'_, AppState>) -> Result<(), String> {
    let mut audio = state.audio.lock().map_err(|e| e.to_string())?;
    audio.stop()
}

#[tauri::command]
pub fn seek(state: State<'_, AppState>, position_secs: f64) -> Result<(), String> {
    let mut audio = state.audio.lock().map_err(|e| e.to_string())?;
    audio.seek(position_secs)
}

#[tauri::command]
pub fn set_volume(state: State<'_, AppState>, volume: f32) -> Result<(), String> {
    let mut audio = state.audio.lock().map_err(|e| e.to_string())?;
    audio.set_volume(volume)
}

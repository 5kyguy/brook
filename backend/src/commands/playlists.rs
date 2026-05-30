use tauri::State;

use crate::models::{Playlist, Track};
use crate::state::AppState;

#[tauri::command]
pub fn get_playlists(state: State<'_, AppState>) -> Result<Vec<Playlist>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_playlists()
}

#[tauri::command]
pub fn get_playlist_tracks(
    state: State<'_, AppState>,
    playlist_id: String,
) -> Result<Vec<Track>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_playlist_tracks(&playlist_id)
}

#[tauri::command]
pub fn create_playlist(state: State<'_, AppState>, name: String) -> Result<Playlist, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.create_playlist(&name)
}

#[tauri::command]
pub fn update_playlist(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
) -> Result<Playlist, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_playlist(&id, name.as_deref())
}

#[tauri::command]
pub fn delete_playlist(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_playlist(&id)
}

#[tauri::command]
pub fn add_to_playlist(
    state: State<'_, AppState>,
    playlist_id: String,
    track_id: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.add_to_playlist(&playlist_id, &track_id)
}

#[tauri::command]
pub fn remove_from_playlist(
    state: State<'_, AppState>,
    playlist_id: String,
    track_id: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.remove_from_playlist(&playlist_id, &track_id)
}

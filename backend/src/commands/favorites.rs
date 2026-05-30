use tauri::State;

use crate::models::Track;
use crate::state::AppState;

#[tauri::command]
pub fn toggle_favorite(state: State<'_, AppState>, track_id: String) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.toggle_favorite(&track_id)
}

#[tauri::command]
pub fn get_favorites(state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_favorites()
}

use tauri::{AppHandle, Emitter, State};

use crate::models::{FavoritesChangedPayload, Track};
use crate::state::AppState;

#[tauri::command]
pub fn toggle_favorite(
    app: AppHandle,
    state: State<'_, AppState>,
    track_id: String,
) -> Result<bool, String> {
    let liked = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.toggle_favorite(&track_id)?
    };
    let _ = app.emit(
        "db:favorites-changed",
        FavoritesChangedPayload {
            track_id: track_id.clone(),
            liked,
        },
    );
    Ok(liked)
}

#[tauri::command]
pub fn get_favorites(state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_favorites()
}

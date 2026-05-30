use tauri::State;

use crate::lyrics;
use crate::lyrics::LyricsResult;
use crate::state::AppState;

#[tauri::command]
pub fn read_lyrics(state: State<'_, AppState>, track_id: String) -> Result<LyricsResult, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let row = db.get_track_row(&track_id)?;
    lyrics::resolve_for_track(&row)
}

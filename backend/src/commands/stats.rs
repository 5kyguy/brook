use tauri::State;

use crate::models::{StatsSummary, Track, YearlyWrap};
use crate::state::AppState;

#[tauri::command]
pub fn get_stats(state: State<'_, AppState>) -> Result<StatsSummary, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_stats_summary()
}

#[tauri::command]
pub fn get_yearly_wrap(state: State<'_, AppState>, year: i32) -> Result<YearlyWrap, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_yearly_wrap(year)
}

#[tauri::command]
pub fn get_recent_tracks(state: State<'_, AppState>, limit: Option<usize>) -> Result<Vec<Track>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_recent_tracks(limit.unwrap_or(50))
}

#[tauri::command]
pub fn clear_play_history(state: State<'_, AppState>) -> Result<(), String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.clear_play_history()
}

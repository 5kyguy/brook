use tauri::State;

use crate::state::AppState;

/// Finalize the current listen session using live playback position (seconds).
pub fn finalize_current_listen(state: &State<'_, AppState>) {
    let playback = state.audio.state();
    let Some(track_id) = playback.track_id.clone() else {
        return;
    };
    let position = playback.position_secs;
    let duration = playback.duration_secs;
    if let Ok(mut db) = state.db.lock() {
        let _ = db.record_play(&track_id, position, duration);
    }
}

use std::path::Path;

use tauri::{AppHandle, Emitter, State};

use crate::metadata;
use crate::models::{ScanCompletePayload, ScanProgressPayload, ScanResult, Track, TrackFilter};
use crate::scanner;
use crate::state::AppState;

#[tauri::command]
pub fn get_music_root(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.music_root.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn scan_library(app: AppHandle, state: State<'_, AppState>) -> Result<ScanResult, String> {
    let music_root = state.music_root.clone();
    let files = scanner::scan_files(&music_root)?;
    let total = files.len();
    let mut added = 0usize;
    let mut updated = 0usize;

    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let existing_ids = db.list_track_ids()?;

    for (index, file) in files.iter().enumerate() {
        let _ = app.emit(
            "library:scan-progress",
            ScanProgressPayload {
                current: index + 1,
                total,
                path: Some(file.relative_path.clone()),
            },
        );

        let meta = metadata::read_metadata(Path::new(&file.absolute_path)).unwrap_or_default();
        let existed = existing_ids.contains(&file.id);
        db.upsert_track(file, &meta)?;
        if existed {
            updated += 1;
        } else {
            added += 1;
        }
    }

    let track_count = total;
    let _ = app.emit(
        "library:scan-complete",
        ScanCompletePayload { track_count },
    );

    Ok(ScanResult {
        track_count,
        added,
        updated,
    })
}

#[tauri::command]
pub fn get_tracks(
    state: State<'_, AppState>,
    filter: Option<TrackFilter>,
) -> Result<Vec<Track>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_tracks(filter.as_ref())
}

#[tauri::command]
pub fn get_track(state: State<'_, AppState>, id: String) -> Result<Track, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_track(&id)
}

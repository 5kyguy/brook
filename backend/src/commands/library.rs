use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};

use crate::cover_art::{self, AlbumArtPayload};
use crate::library_scan;
use crate::models::{LibraryFacets, Track, TrackFilter};
use crate::paths;
use crate::state::AppState;

fn resolve_music_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    paths::resolve_music_root(&db)
}

#[tauri::command]
pub fn get_music_root(state: State<'_, AppState>) -> Result<String, String> {
    Ok(resolve_music_root(&state)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn pick_music_folder() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("Choose your music folder")
        .pick_folder();
    Ok(folder.map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn set_music_root(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Music folder path cannot be empty".into());
    }
    let dir = PathBuf::from(trimmed);
    if !dir.is_dir() {
        return Err(format!("Not a folder: {trimmed}"));
    }
    let canonical = dir.canonicalize().map_err(|e| format!("Invalid folder: {e}"))?;
    apply_music_root(&state, canonical)
}

fn apply_music_root(state: &State<'_, AppState>, path: PathBuf) -> Result<String, String> {
    if !path.is_dir() {
        return Err(format!("Not a folder: {}", path.display()));
    }
    let path_str = path.to_string_lossy().into_owned();
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_setting("music_root", &path_str)?;
    db.reset_library_tracks()?;
    Ok(path_str)
}

#[tauri::command]
pub fn start_library_scan(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    library_scan::spawn_background_scan(app, state.inner());
    Ok(())
}

#[tauri::command]
pub fn get_library_facets(state: State<'_, AppState>) -> Result<LibraryFacets, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_library_facets()
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

#[tauri::command]
pub fn get_album_art(state: State<'_, AppState>, id: String) -> Result<Option<AlbumArtPayload>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let row = db.get_track_row(&id)?;
    cover_art::get_cover(
        &state.covers_dir,
        Path::new(&row.absolute_path),
        &row.id,
    )
}

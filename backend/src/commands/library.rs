use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, State};

use std::time::Instant;

use crate::cover_art::{self, AlbumArtPayload};
use crate::dev_log;
use crate::metadata;
use crate::models::{ScanCompletePayload, ScanProgressPayload, ScanResult, Track, TrackFilter};
use crate::paths;
use crate::scanner;
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

#[tauri::command]
pub fn reset_music_root(state: State<'_, AppState>) -> Result<String, String> {
    let default = paths::default_music_root()?;
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_setting("music_root")?;
    db.reset_library_tracks()?;
    Ok(default.to_string_lossy().into_owned())
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
pub fn scan_library(app: AppHandle, state: State<'_, AppState>) -> Result<ScanResult, String> {
    let timer = dev_log::Timer::new("scan", "scan_library");

    let music_root = resolve_music_root(&state)?;
    dev_log::append("scan", &format!("music_root={}", music_root.display()));

    let walk_start = Instant::now();
    let files = scanner::scan_files(&music_root)?;
    let walk_ms = walk_start.elapsed().as_millis();
    let total = files.len();
    timer.log_step(&format!("walkdir {total} files ({walk_ms}ms)"));

    let mut added = 0usize;
    let mut updated = 0usize;
    let mut skipped = 0usize;
    let mut metadata_reads = 0usize;
    let mut metadata_ms: u128 = 0;
    let mut upsert_ms: u128 = 0;
    let mut progress_emits = 0usize;

    let fp_start = Instant::now();
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let fingerprints = db.get_scan_fingerprints()?;
    let fp_ms = fp_start.elapsed().as_millis();
    timer.log_step(&format!(
        "fingerprints {} entries ({fp_ms}ms)",
        fingerprints.len()
    ));

    let scanned_ids: Vec<String> = files.iter().map(|f| f.id.clone()).collect();

    for (index, file) in files.iter().enumerate() {
        let _ = app.emit(
            "library:scan-progress",
            ScanProgressPayload {
                current: index + 1,
                total,
                path: Some(file.relative_path.clone()),
            },
        );
        progress_emits += 1;

        if let Some((stored_mtime, stored_size)) = fingerprints.get(&file.id) {
            if *stored_mtime == file.modified_ms as i64 && *stored_size == file.file_size as i64 {
                skipped += 1;
                continue;
            }
        }

        let meta_start = Instant::now();
        let meta = metadata::read_metadata(Path::new(&file.absolute_path)).unwrap_or_default();
        metadata_ms += meta_start.elapsed().as_millis();
        metadata_reads += 1;

        let existed = fingerprints.contains_key(&file.id);
        let upsert_start = Instant::now();
        db.upsert_track(file, &meta)?;
        upsert_ms += upsert_start.elapsed().as_millis();
        if existed {
            updated += 1;
        } else {
            added += 1;
        }
    }

    let prune_start = Instant::now();
    let removed = db.delete_tracks_not_in(&scanned_ids)?;
    let prune_ms = prune_start.elapsed().as_millis();
    let track_count = total;
    let _ = app.emit(
        "library:scan-complete",
        ScanCompletePayload { track_count },
    );

    let result = ScanResult {
        track_count,
        added,
        updated,
        skipped,
        removed,
    };

    timer.finish(format!(
        "total={total} added={added} updated={updated} skipped={skipped} removed={removed} \
         metadata_reads={metadata_reads} metadata_ms={metadata_ms} upsert_ms={upsert_ms} \
         prune_ms={prune_ms} progress_emits={progress_emits}"
    ));

    Ok(result)
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

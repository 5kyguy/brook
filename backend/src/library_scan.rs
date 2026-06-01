//! Library filesystem scan (blocking). Used by sync `scan_library` and background `start_library_scan`.

use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Instant;

use tauri::{AppHandle, Emitter, Manager};

use crate::dev_log;
use crate::metadata;
use crate::models::{ScanCompletePayload, ScanProgressPayload, ScanResult};
use crate::paths;
use crate::scanner;
use crate::state::AppState;

const UPSERT_BATCH_SIZE: usize = 50;
const PROGRESS_MIN_INTERVAL_MS: u128 = 150;
const PROGRESS_MIN_FILE_STEP: usize = 25;

struct ProgressEmitter {
    app: AppHandle,
    last_emit: Instant,
    last_emitted_index: usize,
    emit_count: usize,
}

impl ProgressEmitter {
    fn new(app: AppHandle) -> Self {
        Self {
            app,
            last_emit: Instant::now(),
            last_emitted_index: 0,
            emit_count: 0,
        }
    }

    fn maybe_emit(&mut self, current: usize, total: usize, path: Option<String>) {
        let is_first = current == 1;
        let is_last = current == total;
        let files_since = current.saturating_sub(self.last_emitted_index);
        let elapsed = self.last_emit.elapsed().as_millis();

        if !is_first
            && !is_last
            && files_since < PROGRESS_MIN_FILE_STEP
            && elapsed < PROGRESS_MIN_INTERVAL_MS
        {
            return;
        }

        let _ = self.app.emit(
            "library:scan-progress",
            ScanProgressPayload {
                current,
                total,
                path,
            },
        );
        self.emit_count += 1;
        self.last_emit = Instant::now();
        self.last_emitted_index = current;
    }

    fn emit_count(&self) -> usize {
        self.emit_count
    }
}

struct UpsertBatch<'a> {
    db: &'a mut crate::db::Database,
    open: bool,
    count: usize,
}

impl<'a> UpsertBatch<'a> {
    fn new(db: &'a mut crate::db::Database) -> Self {
        Self {
            db,
            open: false,
            count: 0,
        }
    }

    fn upsert(
        &mut self,
        file: &scanner::ScannedFile,
        meta: &metadata::TrackMetadata,
    ) -> Result<(), String> {
        if !self.open {
            self.db.begin_batch()?;
            self.open = true;
            self.count = 0;
        }
        self.db.upsert_track(file, meta)?;
        self.count += 1;
        if self.count >= UPSERT_BATCH_SIZE {
            self.commit()?;
        }
        Ok(())
    }

    fn commit(&mut self) -> Result<(), String> {
        if self.open {
            self.db.commit_batch()?;
            self.open = false;
            self.count = 0;
        }
        Ok(())
    }
}

impl Drop for UpsertBatch<'_> {
    fn drop(&mut self) {
        let _ = self.commit();
    }
}

/// Walk the music library, update SQLite, emit progress/complete events.
pub fn perform_library_scan(app: &AppHandle, state: &AppState) -> Result<ScanResult, String> {
    let timer = dev_log::Timer::new("scan", "perform_library_scan");

    let music_root = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        paths::resolve_music_root(&db)?
    };
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

    let fp_start = Instant::now();
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let fingerprints = db.get_scan_fingerprints()?;
    let fp_ms = fp_start.elapsed().as_millis();
    timer.log_step(&format!(
        "fingerprints {} entries ({fp_ms}ms)",
        fingerprints.len()
    ));

    let scanned_ids: Vec<String> = files.iter().map(|f| f.id.clone()).collect();
    let mut progress = ProgressEmitter::new(app.clone());
    let mut batch = UpsertBatch::new(&mut db);

    for (index, file) in files.iter().enumerate() {
        let current = index + 1;

        if let Some((stored_mtime, stored_size)) = fingerprints.get(&file.id) {
            if *stored_mtime == file.modified_ms as i64 && *stored_size == file.file_size as i64 {
                skipped += 1;
                progress.maybe_emit(current, total, None);
                continue;
            }
        }

        let meta_start = Instant::now();
        let meta = metadata::read_metadata(Path::new(&file.absolute_path)).unwrap_or_default();
        metadata_ms += meta_start.elapsed().as_millis();
        metadata_reads += 1;

        let existed = fingerprints.contains_key(&file.id);
        let upsert_start = Instant::now();
        batch.upsert(file, &meta)?;
        upsert_ms += upsert_start.elapsed().as_millis();

        progress.maybe_emit(
            current,
            total,
            Some(file.relative_path.clone()),
        );

        if existed {
            updated += 1;
        } else {
            added += 1;
        }
    }

    batch.commit()?;
    drop(batch);

    let prune_start = Instant::now();
    let removed = db.delete_tracks_not_in(&scanned_ids)?;
    let prune_ms = prune_start.elapsed().as_millis();

    if total > 0 && progress.emit_count() == 0 {
        progress.maybe_emit(total, total, None);
    }

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
         prune_ms={prune_ms} progress_emits={}",
        progress.emit_count()
    ));

    Ok(result)
}

/// Spawn a background scan if none is running.
pub fn spawn_background_scan(app: AppHandle, state: &AppState) {
    if state
        .scan_in_progress
        .swap(true, Ordering::AcqRel)
    {
        dev_log::append("scan", "start_library_scan skipped (already running)");
        return;
    }

    tauri::async_runtime::spawn(async move {
        let app_for_scan = app.clone();
        let scan_result = tauri::async_runtime::spawn_blocking(move || {
            let state = app_for_scan.state::<AppState>();
            perform_library_scan(&app_for_scan, state.inner())
        })
        .await;

        let state = app.state::<AppState>();
        state
            .scan_in_progress
            .store(false, Ordering::Release);

        match scan_result {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => dev_log::append("scan", &format!("background scan error: {e}")),
            Err(e) => dev_log::append("scan", &format!("background scan join error: {e}")),
        }
    });
}

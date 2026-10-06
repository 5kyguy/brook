//! Library filesystem scan (blocking). Used by background `start_library_scan`.

use std::path::Path;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use rayon::prelude::*;
use tauri::{AppHandle, Emitter, Manager};

use crate::dev_log;
use crate::metadata;
use crate::models::{ScanCompletePayload, ScanProgressPayload, ScanResult};
use crate::paths;
use crate::scanner;
use crate::state::AppState;

const UPSERT_BATCH_SIZE: usize = 50;
const PROGRESS_MIN_INTERVAL_MS: u64 = 150;
const PROGRESS_MIN_FILE_STEP: usize = 25;

/// Thread-safe scan-progress emitter shared between the serial skip pass and
/// the parallel Rayon tag-read pool. `current` is a monotonic processed count, so
/// out-of-order parallel completions still produce a forward-moving bar.
struct ScanProgress {
    app: AppHandle,
    total: usize,
    processed: AtomicUsize,
    last_emit_ms: AtomicU64,
    last_emitted_index: AtomicUsize,
    emits: AtomicUsize,
    start: Instant,
}

impl ScanProgress {
    fn new(app: AppHandle, total: usize) -> Self {
        Self {
            app,
            total,
            processed: AtomicUsize::new(0),
            last_emit_ms: AtomicU64::new(0),
            last_emitted_index: AtomicUsize::new(0),
            emits: AtomicUsize::new(0),
            start: Instant::now(),
        }
    }

    fn advance(&self, path: Option<String>) {
        let current = self.processed.fetch_add(1, Ordering::Relaxed) + 1;
        let now_ms = self.start.elapsed().as_millis() as u64;
        let last_ms = self.last_emit_ms.load(Ordering::Relaxed);
        let last_index = self.last_emitted_index.load(Ordering::Relaxed);
        let is_last = current == self.total;
        let files_since = current.saturating_sub(last_index);
        if !is_last
            && files_since < PROGRESS_MIN_FILE_STEP
            && now_ms.saturating_sub(last_ms) < PROGRESS_MIN_INTERVAL_MS
        {
            return;
        }
        // Claim the slot with the time stamp so only one worker emits at a time.
        if self
            .last_emit_ms
            .compare_exchange(last_ms, now_ms, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            let _ = self.app.emit(
                "library:scan-progress",
                ScanProgressPayload {
                    current,
                    total: self.total,
                    path,
                },
            );
            self.emits.fetch_add(1, Ordering::Relaxed);
            self.last_emitted_index.store(current, Ordering::Release);
        }
    }

    fn emits(&self) -> usize {
        self.emits.load(Ordering::Relaxed)
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

    let fp_start = Instant::now();
    let fingerprints = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.get_scan_fingerprints()?
    };
    let fp_ms = fp_start.elapsed().as_millis();
    timer.log_step(&format!(
        "fingerprints {} entries ({fp_ms}ms)",
        fingerprints.len()
    ));

    let scanned_ids: Vec<String> = files.iter().map(|f| f.id.clone()).collect();
    let progress = Arc::new(ScanProgress::new(app.clone(), total));

    // Serial pass: keep the mtime/size skip, split the files that need a tag
    // read from the ones that don't. Skip emits progress here; the parallel
    // read emits progress from its workers.
    let mut needs_read: Vec<&scanner::ScannedFile> = Vec::new();
    for file in files.iter() {
        if let Some((stored_mtime, stored_size)) = fingerprints.get(&file.id) {
            if *stored_mtime == file.modified_ms as i64 && *stored_size == file.file_size as i64 {
                skipped += 1;
                progress.advance(None);
                continue;
            }
        }
        needs_read.push(file);
    }

    // Parallel tag reads on a Rayon pool. The walk is already fast; lofty tag
    // reads are the cost, so they are the only thing parallelized. The DB
    // is not touched here — the lock is released so playback and other
    // commands can proceed during the read. Cap the pool at 4 threads to
    // leave headroom for the audio thread and the rest of the desktop.
    let read_start = Instant::now();
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .build()
        .map_err(|e| format!("Failed to build scan thread pool: {e}"))?;
    let results: Vec<(&scanner::ScannedFile, metadata::TrackMetadata)> = pool.install(|| {
        needs_read
            .par_iter()
            .map(|file| {
                let meta =
                    metadata::read_metadata(Path::new(&file.absolute_path)).unwrap_or_default();
                progress.advance(Some(file.relative_path.clone()));
                (*file, meta)
            })
            .collect()
    });
    let metadata_ms = read_start.elapsed().as_millis();
    let metadata_reads = needs_read.len();

    // Serial upsert into one batched writer. Order is restored so the DB
    // rows match the sorted file order.
    let upsert_start = Instant::now();
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let mut batch = UpsertBatch::new(&mut db);
    for (file, meta) in results {
        let existed = fingerprints.contains_key(&file.id);
        batch.upsert(file, &meta)?;
        if existed {
            updated += 1;
        } else {
            added += 1;
        }
    }

    batch.commit()?;
    drop(batch);

    let upsert_ms = upsert_start.elapsed().as_millis();

    let prune_start = Instant::now();
    let removed = db.delete_tracks_not_in(&scanned_ids)?;
    let prune_ms = prune_start.elapsed().as_millis();

    if total > 0 && progress.emits() == 0 {
        progress.advance(None);
    }

    let track_count = total;
    let _ = app.emit("library:scan-complete", ScanCompletePayload { track_count });

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
        progress.emits()
    ));

    Ok(result)
}

/// Spawn a background scan if none is running.
pub fn spawn_background_scan(app: AppHandle, state: &AppState) {
    if state.scan_in_progress.swap(true, Ordering::AcqRel) {
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
        state.scan_in_progress.store(false, Ordering::Release);

        match scan_result {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => dev_log::append("scan", &format!("background scan error: {e}")),
            Err(e) => dev_log::append("scan", &format!("background scan join error: {e}")),
        }
    });
}

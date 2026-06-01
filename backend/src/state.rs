use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use tauri::AppHandle;

use crate::audio::Engine;
use crate::db::Database;

pub struct AppState {
    pub db: Mutex<Database>,
    pub audio: Engine,
    pub covers_dir: PathBuf,
    pub scan_in_progress: AtomicBool,
}

impl AppState {
    pub fn new(db: Database, app: AppHandle, covers_dir: PathBuf) -> Self {
        Self {
            db: Mutex::new(db),
            audio: Engine::new(app),
            covers_dir,
            scan_in_progress: AtomicBool::new(false),
        }
    }
}

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::AppHandle;

use crate::audio::Engine;
use crate::db::Database;

pub struct AppState {
    pub db: Mutex<Database>,
    pub audio: Engine,
    pub covers_dir: PathBuf,
    pub peaks_dir: PathBuf,
}

impl AppState {
    pub fn new(db: Database, app: AppHandle, covers_dir: PathBuf, peaks_dir: PathBuf) -> Self {
        Self {
            db: Mutex::new(db),
            audio: Engine::new(app),
            covers_dir,
            peaks_dir,
        }
    }
}

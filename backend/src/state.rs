use std::path::PathBuf;
use std::sync::Mutex;

use tauri::AppHandle;

use crate::audio::Engine;
use crate::db::Database;

pub struct AppState {
    pub db: Mutex<Database>,
    pub audio: Engine,
    pub music_root: PathBuf,
}

impl AppState {
    pub fn new(db: Database, music_root: PathBuf, app: AppHandle) -> Self {
        Self {
            db: Mutex::new(db),
            audio: Engine::new(app),
            music_root,
        }
    }
}

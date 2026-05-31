use std::sync::Mutex;

use tauri::AppHandle;

use crate::audio::Engine;
use crate::db::Database;

pub struct AppState {
    pub db: Mutex<Database>,
    pub audio: Engine,
}

impl AppState {
    pub fn new(db: Database, app: AppHandle) -> Self {
        Self {
            db: Mutex::new(db),
            audio: Engine::new(app),
        }
    }
}

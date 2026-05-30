use std::path::PathBuf;
use std::sync::Mutex;

use crate::audio::Engine;
use crate::db::Database;

pub struct AppState {
    pub db: Mutex<Database>,
    pub audio: Mutex<Engine>,
    pub music_root: PathBuf,
}

impl AppState {
    pub fn new(db: Database, music_root: PathBuf) -> Self {
        Self {
            db: Mutex::new(db),
            audio: Mutex::new(Engine::new()),
            music_root,
        }
    }
}

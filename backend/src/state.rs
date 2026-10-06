use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use tauri::AppHandle;

use crate::audio::Engine;
use crate::db::Database;
use crate::session::Session;

#[cfg(target_os = "linux")]
pub type MprisHandle = Option<crate::audio::mpris::MprisHandle>;
#[cfg(not(target_os = "linux"))]
pub type MprisHandle = Option<()>;

pub struct AppState {
    pub db: Mutex<Database>,
    pub audio: Engine,
    pub covers_dir: PathBuf,
    pub scan_in_progress: AtomicBool,
    pub mpris: MprisHandle,
    pub session: Session,
    /// Started with `--headless`. Closing the window hides it and leaves playback running.
    pub started_headless: bool,
}

impl AppState {
    pub fn new(
        db: Database,
        app: AppHandle,
        covers_dir: PathBuf,
        mpris: MprisHandle,
        started_headless: bool,
    ) -> Self {
        Self {
            db: Mutex::new(db),
            audio: Engine::new(app),
            covers_dir,
            scan_in_progress: AtomicBool::new(false),
            mpris,
            session: Session::new(),
            started_headless,
        }
    }
}

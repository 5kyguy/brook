use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::theme::{self, SharedTheme, ThemeWatch};

pub struct ThemeHub {
    current: Arc<Mutex<SharedTheme>>,
    _watch: ThemeWatch,
}

pub fn install(app: &AppHandle) -> Result<(), String> {
    let current = Arc::new(Mutex::new(theme::load_theme_file(&theme::theme_file_path())));
    let watched = Arc::clone(&current);
    let handle = app.clone();
    let watch = ThemeWatch::spawn(theme::theme_file_path(), move |snapshot| {
        if let Ok(mut guard) = watched.lock() {
            if guard.revision == snapshot.revision {
                return;
            }
            *guard = snapshot.clone();
        }
        let _ = handle.emit("theme:changed", snapshot);
    });
    app.manage(ThemeHub {
        current,
        _watch: watch,
    });
    Ok(())
}

#[tauri::command]
pub fn get_shared_theme(hub: State<'_, ThemeHub>) -> SharedTheme {
    hub.current
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_else(|_| theme::monochrome_theme())
}

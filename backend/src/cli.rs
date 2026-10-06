//! Flags the desktop bar can call without opening a second window.
//!
//! `--search` runs in this process and prints JSON. The play flags are applied
//! by the running session (see `lib.rs`).

use std::path::PathBuf;

use crate::db::Database;

pub fn db_path() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".local/share")
    });
    base.join("dev.skyguy.brook").join("brook.db")
}

/// Print `{ "tracks", "playlists" }` and return. Missing library is an empty result.
pub fn print_search(query: &str) -> Result<(), String> {
    let path = db_path();
    if !path.is_file() {
        println!(r#"{{"tracks":[],"playlists":[]}}"#);
        return Ok(());
    }
    let db = Database::open_readonly(&path)?;
    println!("{}", db.search_library_json(query)?);
    Ok(())
}

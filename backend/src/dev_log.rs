//! Debug-only file logging to `<repo>/logs/` (dev builds only).

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use chrono::Utc;

static LOG_LOCK: Mutex<()> = Mutex::new(());

/// Repo-root `logs/` directory (`backend/../logs` at compile time).
fn logs_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../logs")
}

pub fn log_file_path() -> PathBuf {
    logs_dir().join("brook.log")
}

fn timestamp_rfc3339_ms() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn enabled() -> bool {
    cfg!(debug_assertions)
}

pub fn append(source: &str, message: &str) {
    if !enabled() {
        return;
    }

    let Ok(_guard) = LOG_LOCK.lock() else {
        return;
    };

    let dir = logs_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }

    let line = format!(
        "{} [{}] {}\n",
        timestamp_rfc3339_ms(),
        source,
        message
    );

    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file_path())
    {
        let _ = file.write_all(line.as_bytes());
    }
}

pub struct Timer {
    source: &'static str,
    label: String,
    start: Instant,
}

impl Timer {
    pub fn new(source: &'static str, label: impl Into<String>) -> Self {
        let label = label.into();
        append(source, &format!("{label} start"));
        Self {
            source,
            label,
            start: Instant::now(),
        }
    }

    fn elapsed_ms(&self) -> u128 {
        self.start.elapsed().as_millis()
    }

    pub fn log_step(&self, step: &str) {
        append(
            self.source,
            &format!("{} … {} ({}ms)", self.label, step, self.elapsed_ms()),
        );
    }

    pub fn finish(self, detail: impl AsRef<str>) {
        append(
            self.source,
            &format!(
                "{} done {}ms — {}",
                self.label,
                self.elapsed_ms(),
                detail.as_ref()
            ),
        );
    }
}

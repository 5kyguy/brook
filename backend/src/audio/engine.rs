use std::fs;
use std::path::Path;

use crate::db::TrackRow;
use crate::models::{PlaybackState, PlaybackStatus};

/// Rust audio engine stub. Reads the full file into memory; symphonia + rodio output
/// will be wired here next.
pub struct Engine {
    state: PlaybackState,
    loaded_bytes: Option<Vec<u8>>,
    loaded_track_id: Option<String>,
}

impl Engine {
    pub fn new() -> Self {
        Self {
            state: PlaybackState::default(),
            loaded_bytes: None,
            loaded_track_id: None,
        }
    }

    pub fn state(&self) -> PlaybackState {
        self.state.clone()
    }

    pub fn load_track(&mut self, track: &TrackRow) -> Result<(), String> {
        let bytes = fs::read(Path::new(&track.absolute_path)).map_err(|e| {
            format!(
                "Failed to read audio file {}: {e}",
                track.absolute_path
            )
        })?;

        self.loaded_bytes = Some(bytes);
        self.loaded_track_id = Some(track.id.clone());
        self.state.track_id = Some(track.id.clone());
        self.state.duration_secs = track.duration_secs.unwrap_or(0.0);
        self.state.position_secs = 0.0;
        self.state.status = PlaybackStatus::Paused;
        Ok(())
    }

    pub fn pause(&mut self) -> Result<(), String> {
        if self.loaded_track_id.is_none() {
            return Err("No track loaded".into());
        }
        self.state.status = PlaybackStatus::Paused;
        Ok(())
    }

    pub fn resume(&mut self) -> Result<(), String> {
        if self.loaded_track_id.is_none() {
            return Err("No track loaded".into());
        }
        self.state.status = PlaybackStatus::Playing;
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), String> {
        self.loaded_bytes = None;
        self.loaded_track_id = None;
        self.state = PlaybackState {
            volume: self.state.volume,
            ..PlaybackState::default()
        };
        Ok(())
    }

    pub fn seek(&mut self, position_secs: f64) -> Result<(), String> {
        if self.loaded_track_id.is_none() {
            return Err("No track loaded".into());
        }
        self.state.position_secs = position_secs.clamp(0.0, self.state.duration_secs);
        Ok(())
    }

    pub fn set_volume(&mut self, volume: f32) -> Result<(), String> {
        self.state.volume = volume.clamp(0.0, 1.0);
        Ok(())
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

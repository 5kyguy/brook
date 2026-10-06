//! In-memory play queue. The frontend renders this; it does not own it.
//!
//! Behavior matches the previous TypeScript queue: shuffle keeps the current
//! track in place, repeat-one reports the current track as next, and clearing
//! keeps the current track.

use crate::models::{QueueSnapshot, RepeatMode, Track};

#[derive(Debug, Clone)]
pub struct PlaybackQueue {
    tracks: Vec<Track>,
    original: Vec<Track>,
    index: i32,
    shuffle: bool,
    repeat: RepeatMode,
}

impl Default for PlaybackQueue {
    fn default() -> Self {
        Self {
            tracks: Vec::new(),
            original: Vec::new(),
            index: -1,
            shuffle: false,
            repeat: RepeatMode::Off,
        }
    }
}

impl PlaybackQueue {
    pub fn snapshot(&self) -> QueueSnapshot {
        QueueSnapshot {
            tracks: self.tracks.clone(),
            current_id: self.current().map(|track| track.id.clone()),
            next_id: self.next().map(|track| track.id.clone()),
            shuffle: self.shuffle,
            repeat: self.repeat,
        }
    }

    pub fn repeat(&self) -> RepeatMode {
        self.repeat
    }

    pub fn is_shuffled(&self) -> bool {
        self.shuffle
    }

    pub fn current(&self) -> Option<&Track> {
        self.tracks.get(self.index as usize)
    }

    pub fn next(&self) -> Option<&Track> {
        if self.repeat == RepeatMode::One {
            return self.current();
        }
        if self.index >= 0 && (self.index as usize) + 1 < self.tracks.len() {
            return self.tracks.get(self.index as usize + 1);
        }
        if self.repeat == RepeatMode::All && !self.tracks.is_empty() {
            return self.tracks.first();
        }
        None
    }

    pub fn set_queue(&mut self, tracks: Vec<Track>, current_id: &str) {
        self.original = tracks;
        self.apply_shuffle(Some(current_id));
        self.sync_index(current_id);
    }

    /// Point the index at `track_id` after the engine has already started it.
    pub fn note_playing(&mut self, track_id: &str) {
        if let Some(index) = self.tracks.iter().position(|track| track.id == track_id) {
            self.index = index as i32;
        }
    }

    pub fn advance(&mut self) -> Option<Track> {
        let next = self.next().cloned()?;
        self.index = self
            .tracks
            .iter()
            .position(|track| track.id == next.id)
            .map(|index| index as i32)
            .unwrap_or(-1);
        (self.index >= 0).then_some(next)
    }

    pub fn retreat(&mut self) -> Option<Track> {
        let prev = self.prev().cloned()?;
        self.index = self
            .tracks
            .iter()
            .position(|track| track.id == prev.id)
            .map(|index| index as i32)
            .unwrap_or(-1);
        (self.index >= 0).then_some(prev)
    }

    pub fn insert_next(&mut self, track: Track) {
        let Some(current) = self.current().cloned() else {
            self.original = vec![track.clone()];
            self.tracks = vec![track];
            self.index = 0;
            return;
        };

        self.remove_from_lists(&track.id);
        let orig_idx = self.original.iter().position(|item| item.id == current.id);
        let insert_at = orig_idx
            .map(|index| index + 1)
            .unwrap_or(self.original.len());
        self.original.insert(insert_at, track);
        self.apply_shuffle(Some(current.id.as_str()));
        self.sync_index(&current.id);
    }

    pub fn append(&mut self, track: Track) {
        let current_id = self.current().map(|item| item.id.clone());
        if current_id.as_deref() == Some(track.id.as_str()) {
            return;
        }
        if self.original.iter().any(|item| item.id == track.id) {
            return;
        }
        self.original.push(track);
        self.apply_shuffle(current_id.as_deref());
        if let Some(id) = current_id.as_deref() {
            self.sync_index(id);
        }
    }

    /// Returns the track that is now current when the removed track was playing.
    pub fn remove(&mut self, track_id: &str) -> Option<Track> {
        let was_current = self.current().is_some_and(|track| track.id == track_id);
        self.remove_from_lists(track_id);
        if was_current && !self.tracks.is_empty() {
            self.index = self.index.min(self.tracks.len() as i32 - 1);
        } else if self.tracks.is_empty() {
            self.index = -1;
        } else if self.index >= self.tracks.len() as i32 {
            self.index = self.tracks.len() as i32 - 1;
        }
        was_current.then(|| self.current().cloned()).flatten()
    }

    pub fn jump_to(&mut self, track_id: &str) -> Option<Track> {
        let index = self.tracks.iter().position(|track| track.id == track_id)?;
        self.index = index as i32;
        self.current().cloned()
    }

    pub fn clear(&mut self) {
        if let Some(current) = self.current().cloned() {
            self.original = vec![current.clone()];
            self.tracks = vec![current];
            self.index = 0;
        } else {
            self.original.clear();
            self.tracks.clear();
            self.index = -1;
        }
    }

    pub fn reorder(&mut self, from_index: usize, to_index: usize) {
        if from_index == to_index {
            return;
        }
        if from_index >= self.tracks.len() || to_index >= self.tracks.len() {
            return;
        }
        let current_id = self.current().map(|track| track.id.clone());
        let item = self.tracks.remove(from_index);
        self.tracks.insert(to_index, item);
        if let Some(id) = current_id.as_deref() {
            self.sync_index(id);
        }
        if !self.shuffle {
            self.original = self.tracks.clone();
        }
    }

    pub fn toggle_shuffle(&mut self) -> bool {
        self.shuffle = !self.shuffle;
        let current_id = self.current().map(|track| track.id.clone());
        if !self.shuffle {
            self.original = self.tracks.clone();
        }
        self.apply_shuffle(current_id.as_deref());
        if let Some(id) = current_id.as_deref() {
            self.sync_index(id);
        }
        self.shuffle
    }

    pub fn set_shuffle(&mut self, shuffle: bool) -> bool {
        if self.shuffle != shuffle {
            self.toggle_shuffle();
        }
        self.shuffle
    }

    pub fn cycle_repeat(&mut self) -> RepeatMode {
        self.repeat = match self.repeat {
            RepeatMode::Off => RepeatMode::All,
            RepeatMode::All => RepeatMode::One,
            RepeatMode::One => RepeatMode::Off,
        };
        self.repeat
    }

    pub fn set_repeat(&mut self, repeat: RepeatMode) {
        self.repeat = repeat;
    }

    fn prev(&self) -> Option<&Track> {
        if self.index > 0 {
            return self.tracks.get((self.index as usize) - 1);
        }
        if self.repeat == RepeatMode::All && !self.tracks.is_empty() {
            return self.tracks.last();
        }
        None
    }

    fn apply_shuffle(&mut self, current_id: Option<&str>) {
        if self.shuffle {
            self.tracks = shuffle_keep_current(&self.original, current_id);
        } else {
            self.tracks = self.original.clone();
        }
    }

    fn sync_index(&mut self, current_id: &str) {
        self.index = self
            .tracks
            .iter()
            .position(|track| track.id == current_id)
            .map(|index| index as i32)
            .unwrap_or(-1);
    }

    fn remove_from_lists(&mut self, track_id: &str) {
        self.original.retain(|track| track.id != track_id);
        self.tracks.retain(|track| track.id != track_id);
        if self.index >= self.tracks.len() as i32 {
            self.index = self.tracks.len() as i32 - 1;
        }
    }
}

fn shuffle_keep_current(tracks: &[Track], current_id: Option<&str>) -> Vec<Track> {
    let current = current_id.and_then(|id| tracks.iter().find(|track| track.id == id).cloned());
    let mut rest: Vec<Track> = tracks
        .iter()
        .filter(|track| Some(track.id.as_str()) != current_id)
        .cloned()
        .collect();
    let mut rng = Rng::from_time();
    for i in (1..rest.len()).rev() {
        let j = rng.gen_index(i + 1);
        rest.swap(i, j);
    }
    match current {
        Some(track) => {
            let mut shuffled = Vec::with_capacity(rest.len() + 1);
            shuffled.push(track);
            shuffled.extend(rest);
            shuffled
        }
        None => rest,
    }
}

struct Rng(u64);

impl Rng {
    fn from_time() -> Self {
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos() as u64)
            .unwrap_or(0xB100_u64);
        Self(seed | 1)
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn gen_index(&mut self, exclusive: usize) -> usize {
        if exclusive == 0 {
            return 0;
        }
        (self.next_u64() as usize) % exclusive
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: &str) -> Track {
        Track {
            id: id.to_string(),
            relative_path: id.to_string(),
            absolute_path: id.to_string(),
            extension: "mp3".to_string(),
            file_size: 0,
            modified_ms: 0,
            title: Some(id.to_string()),
            artist: None,
            album: None,
            year: None,
            duration_secs: Some(10.0),
            has_lrc: false,
            is_favorite: false,
        }
    }

    fn queue_of(ids: &[&str], current: &str) -> PlaybackQueue {
        let mut queue = PlaybackQueue::default();
        queue.set_queue(ids.iter().copied().map(track).collect(), current);
        queue
    }

    #[test]
    fn advance_stays_inside_the_queued_album() {
        let mut queue = queue_of(&["album/10.flac", "album/2.flac"], "album/10.flac");
        assert_eq!(queue.advance().unwrap().id, "album/2.flac");
        assert!(queue.advance().is_none());
        assert_eq!(
            queue.current().map(|track| track.id.as_str()),
            Some("album/2.flac")
        );
    }

    #[test]
    fn next_stops_at_end_until_repeat_all() {
        let mut queue = queue_of(&["a", "b"], "b");
        assert!(queue.next().is_none());
        queue.set_repeat(RepeatMode::All);
        assert_eq!(queue.next().map(|track| track.id.as_str()), Some("a"));
        let advanced = queue.advance().unwrap();
        assert_eq!(advanced.id, "a");
        assert_eq!(queue.current().map(|track| track.id.as_str()), Some("a"));
    }

    #[test]
    fn repeat_one_next_is_current() {
        let mut queue = queue_of(&["a", "b"], "a");
        queue.set_repeat(RepeatMode::One);
        assert_eq!(queue.next().map(|track| track.id.as_str()), Some("a"));
        queue.advance().unwrap();
        assert_eq!(queue.current().map(|track| track.id.as_str()), Some("a"));
    }

    #[test]
    fn remove_current_slides_to_the_following_track() {
        let mut queue = queue_of(&["a", "b", "c"], "b");
        let now = queue.remove("b").unwrap();
        assert_eq!(now.id, "c");
        assert_eq!(queue.snapshot().tracks.len(), 2);
    }

    #[test]
    fn clear_keeps_the_current_track() {
        let mut queue = queue_of(&["a", "b", "c"], "b");
        queue.clear();
        let snap = queue.snapshot();
        assert_eq!(snap.tracks.len(), 1);
        assert_eq!(snap.current_id.as_deref(), Some("b"));
        assert!(snap.next_id.is_none());
    }

    #[test]
    fn shuffle_keeps_current_first() {
        let mut queue = queue_of(&["a", "b", "c", "d"], "c");
        assert!(queue.toggle_shuffle());
        assert_eq!(queue.current().map(|track| track.id.as_str()), Some("c"));
        assert_eq!(queue.snapshot().tracks.len(), 4);
    }

    #[test]
    fn cycle_repeat_order() {
        let mut queue = PlaybackQueue::default();
        assert_eq!(queue.cycle_repeat(), RepeatMode::All);
        assert_eq!(queue.cycle_repeat(), RepeatMode::One);
        assert_eq!(queue.cycle_repeat(), RepeatMode::Off);
    }
}

pub mod library;
pub mod lyrics;
pub mod favorites;
pub mod playlists;
pub mod playback;
pub mod stats;

pub use favorites::{get_favorites, toggle_favorite};
pub use library::{get_music_root, get_track, get_tracks, scan_library};
pub use lyrics::read_lyrics;
pub use playback::{
    get_playback_state, pause, play_track, resume, seek, set_volume, stop,
};
pub use playlists::{
    add_to_playlist, create_playlist, delete_playlist, get_playlist_tracks, get_playlists,
    remove_from_playlist, update_playlist,
};
pub use stats::{clear_play_history, get_recent_tracks, get_stats, get_yearly_wrap};

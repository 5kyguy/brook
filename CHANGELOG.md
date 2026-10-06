# Changelog

## 0.1.0

### Playback

- Each track decodes while it plays, from a short buffer, and the next queue track is ready before the current one ends
- ReplayGain track gain is applied at playback from file tags, and the files stay unchanged
- Launch restores the last track paused at the saved position
- Media keys and MPRIS can play, pause, seek, change volume, and move through the queue
- `brook --headless` starts playback with no window, and `brook --quit` stops that process
- A later `brook` opens the window on the running session

### Library

- Smart playlists follow saved rules, with a sort and a limit
- Clicking a synced lyric line seeks playback to that time
- Large libraries stay responsive: scans read tags in parallel, lists load a page at a time, and only the visible rows are drawn

### Appearance

- The interface follows the local desktop accent while offline, and uses the bundled monochrome theme when no accent is available
- The shell uses Newsreader and Manrope

### Install

- `brook --uninstall` removes the AppImage, the `brook` command, the desktop entry, and the icon
- `brook --uninstall --clear-history` also removes listening history and cached cover art
- Playlists, likes, and the music folder stay

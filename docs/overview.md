# Brook overview

Brook is a fully offline desktop music player. It reads audio from your local library, plays files via a Rust engine, and presents a Monochrome-inspired UI in Tauri 2.

**No network required.** Brook does not stream, scrobble, sync to cloud services, or fetch lyrics online.

## What Brook is

- Local music player for `$HOME/Music` (default library path)
- Likes, playlists, and library browse with sort/filter by album, artist, and year
- Sidecar `.lrc` lyrics, with fallback to embedded ID3/metadata lyrics
- Listening statistics and a simple yearly wrap view
- Rust audio engine: each track is loaded fully into memory before playback
- **Read-only library** — files in `$HOME/Music` are never re-encoded, transcoded, or tag-edited by Brook

## What Brook is not

- A streaming client (no TIDAL, Spotify, etc.)
- A web app that plays audio in the browser via `<audio>` or blob URLs
- Dependent on accounts, API keys, or internet connectivity

## Library layout

Brook walks `$HOME/Music` recursively. Any folder structure works; a typical layout:

```bash
~/Music/
├── Artist_Track.mp3    # audio file
└── Artist_Track.lrc    # optional synced lyrics
```

## Supported formats

| Extension | Scan | Playback |
| --------- | ---- | -------- |
| `.mp3` | Yes | Yes |
| `.flac` | Yes | Yes |
| `.m4a` | Yes | Yes |
| `.aac` | Yes | Best-effort |
| `.ogg` | Yes | Best-effort |
| `.opus` | Yes | Best-effort |
| `.wav` | Yes | Yes |

Exact decode support depends on `symphonia` features in the Rust backend.

## Lyrics

Brook resolves lyrics in this order:

1. **Sidecar file** — `{same-filename}.lrc` next to the audio file
2. **Embedded tags** — lyrics stored in file metadata (USLT, etc.)
3. **None** — lyrics UI is hidden if neither is available

## Library integrity

Brook treats your music folder as the source of truth:

- **No writes** to audio files under `$HOME/Music`
- **No transcoding** — original bit depth, sample rate, and codec are preserved on disk
- **Metadata is read-only** — tags are read at scan and cached in SQLite for browsing; embedded tags in the file are not modified
- Re-scan picks up changes if you edit tags or replace files outside the app

## Playback model

Audio is decoded and played entirely in Rust:

- The full file is read into memory (`std::fs::read`)
- Decode is for playback output only — the file on disk is unchanged
- No blob URLs, no HTML5 media element, no streaming/chunked loading
- Large FLAC files use more RAM by design

Playback state reaches the UI through Tauri events (position, state, track changes).

## Roadmap

- [x] Backend scaffold (`backend/` — Tauri 2, scanner, SQLite, metadata, lyrics, IPC commands)
- [x] Rust playback engine (symphonia decode + rodio output, whole-file-in-memory)
- [x] Frontend scaffold (`frontend/` — Monochrome-inspired UI shell)
- [x] Settings page (theme, visual toggles, library path, rescan)
- [x] Playlists, favorites, filters (UI wiring)
- [ ] Stats and yearly wrap
- [ ] Configurable music folder (picker in settings)
- [ ] Visualizer spectrum data from Rust

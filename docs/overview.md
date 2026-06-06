# Brook overview

Brook is a fully offline desktop music player. It reads audio from your local library, plays files via a Rust engine, and presents a token-based dark UI in Tauri 2.

**No network required.** Brook does not stream, scrobble, sync to cloud services, or fetch lyrics online.

## What Brook is

- Local music player for `$HOME/Music` by default (configurable in settings)
- Likes, playlists (user + auto charts), and library browse with sort/filter by album, artist, and year
- Sidecar `.lrc` lyrics, with fallback to embedded ID3/metadata lyrics (lyrics panel in the player bar)
- Global search plus artist and album detail pages
- Play queue (view, drag reorder, play next / add to queue from context menu; `Q` shortcut)
- Fullscreen now playing (transport controls; spectrum visualizer opt-in)
- Listening statistics, recent plays, and a simple yearly wrap view
- Rust audio engine: each track is loaded fully into memory before playback
- **Read-only library** — files in your music folder are never re-encoded, transcoded, or tag-edited by Brook

## What Brook is not

- A streaming client (no TIDAL, Spotify, etc.)
- A web app that plays audio in the browser via `<audio>` or blob URLs
- Dependent on accounts, API keys, or internet connectivity

## Library layout

Brook walks your music root recursively. Any folder structure works; a typical layout:

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
3. **None** — lyrics button stays hidden if neither is available

Use the mic button in the player bar (or press `L`) to open the lyrics side panel. Synced LRC lines highlight with playback position.

## Library integrity

Brook treats your music folder as the source of truth:

- **No writes** to audio files under the music root
- **No transcoding** — original bit depth, sample rate, and codec are preserved on disk
- **Metadata is read-only** — tags are read at scan and cached in SQLite for browsing; embedded tags in the file are not modified
- Re-scan skips unchanged files (`modified_ms` + size) and removes tracks deleted from disk

## Playback model

Audio is decoded and played entirely in Rust:

- The full file is read into memory (`std::fs::read`)
- Decode is for playback output only — the file on disk is unchanged
- No HTML5 media element, no streaming/chunked loading (cover art may use blob URLs in the webview for display only)
- Large FLAC files use more RAM by design

Playback state reaches the UI through Tauri events (position, state, track changes).

## Settings

The settings page covers UI preferences (stored in `localStorage` unless noted):

- Theme (Black, White, Ocean, Purple, Forest)
- Dynamic accent colors (extracted from cover art)
- Keyboard shortcuts (Space, arrows, M/S/R/L, `/` for search, `Q` for queue, Esc to close modals; read-only reference modal)
- Music folder location (picker) and library rescan

Playback options (EQ, gapless, replay gain) are fixed defaults — not exposed in settings.

## Stack

```bash
frontend/ (TypeScript UI)  ←→  Tauri IPC  ←→  backend/ (Rust: scan, DB, audio)
```

- **Frontend** (`frontend/`): vanilla TypeScript + Vite + Bun
- **Backend** (`backend/`): Tauri 2, SQLite, symphonia + rodio

See [ARCHITECTURE.md](ARCHITECTURE.md) for ADRs, database schema, and the IPC contract.

## Roadmap

- [x] Backend scaffold (`backend/` — Tauri 2, scanner, SQLite, metadata, lyrics, IPC commands)
- [x] Rust playback engine (symphonia decode + rodio output, whole-file-in-memory)
- [x] Frontend scaffold (`frontend/` — token-based UI shell)
- [x] Settings page (theme, visual toggles, library path, rescan)
- [x] Playlists, favorites, filters (UI wiring)
- [x] Stats and yearly wrap
- [x] Configurable music folder (picker in settings)
- [x] Visualizer spectrum data from Rust
- [x] Lyrics panel (sidecar + embedded, synced LRC display)
- [x] Global search, artist/album pages, context-menu navigation
- [x] Scanner hygiene (mtime skip, stale track removal)
- [x] Keyboard shortcuts and DB change events
- [x] Queue panel (view, clear, jump, drag reorder; `Q` shortcut)
- [x] Context menu play-next and add-to-queue
- [x] Fullscreen player with transport controls (visualizer opt-in)
- [x] Recent plays page (`get_recent_tracks`)
- [x] Playlist rename/delete, cover collage, favorites grid view

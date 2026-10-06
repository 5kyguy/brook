# Brook

Fully offline desktop music player. Plays files from `$HOME/Music` with a native desktop UI. Rust handles scan, playback, and storage; no network required.

## Quick start

```bash
bun install
bun run tauri:dev
```

Requires [Rust](https://rustup.rs/), [Bun](https://bun.sh/), and [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Put audio files in `$HOME/Music`.

## Install (Linux)

Requires `curl`, `jq`, and `libfuse2` (for AppImage). The AppImage installs to `~/Applications` and the `brook` command to `~/.local/bin`.

```bash
curl -fsSL https://raw.githubusercontent.com/5kyguy/brook/main/scripts/install.sh | bash
```

Uninstall with `brook --uninstall`. That removes the AppImage, the `brook` command, the desktop entry, and the icon. The music folder and listening history stay.

Update an AppImage install with `brook --update`. That downloads the latest GitHub release, points `brook` at it, and quits a running player. Playlists, likes, and the music folder stay.

You can remove the cache (listening history and cover art) with `brook --uninstall --clear-history`. Playlists, likes, and the music folder stay.

`brook --headless` starts playback with no window. `brook --quit` stops that process. A later `brook` opens the window on the running session.

## License

[MIT](LICENSE)

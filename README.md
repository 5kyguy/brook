# Brook

Fully offline desktop music player. Plays files from `$HOME/Music` with a native desktop UI. Rust handles scan, playback, and storage; no network required.

## Quick start

```bash
bun install
bun run tauri:dev
```

Requires [Rust](https://rustup.rs/), [Bun](https://bun.sh/), and [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Put audio files in `$HOME/Music`.

## Install (Linux)

Requires `curl`, `jq`, and `libfuse2` (for AppImage). Installs to `~/.local/bin`.

```bash
curl -fsSL https://raw.githubusercontent.com/5kyguy/brook/main/scripts/install.sh | bash
```

Uninstall:

```bash
curl -fsSL https://raw.githubusercontent.com/5kyguy/brook/main/scripts/uninstall.sh | bash
```

## License

[MIT](LICENSE)

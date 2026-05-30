# Brook

Fully offline desktop music player. Plays files from `$HOME/Music` with a Monochrome-inspired UI. Rust handles scan, playback, and storage; no network required.

## Quick start

```bash
bun install
bun run tauri:dev
```

Requires [Rust](https://rustup.rs/), [Bun](https://bun.sh/), and [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Put audio files in `$HOME/Music`.

## Docs

- [Overview](docs/overview.md) — features, library layout, formats, playback
- [Architecture](docs/ARCHITECTURE.md) — ADRs, schema, IPC contract

## License

[MIT](LICENSE)

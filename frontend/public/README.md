# Static UI assets (vendored)

These files are **copied into the repo** for Brook’s Monochrome-based UI. The app must not read from `references/` at build or runtime.

| Path | Purpose |
| ---- | ------- |
| `styles.css` | Full Monochrome stylesheet |
| `images/` | Icons for HTML `<use svg="./images/…">` (sidebar, logo, play in markup) |
| `assets/` | App icon, folder placeholder, PWA images |

Player icons used from TypeScript (`SVG_PLAY`, etc.) live in **`frontend/images/`** — Vite must not import from `public/` in JS.

Runtime URLs (Vite `publicDir`): `./styles.css`, `./images/…`, `./assets/…`

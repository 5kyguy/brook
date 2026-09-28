# Brook visual contract

Contract: `skyguy-visual` version **1**. Canonical rules and the derivation algorithm live in the portfolio's `DESIGN.md`. This note is how Brook applies that version. Brook does not read the portfolio at runtime, and it does not use the network to resolve a theme.

The matching fixture is `docs/fixtures/contrast-v1.json`. A Brook accent adapter matches those samples or it is wrong.

## Derivation

Use WCAG relative luminance in IEEE-754 doubles. Contrast is `(lighter + 0.05) / (darker + 0.05)`. Compare with `>= 4.5` for text and `>= 3.0` for borders before rounding. Blend toward the target in steps of `0.01`. Round each channel with half-away-from-zero, then clamp to `0..255`. Keep the smallest step that passes.

Brook only derives against the dark surfaces `#0A0A0A`, `#121212`, and `#1A1A1A`, blending toward `#FFFFFF`. A source that already passes is unchanged. Control ink is `#0A0A0A` or `#FAFAFA`, whichever contrasts more, if that ratio is at least 4.5. If neither passes, darken the fill toward black until `#FAFAFA` passes, or lighten it toward white until `#0A0A0A` passes, and keep the shorter blend. The RGB role is the source channels, including after a monochrome fallback.

## What Brook takes

- Dark base only: page `#0A0A0A`, surface `#121212`, raised `#1A1A1A`, text `#EDEDED`, muted `#A3A3A3`, dim `#8A8A8D`, hairline `#404040`, boundary `#737373`.
- Accent roles from the shared derivation: source, text, border, control, on-control, and RGB.
- Newsreader for titles and Manrope for UI text, vendored under `frontend/public/fonts/` with their SIL OFL 1.1 licenses. Inter is no longer loaded.
- Dense music layout: 4px spacing, 4px controls, 8px dialogs, square library cards, circular playback buttons, 40px inputs, 90px player bar. Do not shrink playback labels to the portfolio's 10px meta style.
- Existing Brook mark (`backend/app-icon.png` and `backend/icons/`). Do not redraw it.

Brook does not implement the portfolio light palette.

## Precedence

1. Valid track color while Dynamic Color is on.
2. Valid local R2-D2 accent.
3. Bundled dark monochrome (`#FFFFFF` source on the dark base).

The track override changes accent roles only. It does not change the base palette and it is not published.

Dynamic Color stays in settings. New installs default it to off. The saved `brook-dynamic-color` preference stays. Turning it off restores the current local accent immediately, or monochrome if that accent is missing or invalid.

No track, missing artwork, or a failed extract uses the same chain. Keep watching the local theme file while a track override is showing. Ignore a late extract if the track, the toggle, or the revision changed before it finished.

The manual theme picker (`black`, `white`, `ocean`, `purple`, `forest`, and the unused Catppuccin set) goes away with the shared theme. Delete its saved `brook-theme` and `brook-custom-theme` values so they cannot bring an old palette back. Today those palettes, plus `custom_theme_css`, are the competing accent sources.

## Local file

Read the versioned theme document from `$XDG_STATE_HOME/r2-d2/` when that variable is set, otherwise `~/.local/state/r2-d2/`. Do not hardcode a home directory. Brook does not require R2-D2. A missing directory is monochrome, not an error.

`backend/theme` reads and validates that file, watches its parent directory, and emits `theme:changed`. The UI enters through `frontend/api/theme.ts` only. Dynamic Color still overrides accent roles locally and never changes the base palette.

Reject a payload that fails schema or six-digit hex checks. On rejection, set every accent role, including RGB, to monochrome. Do not paint a stale colored accent.

## Fallback behavior already required

`frontend/settings/visual-effects.ts` writes an average `rgb()` into `--primary`, `--highlight`, and `--brand` only. The shared pass must also set text, border, control, on-control, and the RGB variables the visualizer and fullscreen player read (`--highlight-rgb`, `--fs-accent-rgb`). Clearing the override removes the whole set.

Semantic colors stay `#C73838` and `#E07924` with the contrast text variants in the fixture. They replace the current Tailwind red, green, amber, and blue status hues for warning and error. Success and info, if still shown, use accent or neutral roles rather than a second brand blue.

## Checks

- Open on the current local theme, or monochrome when R2-D2 is absent.
- Track changes do nothing to accent roles while Dynamic Color is off.
- With it on, a real cover overrides locally; disabling it or losing art restores the shared accent or monochrome.
- Malformed state, a missing file, and a rapid replace end on one coherent revision.
- Playback, seek, queue, and navigation still work. No request leaves the machine.

## Rollback

Dynamic Color off restores the current local accent, or monochrome if that file is missing. Deleting or invalidating `theme.json` does the same and does not touch the music library. Brook does not read the website, so disabling publication does not change the player. A Brook styling rollback is a revert of `frontend/public/styles.css`, `fonts.css`, and the vendored font files, then a rebuild. That is separate from the desktop template rollback and from the theme worker.

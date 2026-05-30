import * as api from "./api";
import { initPlayerBar } from "./player/bar";
import { loadStoredTheme, initThemeSettings } from "./settings/theme";
import { initLibraryPage, scanAndLoadLibrary } from "./ui/library";
import {
  buildSettingsGroups,
  initSearchPage,
  initStatsPage,
  renderSettingsPlaceholder,
} from "./ui/pages";
import { bindSidebarNavigation, Router } from "./ui/router";
import type { Track } from "./types";

async function boot(): Promise<void> {
  loadStoredTheme();
  buildSettingsGroups();
  initThemeSettings();
  initSearchPage();
  initStatsPage();

  const playerBar = initPlayerBar();
  const libraryPage = initLibraryPage(
    (track) => void playTrack(track, playerBar),
    (track) => void toggleFavorite(track, libraryPage),
  );

  const router = new Router();
  bindSidebarNavigation(router);
  router.start(() => {});

  if (!api.isTauri()) {
    document.body.classList.remove("tauri");
    libraryPage.setScanStatus("Start with bun run tauri:dev");
    return;
  }

  document.body.classList.add("tauri");

  void api.events.onScanProgress((payload) => {
    libraryPage.setScanStatus(
      payload.total > 0
        ? `Scanning ${payload.current}/${payload.total}…`
        : "Scanning music library…",
    );
  });

  void api.events.onPlaybackTrackChanged((track) => {
    playerBar.setTrack(track);
  });

  void api.events.onPlaybackState((payload) => {
    void api.playback.getPlaybackState().then((state) => {
      playerBar.sync({ ...state, status: payload.status });
    });
  });

  void api.events.onPlaybackPosition((payload) => {
    playerBar.setProgress(payload.positionSecs, payload.durationSecs);
  });

  void api.events.onPlaybackEnded(() => {
    playerBar.setTrack(null);
    void api.playback.getPlaybackState().then((state) => playerBar.sync(state));
  });

  try {
    const musicRoot = await api.library.getMusicRoot();
    renderSettingsPlaceholder(musicRoot);
    await scanAndLoadLibrary(libraryPage);
  } catch (error) {
    console.error(error);
    libraryPage.setScanStatus(
      error instanceof Error ? error.message : "Failed to initialize library",
    );
  }

  const initialState = await api.playback.getPlaybackState();
  playerBar.sync(initialState);
}

async function playTrack(
  track: Track,
  playerBar: ReturnType<typeof initPlayerBar>,
): Promise<void> {
  await api.playback.playTrack(track.id);
  playerBar.setTrack(track);
}

async function toggleFavorite(
  track: Track,
  libraryPage: ReturnType<typeof initLibraryPage>,
): Promise<void> {
  await api.library.toggleFavorite(track.id);
  await libraryPage.refresh();
}

void boot();

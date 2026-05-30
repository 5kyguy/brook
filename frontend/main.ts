import * as api from "./api";
import { initPlayerBar } from "./player/bar";
import { getLastTrackId, saveLastTrackId } from "./player/last-track";
import { initSettingsPage } from "./settings/settings";
import { loadStoredTheme } from "./settings/theme";
import { initLibraryPage, scanAndLoadLibrary } from "./ui/library";
import { initPlaylistPicker } from "./ui/playlist-picker";
import {
  ensureCreatePlaylistCardArt,
  initPlaylists,
  wirePlaylistModalSave,
} from "./ui/playlists";
import { bindSidebarNavigation, Router } from "./ui/router";
import { initMonochromeShell } from "./ui/shell";
import type { Track } from "./types";

async function boot(): Promise<void> {
  loadStoredTheme();
  initMonochromeShell();
  ensureCreatePlaylistCardArt();

  const playerBar = initPlayerBar();
  const router = new Router();

  let playlistPicker!: ReturnType<typeof initPlaylistPicker>;

  const libraryPage = initLibraryPage(
    (track) => void playTrack(track, playerBar, libraryPage),
    (track) => void toggleFavorite(track, libraryPage),
    (track) => void playlistPicker.open(track),
  );

  const playlists = initPlaylists(
    router,
    (track) => void playTrack(track, playerBar, libraryPage),
    (track) => void toggleFavorite(track, libraryPage),
    (track) => void playlistPicker.open(track),
    () => libraryPage.getPlayingTrackId(),
  );

  playlistPicker = initPlaylistPicker(() => {
    void playlists.refresh();
  });

  wirePlaylistModalSave(() => {
    void playlists.refresh();
    const modal = document.getElementById("playlist-modal");
    const trackId = modal?.dataset.pendingTrackId;
    if (trackId) {
      void (async () => {
        const list = await api.playlists.getPlaylists();
        const newest = list[list.length - 1];
        if (newest) await api.playlists.addToPlaylist(newest.id, trackId);
        delete modal!.dataset.pendingTrackId;
      })();
    }
  });

  const settingsPage = initSettingsPage(async () => {
    await api.library.scanLibrary();
    await libraryPage.refreshFacets();
    await libraryPage.refresh();
    await playlists.refresh();
  });

  bindSidebarNavigation(router);
  router.start((route) => {
    if (route.id === "library") void libraryPage.refresh();
    if (route.id === "playlist") {
      const match = window.location.pathname.match(/^\/userplaylist\/([^/]+)/);
      if (match) void playlists.openPlaylist(match[1]);
    }
  });

  if (!api.isTauri()) {
    libraryPage.setScanStatus("Run bun run tauri:dev for the full offline player.");
    return;
  }

  void api.events.onScanProgress((payload) => {
    libraryPage.setScanStatus(
      payload.total > 0
        ? `Scanning ${payload.current}/${payload.total}…`
        : "Scanning music library…",
    );
  });

  void api.events.onPlaybackTrackChanged((track) => {
    saveLastTrackId(track.id);
    libraryPage.setPlayingTrackId(track.id);
    playerBar.setTrack(track);
    void libraryPage.refresh();
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
    libraryPage.setPlayingTrackId(null);
    void api.playback.getPlaybackState().then((state) => playerBar.sync(state));
    void libraryPage.refresh();
  });

  try {
    const musicRoot = await api.library.getMusicRoot();
    settingsPage.setMusicRoot(musicRoot);
    await scanAndLoadLibrary(libraryPage);
    await playlists.refresh();
  } catch (error) {
    console.error(error);
    libraryPage.setScanStatus(
      error instanceof Error ? error.message : "Failed to initialize library",
    );
  }

  await restoreNowPlayingBar(playerBar, libraryPage);

  async function playTrack(
    track: Track,
    bar: ReturnType<typeof initPlayerBar>,
    library: ReturnType<typeof initLibraryPage>,
  ): Promise<void> {
    await api.playback.playTrack(track.id);
    saveLastTrackId(track.id);
    library.setPlayingTrackId(track.id);
    bar.setTrack(track);
    void library.refresh();
  }

  async function toggleFavorite(
    track: Track,
    library: ReturnType<typeof initLibraryPage>,
  ): Promise<void> {
    await api.library.toggleFavorite(track.id);
    await library.refresh();
    await playlists.refresh();
  }
}

async function restoreNowPlayingBar(
  playerBar: ReturnType<typeof initPlayerBar>,
  libraryPage: ReturnType<typeof initLibraryPage>,
): Promise<void> {
  const state = await api.playback.getPlaybackState();
  playerBar.sync(state);

  const trackId = state.trackId ?? getLastTrackId();
  if (!trackId) {
    playerBar.setTrack(null);
    return;
  }

  try {
    const track = await api.library.getTrack(trackId);
    playerBar.setTrack(track);
    if (state.trackId) libraryPage.setPlayingTrackId(state.trackId);
  } catch {
    playerBar.setTrack(null);
  }
}

void boot();

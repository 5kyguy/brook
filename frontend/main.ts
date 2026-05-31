import * as api from "./api";
import { initPlayerBar } from "./player/bar";
import { getLastTrackId, saveLastTrackId } from "./player/last-track";
import { createPlaybackQueue } from "./player/queue";
import { initVisualizer } from "./player/visualizer";
import { initRecentPage } from "./ui/recent";
import { initSettingsPage } from "./settings/settings";
import { initStatsPage } from "./ui/stats";
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

  const queue = createPlaybackQueue();
  const visualizer = initVisualizer();
  const router = new Router();

  let playlistPicker!: ReturnType<typeof initPlaylistPicker>;
  let libraryPage!: ReturnType<typeof initLibraryPage>;
  let playerBar!: ReturnType<typeof initPlayerBar>;

  async function playQueuedTrack(track: Track): Promise<void> {
    await api.playback.playTrack(track.id);
    saveLastTrackId(track.id);
    libraryPage.setPlayingTrackId(track.id);
    playerBar.setTrack(track);
    visualizer.setTrack(track);
    void libraryPage.refresh();
  }

  async function playTrack(
    track: Track,
    queueTracks?: Track[],
  ): Promise<void> {
    if (queueTracks?.length) {
      queue.setQueue(queueTracks, track.id);
    } else {
      queue.setQueue([track], track.id);
    }
    playerBar.syncQueueControls(queue.isShuffled(), queue.getRepeatMode());
    await playQueuedTrack(track);
  }

  async function toggleFavorite(track: Track): Promise<void> {
    await api.library.toggleFavorite(track.id);
    await libraryPage.refresh();
    await playlists.refresh();
  }

  async function toggleNowPlayingFavorite(): Promise<void> {
    const track = queue.getCurrent();
    if (!track) return;
    await api.library.toggleFavorite(track.id);
    const updated = await api.library.getTrack(track.id);
    playerBar.setTrack(updated);
    await libraryPage.refresh();
    await playlists.refresh();
  }

  async function goNext(): Promise<void> {
    const next = queue.advance();
    if (!next) return;
    await playQueuedTrack(next);
  }

  async function goPrev(): Promise<void> {
    const state = await api.playback.getPlaybackState();
    if (state.positionSecs > 3) {
      await api.playback.seek(0);
      return;
    }
    const prev = queue.retreat();
    if (!prev) {
      await api.playback.seek(0);
      return;
    }
    await playQueuedTrack(prev);
  }

  libraryPage = initLibraryPage(
    (track, queueTracks) => void playTrack(track, queueTracks),
    (track) => void toggleFavorite(track),
    (track) => void playlistPicker.open(track),
  );

  const playlists = initPlaylists(
    router,
    (track, queueTracks) => void playTrack(track, queueTracks),
    (track) => void toggleFavorite(track),
    (track) => void playlistPicker.open(track),
    () => libraryPage.getPlayingTrackId(),
  );

  const statsPage = initStatsPage(
    (track, queueTracks) => void playTrack(track, queueTracks),
    (track) => void toggleFavorite(track),
    (track) => void playlistPicker.open(track),
    () => libraryPage.getPlayingTrackId(),
  );

  const recentPage = initRecentPage(
    (track, queueTracks) => void playTrack(track, queueTracks),
    (track) => void toggleFavorite(track),
    (track) => void playlistPicker.open(track),
    () => libraryPage.getPlayingTrackId(),
    () => {
      void playlists.refresh();
      void statsPage.refresh();
    },
  );

  playlistPicker = initPlaylistPicker(() => {
    void playlists.refresh();
  });

  playerBar = initPlayerBar({
    onPrev: () => void goPrev(),
    onNext: () => void goNext(),
    onToggleShuffle: () => {
      const shuffled = queue.toggleShuffle();
      playerBar.syncQueueControls(shuffled, queue.getRepeatMode());
      return shuffled;
    },
    onCycleRepeat: () => {
      const repeat = queue.cycleRepeat();
      playerBar.syncQueueControls(queue.isShuffled(), repeat);
      return repeat;
    },
    onToggleFavorite: () => void toggleNowPlayingFavorite(),
    onAddToPlaylist: () => {
      const track = queue.getCurrent();
      if (track) void playlistPicker.open(track);
    },
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

  const settingsPage = initSettingsPage(
    async () => {
      await api.library.scanLibrary();
      await libraryPage.refreshFacets();
      await libraryPage.refresh();
      await playlists.refresh();
    },
    async () => {
      await api.library.scanLibrary();
      await libraryPage.refreshFacets();
      await libraryPage.refresh();
      await playlists.refresh();
      await statsPage.refresh();
      await recentPage.refresh();
    },
  );

  bindSidebarNavigation(router);
  router.start((route) => {
    if (route.id === "library") void libraryPage.refresh();
    if (route.id === "stats") void statsPage.refresh();
    if (route.id === "recent") void recentPage.refresh();
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
    visualizer.setTrack(track);
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

  void api.events.onPlaybackEnded(async () => {
    const next =
      queue.getRepeatMode() === "one" ? queue.getCurrent() : queue.advance();
    if (next) {
      await playQueuedTrack(next);
      return;
    }
    libraryPage.setPlayingTrackId(null);
    visualizer.setTrack(null);
    void api.playback.getPlaybackState().then((state) => playerBar.sync(state));
    void libraryPage.refresh();
    void statsPage.refresh();
    void recentPage.refresh();
    void playlists.refresh();
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

  await restoreNowPlayingBar(playerBar, libraryPage, visualizer);
}

async function restoreNowPlayingBar(
  playerBar: ReturnType<typeof initPlayerBar>,
  libraryPage: ReturnType<typeof initLibraryPage>,
  visualizer: ReturnType<typeof initVisualizer>,
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
    visualizer.setTrack(track);
    if (state.trackId) libraryPage.setPlayingTrackId(state.trackId);
  } catch {
    playerBar.setTrack(null);
  }
}

void boot();

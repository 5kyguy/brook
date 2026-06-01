import * as api from "./api";
import { initPlayerBar } from "./player/bar";
import { getLastTrackId, saveLastTrackId } from "./player/last-track";
import { initLyricsPanel } from "./player/lyrics";
import { initQueuePanel } from "./player/queue-panel";
import { createPlaybackQueue } from "./player/queue";
import { initKeyboardShortcuts } from "./player/shortcuts";
import { initVisualizer } from "./player/visualizer";
import { initRecentPage } from "./ui/recent";
import { initSettingsPage } from "./settings/settings";
import { setCurrentTrackForVisuals } from "./settings/visual-effects";
import { initStatsPage } from "./ui/stats";
import { loadStoredTheme } from "./settings/theme";
import { initEntityPages, initTrackContextMenu } from "./ui/entity-page";
import { initLibraryPage, scanAndLoadLibrary } from "./ui/library";
import { initPlaylistPicker } from "./ui/playlist-picker";
import {
  ensureCreatePlaylistCardArt,
  initPlaylists,
  wirePlaylistModalSave,
} from "./ui/playlists";
import { bindSidebarNavigation, Router } from "./ui/router";
import { initGlobalSearch, initSearchPage } from "./ui/search";
import { initMonochromeShell } from "./ui/shell";
import type { Track } from "./types";

async function boot(): Promise<void> {
  loadStoredTheme();
  initMonochromeShell();
  ensureCreatePlaylistCardArt();

  const queue = createPlaybackQueue();
  let visualizer: ReturnType<typeof initVisualizer> | null = null;
  const lyricsPanel = initLyricsPanel({
    onFullscreenLyricsChange: (open) => visualizer?.clampVisualizerForLyrics(open),
  });
  const router = new Router();

  let playlistPicker!: ReturnType<typeof initPlaylistPicker>;
  let libraryPage!: ReturnType<typeof initLibraryPage>;
  let playerBar!: ReturnType<typeof initPlayerBar>;
  let searchPage!: ReturnType<typeof initSearchPage>;
  let entityPages!: ReturnType<typeof initEntityPages>;
  let queuePanel!: ReturnType<typeof initQueuePanel>;

  const refreshQueuePanel = () => {
    queuePanel?.refresh();
  };

  const syncTransportControls = () => {
    const shuffle = queue.isShuffled();
    const repeat = queue.getRepeatMode();
    playerBar?.syncQueueControls(shuffle, repeat);
    visualizer?.syncQueueControls(shuffle, repeat);
  };

  async function setNowPlayingTrack(track: Track | null): Promise<void> {
    playerBar.setTrack(track);
    visualizer?.setTrack(track);
    await lyricsPanel.setTrack(track);
    if (track) {
      setCurrentTrackForVisuals(track);
    } else {
      setCurrentTrackForVisuals(null);
    }
  }

  async function playQueuedTrack(track: Track): Promise<void> {
    await api.playback.playTrack(track.id);
    saveLastTrackId(track.id);
    libraryPage.setPlayingTrackId(track.id);
    await setNowPlayingTrack(track);
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
    syncTransportControls();
    await playQueuedTrack(track);
    refreshQueuePanel();
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
    visualizer?.setTrack(updated);
    await libraryPage.refresh();
    await playlists.refresh();
  }

  async function goNext(): Promise<void> {
    const next = queue.advance();
    if (!next) return;
    await playQueuedTrack(next);
    refreshQueuePanel();
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
    refreshQueuePanel();
  }

  queuePanel = initQueuePanel({
    queue,
    getPlayingTrackId: () => libraryPage?.getPlayingTrackId() ?? null,
    onJumpTo: (track) => playQueuedTrack(track),
    onRemove: (trackId) => {
      const wasPlaying = libraryPage?.getPlayingTrackId() === trackId;
      queue.remove(trackId);
      if (wasPlaying) {
        const next = queue.getCurrent();
        if (next) void playQueuedTrack(next);
      }
      refreshQueuePanel();
    },
    onClear: () => {
      queue.clear();
      refreshQueuePanel();
    },
  });

  const trackActions = {
    onPlay: (track: Track, queueTracks?: Track[]) => void playTrack(track, queueTracks),
    onToggleFavorite: (track: Track) => void toggleFavorite(track),
    onAddToPlaylist: (track: Track) => void playlistPicker.open(track),
  };

  libraryPage = initLibraryPage(
    trackActions.onPlay,
    trackActions.onToggleFavorite,
    trackActions.onAddToPlaylist,
  );

  searchPage = initSearchPage(trackActions);

  entityPages = initEntityPages(trackActions, () => libraryPage.getPlayingTrackId());

  const playlists = initPlaylists(
    router,
    trackActions.onPlay,
    trackActions.onToggleFavorite,
    trackActions.onAddToPlaylist,
    () => libraryPage.getPlayingTrackId(),
  );

  const statsPage = initStatsPage(
    trackActions.onPlay,
    trackActions.onToggleFavorite,
    trackActions.onAddToPlaylist,
    () => libraryPage.getPlayingTrackId(),
  );

  const recentPage = initRecentPage(
    trackActions.onPlay,
    trackActions.onToggleFavorite,
    trackActions.onAddToPlaylist,
    () => libraryPage.getPlayingTrackId(),
  );

  playlistPicker = initPlaylistPicker(() => {
    void playlists.refresh();
  });

  visualizer = initVisualizer({
    onPrev: () => void goPrev(),
    onNext: () => {
      void goNext();
    },
    onPlayPause: () => {
      void (async () => {
        const track = queue.getCurrent();
        if (!track) return;
        const state = await api.playback.getPlaybackState();
        if (state.status === "playing") await api.playback.pause();
        else if (state.status === "paused") await api.playback.resume();
        else await api.playback.playTrack(track.id);
      })();
    },
    onToggleShuffle: () => {
      const shuffled = queue.toggleShuffle();
      syncTransportControls();
      refreshQueuePanel();
      return shuffled;
    },
    onCycleRepeat: () => {
      const repeat = queue.cycleRepeat();
      syncTransportControls();
      return repeat;
    },
    onToggleFavorite: () => {
      void toggleNowPlayingFavorite();
    },
    onAddToPlaylist: () => {
      const track = queue.getCurrent();
      if (track) playlistPicker.open(track);
    },
    onOpenQueue: () => queuePanel.open(),
    getNextTrack: () => queue.getNext() ?? null,
    onFullscreenOpen: () => lyricsPanel.setFullscreenHostActive(true),
    onFullscreenClose: () => {
      lyricsPanel.setFullscreenHostActive(false);
      lyricsPanel.closeFullscreen();
    },
  });

  playerBar = initPlayerBar({
    onPrev: () => void goPrev(),
    onNext: () => void goNext(),
    onToggleShuffle: () => {
      const shuffled = queue.toggleShuffle();
      syncTransportControls();
      refreshQueuePanel();
      return shuffled;
    },
    onCycleRepeat: () => {
      const repeat = queue.cycleRepeat();
      syncTransportControls();
      return repeat;
    },
    onToggleFavorite: () => void toggleNowPlayingFavorite(),
    onAddToPlaylist: () => {
      const track = queue.getCurrent();
      if (track) void playlistPicker.open(track);
    },
  });

  initGlobalSearch((query) => {
    router.openSearch(query);
  });

  initTrackContextMenu({
    onGoToArtist: (name) => router.openArtist(name),
    onGoToAlbum: (name) => router.openAlbum(name),
    onAddToPlaylist: (track) => void playlistPicker.open(track),
    onPlayNext: (track) => {
      queue.insertNext(track);
      refreshQueuePanel();
    },
    onAddToQueue: (track) => {
      queue.append(track);
      refreshQueuePanel();
    },
  });

  initKeyboardShortcuts({
    onPlayPause: () => {
      void (async () => {
        const track = queue.getCurrent();
        if (!track) return;
        const state = await api.playback.getPlaybackState();
        if (state.status === "playing") await api.playback.pause();
        else if (state.status === "paused") await api.playback.resume();
        else await api.playback.playTrack(track.id);
      })();
    },
    onNext: () => void goNext(),
    onPrev: () => void goPrev(),
    onToggleMute: () => {
      void api.playback.getPlaybackState().then((state) => {
        const next = state.volume > 0 ? 0 : 1;
        void api.playback.setVolume(next);
      });
    },
    onToggleShuffle: () => {
      queue.toggleShuffle();
      syncTransportControls();
      refreshQueuePanel();
    },
    onCycleRepeat: () => {
      queue.cycleRepeat();
      syncTransportControls();
    },
    onOpenQueue: () => queuePanel.open(),
    onToggleLyrics: () => lyricsPanel.toggle(),
    onFocusSearch: () => {
      router.navigate("search");
      const input = document.getElementById("search-input") as HTMLInputElement | null;
      input?.focus();
    },
    onSeekRelative: (delta) => {
      void api.playback.getPlaybackState().then((state) => {
        const next = Math.max(0, Math.min(state.durationSecs, state.positionSecs + delta));
        void api.playback.seek(next);
      });
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
  router.start((route, params) => {
    if (route.id !== "library") libraryPage.closeLocalPanel();
    if (route.id === "library") void libraryPage.refresh();
    if (route.id === "stats") void statsPage.refresh();
    if (route.id === "recent") void recentPage.refresh();
    if (route.id === "playlist" && params.playlistId) {
      void playlists.openPlaylist(params.playlistId);
    }
    if (route.id === "search" && params.searchQuery) {
      void searchPage.search(params.searchQuery);
      const input = document.getElementById("search-input") as HTMLInputElement | null;
      if (input) input.value = params.searchQuery;
    }
    if (route.id === "artist" && params.entityName) {
      void entityPages.openArtist(params.entityName);
    }
    if (route.id === "album" && params.entityName) {
      void entityPages.openAlbum(params.entityName);
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

  void api.events.onScanComplete(() => {
    libraryPage.setScanStatus("Library scan complete.");
  });

  void api.events.onFavoritesChanged(() => {
    void libraryPage.refresh();
    void playlists.refresh();
  });

  void api.events.onPlaylistsChanged(() => {
    void playlists.refresh();
  });

  void api.events.onPlaybackTrackChanged((track) => {
    saveLastTrackId(track.id);
    libraryPage.setPlayingTrackId(track.id);
    void setNowPlayingTrack(track);
    void libraryPage.refresh();
    refreshQueuePanel();
  });

  void api.events.onPlaybackState((payload) => {
    visualizer.syncPlaybackState(payload.status);
    void api.playback.getPlaybackState().then((state) => {
      playerBar.sync({ ...state, status: payload.status });
    });
  });

  void api.events.onPlaybackPosition((payload) => {
    playerBar.setProgress(payload.positionSecs, payload.durationSecs);
    visualizer.setProgress(payload.positionSecs, payload.durationSecs);
    lyricsPanel.setPosition(payload.positionSecs);
  });

  void api.events.onPlaybackEnded(async () => {
    const next =
      queue.getRepeatMode() === "one" ? queue.getCurrent() : queue.advance();
    if (next) {
      await playQueuedTrack(next);
      refreshQueuePanel();
      return;
    }
    libraryPage.setPlayingTrackId(null);
    await setNowPlayingTrack(null);
    void api.playback.getPlaybackState().then((state) => playerBar.sync(state));
    void libraryPage.refresh();
    void statsPage.refresh();
    void recentPage.refresh();
    void playlists.refresh();
    refreshQueuePanel();
  });

  try {
    await scanAndLoadLibrary(libraryPage);
    await playlists.refresh();
  } catch (error) {
    console.error(error);
    libraryPage.setScanStatus(
      error instanceof Error ? error.message : "Failed to initialize library",
    );
  }

  await restoreNowPlayingBar(playerBar, libraryPage, setNowPlayingTrack);
}

async function restoreNowPlayingBar(
  playerBar: ReturnType<typeof initPlayerBar>,
  libraryPage: ReturnType<typeof initLibraryPage>,
  setNowPlayingTrack: (track: Track | null) => Promise<void>,
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
    await setNowPlayingTrack(track);
    if (state.trackId) libraryPage.setPlayingTrackId(state.trackId);
  } catch {
    playerBar.setTrack(null);
  }
}

void boot();

import * as api from "./api";
import { DevTimer, devLog, logStartupHint } from "./api/dev-log";
import { initPlayerBar } from "./player/bar";
import { getLastTrackId, saveLastTrackId } from "./player/last-track";
import { initLyricsPanel } from "./player/lyrics";
import { initQueuePanel } from "./player/queue-panel";
import { closeOpenModals, initKeyboardShortcuts } from "./player/shortcuts";
import { initVisualizer } from "./player/visualizer";
import { initRecentPage } from "./ui/recent";
import { initSettingsPage } from "./settings/settings";
import { setCurrentTrackForVisuals } from "./settings/visual-effects";
import { initStatsPage } from "./ui/stats";
import { initSharedTheme } from "./settings/shared-theme";
import { initEntityPages, initTrackContextMenu } from "./ui/entity-page";
import {
  initLibraryPage,
  loadCachedLibrary,
  startBackgroundLibraryScan,
} from "./ui/library";
import { initPlaylistPicker } from "./ui/playlist-picker";
import {
  ensureCreatePlaylistCardArt,
  initPlaylists,
  wirePlaylistModalSave,
} from "./ui/playlists";
import { bindSidebarNavigation, Router } from "./ui/router";
import { initGlobalSearch, initSearchPage } from "./ui/search";
import { initAppShell } from "./ui/shell";
import type { QueueSnapshot, Track } from "./types";

async function boot(): Promise<void> {
  logStartupHint();
  const bootTimer = new DevTimer("boot", "boot()");

  await initSharedTheme();
  initAppShell();
  ensureCreatePlaylistCardArt();
  bootTimer.step("theme + shell");

  const queueSnap: { current: QueueSnapshot } = {
    current: {
      tracks: [],
      currentId: null,
      nextId: null,
      shuffle: false,
      repeat: "off",
    },
  };
  let visualizer: ReturnType<typeof initVisualizer> | null = null;
  const lyricsPanel = initLyricsPanel({
    onFullscreenLyricsChange: (open) => visualizer?.clampVisualizerForLyrics(open),
    onSeek: (secs) => {
      void api.playback.seek(secs);
    },
  });
  const router = new Router();

  let playlistPicker!: ReturnType<typeof initPlaylistPicker>;
  let libraryPage!: ReturnType<typeof initLibraryPage>;
  let playerBar!: ReturnType<typeof initPlayerBar>;
  let searchPage!: ReturnType<typeof initSearchPage>;
  let entityPages!: ReturnType<typeof initEntityPages>;
  let queuePanel!: ReturnType<typeof initQueuePanel>;
  let lastVolumeBeforeMute = 1;

  const refreshQueuePanel = () => {
    queuePanel?.refresh();
  };

  const syncTransportControls = () => {
    const { shuffle, repeat } = queueSnap.current;
    playerBar?.syncQueueControls(shuffle, repeat);
    visualizer?.syncQueueControls(shuffle, repeat);
  };

  function currentTrack(): Track | null {
    const id = queueSnap.current.currentId;
    if (!id) return null;
    return queueSnap.current.tracks.find((track) => track.id === id) ?? null;
  }

  function nextTrack(): Track | null {
    const id = queueSnap.current.nextId;
    if (!id) return null;
    return queueSnap.current.tracks.find((track) => track.id === id) ?? null;
  }

  function applySnapshot(snap: QueueSnapshot): void {
    queueSnap.current = snap;
    syncTransportControls();
    refreshQueuePanel();
    visualizer?.refreshUpNext();
  }

  async function showTrack(track: Track | null): Promise<void> {
    playerBar.setTrack(track);
    visualizer?.setTrack(track);
    await lyricsPanel.setTrack(track);
    if (track) {
      setCurrentTrackForVisuals(track);
    } else {
      setCurrentTrackForVisuals(null);
    }
  }

  async function followQueue(beforeId: string | null, snap: QueueSnapshot): Promise<void> {
    applySnapshot(snap);
    if (!snap.currentId || snap.currentId === beforeId) return;
    const track = currentTrack();
    if (!track) return;
    saveLastTrackId(track.id);
    libraryPage.setPlayingTrackId(track.id);
    await showTrack(track);
    void libraryPage.refresh();
  }

  async function playTrack(track: Track, queueTracks?: Track[]): Promise<void> {
    const ids = (queueTracks?.length ? queueTracks : [track]).map((item) => item.id);
    const snap = await api.playback.playQueue(ids, track.id);
    await followQueue(null, snap);
  }

  async function togglePlay(): Promise<void> {
    if (!currentTrack()) return;
    const state = await api.playback.getPlaybackState();
    if (state.status === "playing") await api.playback.pause();
    else if (state.status === "paused") await api.playback.resume();
    else await api.playback.playCurrent();
  }

  async function toggleFavorite(track: Track): Promise<void> {
    await api.library.toggleFavorite(track.id);
    await libraryPage.refresh();
    await playlists.refresh();
  }

  async function toggleNowPlayingFavorite(): Promise<void> {
    const track = currentTrack();
    if (!track) return;
    await api.library.toggleFavorite(track.id);
    const updated = await api.library.getTrack(track.id);
    playerBar.setTrack(updated);
    visualizer?.setTrack(updated);
    await libraryPage.refresh();
    await playlists.refresh();
  }

  async function goNext(): Promise<void> {
    const before = queueSnap.current.currentId;
    const snap = await api.playback.queueNext();
    await followQueue(before, snap);
  }

  async function goPrev(): Promise<void> {
    const before = queueSnap.current.currentId;
    const snap = await api.playback.queuePrevious();
    await followQueue(before, snap);
  }

  queuePanel = initQueuePanel({
    getTracks: () => queueSnap.current.tracks,
    getPlayingTrackId: () => libraryPage?.getPlayingTrackId() ?? null,
    onJump: (trackId) => {
      void (async () => {
        const before = queueSnap.current.currentId;
        const snap = await api.playback.queueJump(trackId);
        await followQueue(before, snap);
      })();
    },
    onRemove: (trackId) => {
      void (async () => {
        const before = queueSnap.current.currentId;
        const snap = await api.playback.queueRemove(trackId);
        await followQueue(before, snap);
      })();
    },
    onClear: () => {
      void api.playback.queueClear().then(applySnapshot);
    },
    onReorder: (fromIndex, toIndex) => {
      void api.playback.queueReorder(fromIndex, toIndex).then(applySnapshot);
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
      void togglePlay();
    },
    onToggleShuffle: () => {
      return api.playback.queueToggleShuffle().then((snap) => {
        applySnapshot(snap);
        return snap.shuffle;
      });
    },
    onCycleRepeat: () => {
      return api.playback.queueCycleRepeat().then((snap) => {
        applySnapshot(snap);
        return snap.repeat;
      });
    },
    onToggleFavorite: () => {
      void toggleNowPlayingFavorite();
    },
    onAddToPlaylist: () => {
      const track = currentTrack();
      if (track) playlistPicker.open(track);
    },
    onOpenQueue: () => queuePanel.open(),
    getNextTrack: () => nextTrack(),
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
      return api.playback.queueToggleShuffle().then((snap) => {
        applySnapshot(snap);
        return snap.shuffle;
      });
    },
    onCycleRepeat: () => {
      return api.playback.queueCycleRepeat().then((snap) => {
        applySnapshot(snap);
        return snap.repeat;
      });
    },
    onToggleFavorite: () => void toggleNowPlayingFavorite(),
    onAddToPlaylist: () => {
      const track = currentTrack();
      if (track) void playlistPicker.open(track);
    },
    onToggleMute: () => {
      void api.playback.getPlaybackState().then((state) => {
        if (state.volume > 0) {
          lastVolumeBeforeMute = state.volume;
          void api.playback.setVolume(0).then(() => {
            playerBar.sync({ ...state, volume: 0 });
          });
        } else {
          const restore = lastVolumeBeforeMute > 0 ? lastVolumeBeforeMute : 1;
          void api.playback.setVolume(restore).then(() => {
            playerBar.sync({ ...state, volume: restore });
          });
        }
      });
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
      void api.playback.queueInsertNext(track.id).then(applySnapshot);
    },
    onAddToQueue: (track) => {
      void api.playback.queueAppend(track.id).then(applySnapshot);
    },
  });

  initKeyboardShortcuts({
    onPlayPause: () => {
      void togglePlay();
    },
    onNext: () => void goNext(),
    onPrev: () => void goPrev(),
    onToggleMute: () => {
      void api.playback.getPlaybackState().then((state) => {
        if (state.volume > 0) {
          lastVolumeBeforeMute = state.volume;
          void api.playback.setVolume(0).then(() => {
            playerBar.sync({ ...state, volume: 0 });
          });
        } else {
          const restore = lastVolumeBeforeMute > 0 ? lastVolumeBeforeMute : 1;
          void api.playback.setVolume(restore).then(() => {
            playerBar.sync({ ...state, volume: restore });
          });
        }
      });
    },
    onVolumeDelta: (delta) => {
      void api.playback.getPlaybackState().then((state) => {
        const next = Math.max(0, Math.min(1, state.volume + delta));
        if (next > 0) lastVolumeBeforeMute = next;
        void api.playback.setVolume(next).then(() => {
          playerBar.sync({ ...state, volume: next });
        });
      });
    },
    onCloseModals: () => {
      closeOpenModals();
    },
    onToggleShuffle: () => {
      void api.playback.queueToggleShuffle().then(applySnapshot);
    },
    onCycleRepeat: () => {
      void api.playback.queueCycleRepeat().then(applySnapshot);
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

  wirePlaylistModalSave(({ playlist, pendingTrackId, openAfterCreate }) => {
    void (async () => {
      await playlists.refresh();
      if (pendingTrackId) {
        await api.playlists.addToPlaylist(playlist.id, pendingTrackId);
      }
      if (openAfterCreate) {
        router.openPlaylist(playlist.id);
      }
    })();
  });

  async function afterLibraryScan(): Promise<void> {
    await libraryPage.refreshFacets();
    await libraryPage.refreshLiked();
    await libraryPage.refreshLocalTracks();
    await playlists.refresh();
  }

  async function runLibraryScanAndRefresh(): Promise<void> {
    await api.library.startLibraryScan();
    await api.library.waitForLibraryScanComplete();
    await afterLibraryScan();
  }

  initSettingsPage(
    () => runLibraryScanAndRefresh(),
    async () => {
      await runLibraryScanAndRefresh();
      await statsPage.refresh();
      await recentPage.refresh();
    },
  );

  let appReady = false;

  bindSidebarNavigation(router);
  router.start((route, params) => {
    if (!appReady) return;
    if (route.id !== "library") libraryPage.closeLocalPanel();
    if (route.id === "library") void libraryPage.refreshLiked();
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

  bootTimer.step("UI modules wired");

  if (!api.isTauri()) {
    libraryPage.setScanStatus("Run bun run tauri:dev for the full offline player.");
    bootTimer.finish("browser-only (no Tauri)");
    return;
  }

  let scanProgressEvents = 0;

  void api.events.onScanProgress((payload) => {
    scanProgressEvents += 1;
    libraryPage.setScanStatus(
      payload.total > 0
        ? `Scanning ${payload.current}/${payload.total}…`
        : "Scanning music library…",
    );
  });

  void api.events.onScanComplete(() => {
    devLog("boot", `library:scan-progress events received: ${scanProgressEvents}`);
    scanProgressEvents = 0;
    void (async () => {
      await afterLibraryScan();
      libraryPage.setScanStatus("");
    })();
  });

  void api.events.onFavoritesChanged(() => {
    void libraryPage.refresh();
    void playlists.refresh();
  });

  void api.events.onPlaylistsChanged(() => {
    void playlists.refresh();
  });

  void api.events.onQueueChanged((snap) => {
    applySnapshot(snap);
  });

  void api.events.onPlaybackTrackChanged((track) => {
    saveLastTrackId(track.id);
    libraryPage.setPlayingTrackId(track.id);
    void showTrack(track);
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

  void api.events.onPlaybackEnded(() => {
    void libraryPage.refresh();
    void statsPage.refresh();
    void recentPage.refresh();
    void playlists.refresh();
  });

  void api.events.onPlaybackSessionIdle(async () => {
    libraryPage.setPlayingTrackId(null);
    await showTrack(null);
    void api.playback.getPlaybackState().then((state) => playerBar.sync(state));
    void libraryPage.refresh();
  });

  void api.events.onPlaybackAdvanced(async (payload) => {
    saveLastTrackId(payload.track.id);
    libraryPage.setPlayingTrackId(payload.track.id);
    await showTrack(payload.track);
    refreshQueuePanel();
    void libraryPage.refresh();
    void statsPage.refresh();
    void recentPage.refresh();
  });

  try {
    const playlistsStart = performance.now();
    await loadCachedLibrary(libraryPage);
    await playlists.refresh();
    bootTimer.step(
      `loadCachedLibrary + playlists.refresh ${Math.round(performance.now() - playlistsStart)}ms`,
    );
  } catch (error) {
    console.error(error);
    devLog("boot", `library init failed: ${error instanceof Error ? error.message : String(error)}`);
    libraryPage.setScanStatus(
      error instanceof Error ? error.message : "Failed to initialize library",
    );
  }

  const restoreStart = performance.now();
  await restoreNowPlayingBar(playerBar, libraryPage, showTrack, applySnapshot);
  bootTimer.step(`restoreNowPlayingBar ${Math.round(performance.now() - restoreStart)}ms`);

  startBackgroundLibraryScan(libraryPage);
  appReady = true;
  bootTimer.finish("ready (background scan started)");
}

async function restoreNowPlayingBar(
  playerBar: ReturnType<typeof initPlayerBar>,
  libraryPage: ReturnType<typeof initLibraryPage>,
  showTrack: (track: Track | null) => Promise<void>,
  applySnapshot: (snap: QueueSnapshot) => void,
): Promise<void> {
  const timer = new DevTimer("boot", "restoreNowPlayingBar");
  const snap = await api.playback.getQueue();
  applySnapshot(snap);
  const state = await api.playback.getPlaybackState();
  playerBar.sync(state);
  timer.step("getPlaybackState");

  let trackId = snap.currentId ?? state.trackId;
  if (!trackId) {
    try {
      const resume = await api.playback.getResumeState();
      if (resume?.trackId) {
        trackId = resume.trackId;
        await api.playback.loadTrackPaused(resume.trackId, resume.positionSecs);
        applySnapshot(await api.playback.getQueue());
        timer.step("loadTrackPaused");
      }
    } catch {
      /* resume is best-effort */
    }
  }

  if (!trackId) {
    const last = getLastTrackId();
    if (last) {
      try {
        await api.playback.loadTrackPaused(last, 0);
        trackId = last;
        applySnapshot(await api.playback.getQueue());
      } catch {
        trackId = null;
      }
    }
  }

  if (!trackId) {
    playerBar.setTrack(null);
    timer.finish("no saved track");
    return;
  }

  try {
    const track = await api.library.getTrack(trackId);
    await showTrack(track);
    libraryPage.setPlayingTrackId(trackId);
    timer.finish(`trackId=${trackId}`);
  } catch {
    playerBar.setTrack(null);
    timer.finish("no track");
  }
}

void boot();

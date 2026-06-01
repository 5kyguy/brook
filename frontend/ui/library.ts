import * as api from "../api";
import { DevTimer, devLog } from "../api/dev-log";
import type { Track } from "../types";
import { filterStateToQuery, initFilterBar, type FilterBar } from "./filters";
import { renderTrackList } from "./track-list";
import { wireInPageSearch } from "./search";

export interface LibraryPage {
  refresh(): Promise<void>;
  refreshFacets(): Promise<void>;
  refreshLiked(): Promise<void>;
  refreshLocalTracks(): Promise<void>;
  setScanStatus(message: string): void;
  getPlayingTrackId(): string | null;
  setPlayingTrackId(id: string | null): void;
  closeLocalPanel(): void;
}

function setLocalPanelOpen(open: boolean): void {
  const panel = document.getElementById("library-local-panel");
  const main = document.getElementById("library-main-sections");
  const openBtn = document.getElementById("library-open-local-btn");
  if (!panel || !main) return;

  panel.hidden = !open;
  panel.classList.toggle("open", open);
  main.hidden = open;
  openBtn?.setAttribute("aria-expanded", open ? "true" : "false");
  document.getElementById("page-library")?.classList.toggle("library-local-open", open);
}

export function initLibraryPage(
  onPlay: (track: Track, queue?: Track[]) => void,
  onToggleFavorite: (track: Track) => void,
  onAddToPlaylist: (track: Track) => void,
): LibraryPage {
  const statusEl = document.getElementById("library-scan-status");
  const likedContainer = document.getElementById("library-tracks-container");
  const localListEl = document.getElementById("local-files-list");
  const filtersMount = document.getElementById("library-filters");
  const likedToolbar = document.getElementById("library-liked-tracks-toolbar");
  const openLocalBtn = document.getElementById("library-open-local-btn");
  const closeLocalBtn = document.getElementById("library-close-local-btn");

  if (!likedContainer || !localListEl) {
    throw new Error("Missing library containers");
  }

  let likedTracks: Track[] = [];
  let localTracks: Track[] = [];
  let playingTrackId: string | null = null;
  let libraryHasTracks = false;
  let localPanelOpen = false;
  const filterBar: FilterBar | null = filtersMount ? initFilterBar(filtersMount) : null;

  const listOptions = (tracks: Track[]) => ({
    onPlay,
    onToggleFavorite,
    onAddToPlaylist,
    playingTrackId,
    showInlineLike: true,
  });

  const renderLiked = () => {
    if (likedTracks.length > 0 && likedToolbar) {
      likedToolbar.style.display = "flex";
    } else if (likedToolbar) {
      likedToolbar.style.display = "none";
    }
    renderTrackList(likedContainer, likedTracks, {
      ...listOptions(likedTracks),
      emptyMessage: "No liked tracks yet.",
    });
  };

  const renderLocal = () => {
    if (filtersMount) {
      filtersMount.hidden = !libraryHasTracks;
    }
    renderTrackList(localListEl, localTracks, {
      ...listOptions(localTracks),
      emptyMessage: "No tracks found in your music folder.",
    });
  };

  if (filterBar) {
    filterBar.onChange(() => {
      if (localPanelOpen) void refreshLocalOnly();
    });
  }

  wireInPageSearch(
    "library-liked-tracks-search",
    () => likedTracks,
    (filtered) => {
      renderTrackList(likedContainer, filtered, {
        ...listOptions(filtered),
        emptyMessage: "No liked tracks matched your search.",
      });
    },
  );

  async function refreshLocalOnly() {
    const query = filterBar ? filterStateToQuery(filterBar.getState()) : undefined;
    const fetchStart = performance.now();
    localTracks = await api.library.getTracks(query);
    devLog(
      "boot",
      `getTracks(local): ${localTracks.length} tracks (${Math.round(performance.now() - fetchStart)}ms)`,
    );
    renderLocal();
  }

  openLocalBtn?.addEventListener("click", () => {
    setLocalPanelOpen(true);
    localPanelOpen = true;
    void refreshLocalOnly();
  });
  closeLocalBtn?.addEventListener("click", () => {
    setLocalPanelOpen(false);
    localPanelOpen = false;
  });

  return {
    getPlayingTrackId: () => playingTrackId,
    setPlayingTrackId(id) {
      playingTrackId = id;
    },
    async refresh() {
      await Promise.all([this.refreshLiked(), localPanelOpen ? refreshLocalOnly() : Promise.resolve()]);
    },
    async refreshLiked() {
      likedTracks = await api.library.getFavorites();
      renderLiked();
    },
    async refreshLocalTracks() {
      if (!localPanelOpen) return;
      await refreshLocalOnly();
    },
    async refreshFacets() {
      const facetsStart = performance.now();
      const facets = await api.library.getLibraryFacets();
      devLog(
        "boot",
        `getLibraryFacets: ${facets.trackCount} tracks (${Math.round(performance.now() - facetsStart)}ms)`,
      );
      libraryHasTracks = facets.trackCount > 0;
      filterBar?.setFacets(facets);
      if (filtersMount) {
        filtersMount.hidden = !libraryHasTracks;
      }
    },
    setScanStatus(message: string) {
      if (statusEl) statusEl.textContent = message;
    },
    closeLocalPanel() {
      setLocalPanelOpen(false);
      localPanelOpen = false;
    },
  };
}

/** Fast boot path: facets + liked only (no full local track list). */
export async function loadCachedLibrary(page: LibraryPage): Promise<void> {
  const timer = new DevTimer("boot", "loadCachedLibrary");
  await page.refreshFacets();
  timer.step("refreshFacets");
  await page.refreshLiked();
  timer.step("refreshLiked");
  timer.finish("ok");
}

/** Start a background scan; UI should listen for `library:scan-complete`. */
export function startBackgroundLibraryScan(page: LibraryPage): void {
  page.setScanStatus("Scanning music library…");
  void api.library.startLibraryScan();
}

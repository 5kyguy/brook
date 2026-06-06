import * as api from "../api";
import { DevTimer, devLog } from "../api/dev-log";
import type { Track } from "../types";
import { applyTrackCovers, COVER_PLACEHOLDER } from "./cover-art";
import { filterStateToQuery, initFilterBar, type FilterBar } from "./filters";
import { trackArtist, trackLabel } from "./dom";
import { renderTrackList } from "./track-list";
import { wireInPageSearch } from "./search";
import { SVG_HEART, SVG_HEART_FILLED } from "./icons";

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

const LIKED_VIEW_KEY = "brook-liked-view";

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLikedGrid(
  container: HTMLElement,
  tracks: Track[],
  options: {
    onPlay: (track: Track, queue?: Track[]) => void;
    onToggleFavorite: (track: Track) => void;
    playingTrackId: string | null;
  },
): void {
  if (tracks.length === 0) {
    container.innerHTML = '<p class="placeholder-text">No liked tracks yet.</p>';
    return;
  }

  container.innerHTML = `<div class="library-liked-grid">${tracks
    .map((track) => {
      const isPlaying = options.playingTrackId === track.id;
      const title = escapeHtml(trackLabel(track));
      const artist = escapeHtml(trackArtist(track));
      return `
        <div class="library-liked-grid-item${isPlaying ? " playing" : ""}" data-track-id="${escapeHtml(track.id)}">
          <img class="library-liked-grid-cover" data-track-id="${escapeHtml(track.id)}" src="${COVER_PLACEHOLDER}" alt="" loading="lazy" />
          <button type="button" class="library-liked-grid-like like-btn${track.isFavorite ? " active" : ""}" title="${track.isFavorite ? "Unlike" : "Like"}">
            ${track.isFavorite ? SVG_HEART_FILLED(18) : SVG_HEART(18)}
          </button>
          <div class="library-liked-grid-meta">
            <div class="title">${title}</div>
            <div class="artist">${artist}</div>
          </div>
        </div>
      `;
    })
    .join("")}</div>`;

  applyTrackCovers(container);

  container.querySelectorAll<HTMLElement>(".library-liked-grid-item").forEach((item) => {
    const trackId = item.dataset.trackId;
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;

    item.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest(".library-liked-grid-like")) return;
      options.onPlay(track, tracks);
    });

    item.querySelector(".library-liked-grid-like")?.addEventListener("click", (event) => {
      event.stopPropagation();
      options.onToggleFavorite(track);
    });
  });
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
  const likedListBtn = document.getElementById("library-liked-tracks-view-list");
  const likedGridBtn = document.getElementById("library-liked-tracks-view-grid");

  if (!likedContainer || !localListEl) {
    throw new Error("Missing library containers");
  }

  let likedTracks: Track[] = [];
  let localTracks: Track[] = [];
  let playingTrackId: string | null = null;
  let libraryHasTracks = false;
  let localPanelOpen = false;
  let likedView: "list" | "grid" =
    localStorage.getItem(LIKED_VIEW_KEY) === "grid" ? "grid" : "list";
  const filterBar: FilterBar | null = filtersMount ? initFilterBar(filtersMount) : null;

  const listOptions = (tracks: Track[]) => ({
    onPlay,
    onToggleFavorite,
    onAddToPlaylist,
    playingTrackId,
    showInlineLike: true,
  });

  const syncLikedViewButtons = () => {
    likedListBtn?.classList.toggle("active", likedView === "list");
    likedGridBtn?.classList.toggle("active", likedView === "grid");
    likedContainer.classList.toggle("grid-view", likedView === "grid");
  };

  const renderLiked = () => {
    if (likedTracks.length > 0 && likedToolbar) {
      likedToolbar.style.display = "flex";
    } else if (likedToolbar) {
      likedToolbar.style.display = "none";
    }
    syncLikedViewButtons();

    if (likedView === "grid") {
      renderLikedGrid(likedContainer, likedTracks, {
        onPlay,
        onToggleFavorite,
        playingTrackId,
      });
      return;
    }

    renderTrackList(likedContainer, likedTracks, {
      ...listOptions(likedTracks),
      emptyMessage: "No liked tracks yet.",
    });
  };

  likedListBtn?.addEventListener("click", () => {
    likedView = "list";
    localStorage.setItem(LIKED_VIEW_KEY, "list");
    renderLiked();
  });

  likedGridBtn?.addEventListener("click", () => {
    likedView = "grid";
    localStorage.setItem(LIKED_VIEW_KEY, "grid");
    renderLiked();
  });

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
      if (likedView === "grid") {
        renderLikedGrid(likedContainer, filtered, {
          onPlay,
          onToggleFavorite,
          playingTrackId,
        });
        return;
      }
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

import { getTracksCount, getTracksPage } from "../api/library";
import type { Track, TrackFilter } from "../types";
import { applyTrackCovers } from "./cover-art";
import { createTrackItemInnerHTML } from "./track-list";

/**
 * Page size used both for backend fetches and for the on-demand page cache.
 * Aligned to multiples of PAGE so a page keyed by its start offset is reused
 * for any visible window that falls inside it.
 */
const PAGE = 200;
/** Extra rows rendered above and below the viewport so short scrolls do not
 *  flash placeholders. Kept small per the plan: measure before fancier
 *  recycling. */
const OVERSCAN = 8;
const DEFAULT_ROW_HEIGHT = 56;

export interface VirtualListActions {
  onPlay: (track: Track, queue?: Track[]) => void;
  onToggleFavorite: (track: Track) => void;
  onAddToPlaylist?: (track: Track) => void;
  onRemoveFromPlaylist?: (track: Track) => void;
}

export interface VirtualListOptions extends VirtualListActions {
  showInlineLike?: boolean;
  showRemoveAction?: boolean;
  getPlayingTrackId: () => string | null;
  getFilter: () => TrackFilter | undefined;
  emptyMessage?: string;
}

/**
 * A viewport recycler for the local track list. Only the visible window
 * (plus a small overscan) is in the DOM; the rest of the library is faked
 * with top/bottom spacers sized to `totalCount * rowHeight`. Track data is
 * fetched on demand in PAGE-sized pages from the backend (`get_tracks_page`)
 * and cached, so the frontend never holds the whole library in memory.
 *
 * Clicks are handled by a single delegated listener on the list element, so
 * recycled rows never accumulate duplicate listeners.
 */
export class VirtualTrackList {
  private readonly scrollRoot: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly options: VirtualListOptions;

  private totalCount = 0;
  /** Pages keyed by their start offset (a multiple of PAGE). */
  private readonly pages = new Map<number, Track[]>();
  private readonly loadingPages = new Set<number>();
  /** id -> Track, for delegated click resolution. */
  private readonly idIndex = new Map<string, Track>();

  private rowHeight = DEFAULT_ROW_HEIGHT;
  private measured = false;
  private first = 0;
  private last = 0;
  private visibleTracks: Track[] = [];

  private readonly pool: HTMLElement[] = [];
  /** pool slot -> absolute track index currently rendered there. */
  private readonly slotIndex = new Map<number, number>();

  private topSpacer: HTMLElement;
  private bottomSpacer: HTMLElement;
  private rafPending = false;
  private scrollHandler: () => void;
  private delegated = false;
  private empty = false;

  constructor(
    scrollRoot: HTMLElement,
    listEl: HTMLElement,
    options: VirtualListOptions,
  ) {
    this.scrollRoot = scrollRoot;
    this.listEl = listEl;
    this.options = options;

    this.topSpacer = document.createElement("div");
    this.topSpacer.className = "virtual-list-spacer";
    this.bottomSpacer = document.createElement("div");
    this.bottomSpacer.className = "virtual-list-spacer";

    this.scrollHandler = () => this.schedulePaint();
  }

  /** Re-fetch the total count and reset the cache for a new filter. */
  async reset(): Promise<void> {
    this.pages.clear();
    this.loadingPages.clear();
    this.idIndex.clear();
    this.slotIndex.clear();
    this.totalCount = 0;
    this.first = 0;
    this.last = 0;
    this.empty = false;
    this.measured = false;
    for (const row of this.pool) row.remove();
    this.pool.length = 0;

    try {
      this.totalCount = await getTracksCount(this.options.getFilter());
    } catch {
      this.totalCount = 0;
    }

    this.mountSpacers();
    if (this.totalCount === 0) {
      this.showEmpty();
      return;
    }
    this.scrollRoot.scrollTop = 0;
    this.schedulePaint();
  }

  private mountSpacers(): void {
    if (!this.topSpacer.isConnected) this.listEl.appendChild(this.topSpacer);
    if (!this.bottomSpacer.isConnected) this.listEl.appendChild(this.bottomSpacer);
  }

  private showEmpty(): void {
    this.empty = true;
    this.topSpacer.style.height = "0px";
    this.bottomSpacer.style.height = "0px";
    for (const row of this.pool) row.remove();
    this.pool.length = 0;
    this.listEl.innerHTML = `<p class="placeholder-text">${this.options.emptyMessage ?? "No tracks to show."}</p>`;
  }

  attach(): void {
    this.scrollRoot.addEventListener("scroll", this.scrollHandler, { passive: true });
    if (!this.delegated) {
      this.listEl.addEventListener("click", (event) => this.handleClick(event));
      this.delegated = true;
    }
  }

  detach(): void {
    this.scrollRoot.removeEventListener("scroll", this.scrollHandler);
  }

  /** Force a re-render (e.g. after the playing track changed). */
  invalidate(): void {
    this.schedulePaint();
  }

  get count(): number {
    return this.totalCount;
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const row = target.closest<HTMLElement>(".track-item");
    if (!row) return;
    const trackId = row.dataset.trackId;
    if (!trackId) return;
    const track = this.idIndex.get(trackId);
    if (!track) return;

    if (target.closest(".like-btn")) {
      event.stopPropagation();
      this.options.onToggleFavorite(track);
      return;
    }
    if (target.closest(".playlist-remove-btn") && this.options.onRemoveFromPlaylist) {
      event.stopPropagation();
      this.options.onRemoveFromPlaylist(track);
      return;
    }
    if (target.closest(".track-menu-btn") && this.options.onAddToPlaylist) {
      event.stopPropagation();
      this.options.onAddToPlaylist(track);
      return;
    }
    this.options.onPlay(track, this.visibleTracks);
  }

  private ensurePage(pageStart: number): void {
    if (this.pages.has(pageStart) || this.loadingPages.has(pageStart)) return;
    this.loadingPages.add(pageStart);
    const filter = this.options.getFilter();
    void getTracksPage({ ...filter, limit: PAGE, offset: pageStart })
      .then((page) => {
        this.pages.set(pageStart, page.tracks);
        for (const t of page.tracks) this.idIndex.set(t.id, t);
        this.schedulePaint();
      })
      .catch(() => {
        this.loadingPages.delete(pageStart);
      })
      .finally(() => {
        this.loadingPages.delete(pageStart);
      });
  }

  private getTrack(index: number): Track | undefined {
    if (index < 0 || index >= this.totalCount) return undefined;
    const pageStart = Math.floor(index / PAGE) * PAGE;
    const page = this.pages.get(pageStart);
    if (!page) return undefined;
    return page[index - pageStart];
  }

  private measureRowHeight(): void {
    if (this.measured) return;
    // Use the first recycled row that has real content. Its height drives the
    // spacer math; a one-time minor reflow is acceptable and the overscan
    // covers any off-by-a-row error before measurement completes.
    const row = this.pool.find(
      (r, i) => i < this.last - this.first && r.dataset.trackId,
    );
    if (!row) return;
    const h = row.getBoundingClientRect().height;
    if (h > 0) this.rowHeight = h;
    this.measured = true;
    // Re-apply spacers with the now-known height so the scroll height matches.
    this.topSpacer.style.height = `${this.first * this.rowHeight}px`;
    this.bottomSpacer.style.height = `${Math.max(0, (this.totalCount - this.last) * this.rowHeight)}px`;
  }

  private schedulePaint(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.paint();
    });
  }

  private paint(): void {
    if (this.empty) return;

    const scrollTop = this.scrollRoot.scrollTop;
    const viewport = this.scrollRoot.clientHeight;
    const first = Math.max(0, Math.floor(scrollTop / this.rowHeight) - OVERSCAN);
    const last = Math.min(
      this.totalCount,
      Math.ceil((scrollTop + viewport) / this.rowHeight) + OVERSCAN,
    );
    this.first = first;
    this.last = last;

    // Ensure pages covering [first, last) are loaded (or loading).
    if (last > first) {
      const firstPage = Math.floor(first / PAGE) * PAGE;
      const lastPage = Math.floor((last - 1) / PAGE) * PAGE;
      for (let ps = firstPage; ps <= lastPage; ps += PAGE) this.ensurePage(ps);
    }

    // Spacers carry the full scroll height.
    this.topSpacer.style.height = `${first * this.rowHeight}px`;
    this.bottomSpacer.style.height = `${Math.max(0, (this.totalCount - last) * this.rowHeight)}px`;

    const visibleCount = last - first;
    this.mountSpacers();

    // Grow the pool to fit the visible window.
    while (this.pool.length < visibleCount) {
      const row = document.createElement("div");
      this.listEl.insertBefore(row, this.bottomSpacer);
      this.pool.push(row);
    }
    // Hide any excess pool rows (e.g. when the viewport shrinks).
    for (let i = visibleCount; i < this.pool.length; i++) {
      const row = this.pool[i];
      row.style.display = "none";
      row.removeAttribute("data-track-id");
    }

    const playingTrackId = this.options.getPlayingTrackId();
    const showLike = this.options.showInlineLike !== false;
    const changedRows: HTMLElement[] = [];
    const visibleTracks: Track[] = [];

    for (let slot = 0; slot < visibleCount; slot++) {
      const index = first + slot;
      const row = this.pool[slot];
      const track = this.getTrack(index);
      if (track) {
        visibleTracks.push(track);
        const prevIndex = this.slotIndex.get(slot);
        if (prevIndex !== index) {
          row.className = `track-item${playingTrackId === track.id ? " playing" : ""}${showLike ? " track-item--inline-like" : ""}`;
          row.setAttribute("data-track-id", track.id);
          row.setAttribute("data-type", "track");
          row.innerHTML = createTrackItemInnerHTML(track, {
            onPlay: this.options.onPlay,
            onToggleFavorite: this.options.onToggleFavorite,
            onAddToPlaylist: this.options.onAddToPlaylist,
            onRemoveFromPlaylist: this.options.onRemoveFromPlaylist,
            showInlineLike: showLike,
            showRemoveAction: this.options.showRemoveAction,
            playingTrackId,
          });
          this.slotIndex.set(slot, index);
          changedRows.push(row);
        } else {
          // Same track as last paint; only refresh the playing highlight.
          row.classList.toggle("playing", playingTrackId === track.id);
        }
        row.style.display = "";
      } else {
        // Page not loaded yet: keep the slot at full height so the scroll
        // height stays correct, but render an empty placeholder row.
        if (this.slotIndex.get(slot) !== -1) {
          row.className = "track-item track-item--placeholder";
          row.removeAttribute("data-track-id");
          row.innerHTML = "";
          this.slotIndex.set(slot, -1);
          changedRows.push(row);
        }
        row.style.display = "";
      }
    }

    this.visibleTracks = visibleTracks;

    this.measureRowHeight();

    if (changedRows.length > 0) {
      applyTrackCovers(this.listEl);
    }
  }
}

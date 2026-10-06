import type { Track } from "../types";
import { applyTrackCovers, COVER_PLACEHOLDER } from "./cover-art";
import { formatDuration, trackArtist, trackLabel } from "./dom";
import { SVG_HEART, SVG_HEART_FILLED, SVG_MENU } from "./icons";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function heartIcon(filled: boolean, size = 20): string {
  return filled ? SVG_HEART_FILLED(size) : SVG_HEART(size);
}

export interface TrackListActions {
  onPlay: (track: Track, queue?: Track[]) => void;
  onToggleFavorite: (track: Track) => void;
  onAddToPlaylist?: (track: Track) => void;
  onRemoveFromPlaylist?: (track: Track) => void;
}

export interface TrackListOptions extends TrackListActions {
  showInlineLike?: boolean;
  showRemoveAction?: boolean;
  playingTrackId?: string | null;
  emptyMessage?: string;
}

function trackItemClassName(track: Track, options: TrackListOptions): string {
  const isPlaying = options.playingTrackId === track.id;
  const showLike = options.showInlineLike !== false;
  return `track-item${isPlaying ? " playing" : ""}${showLike ? " track-item--inline-like" : ""}`;
}

/** Inner content of a `.track-item` row (no wrapper div). The virtual
 *  recycler reuses a `.track-item` element and only swaps this content. */
export function createTrackItemInnerHTML(
  track: Track,
  options: TrackListOptions,
): string {
  const title = escapeHtml(trackLabel(track));
  const artist = escapeHtml(trackArtist(track));
  const duration =
    track.durationSecs != null ? formatDuration(track.durationSecs) : "--:--";

  const inlineLike =
    options.showInlineLike !== false
      ? `<div class="track-item-inline-like">
        <button type="button" class="like-btn track-row-like-btn${track.isFavorite ? " active" : ""}" title="${track.isFavorite ? "Unlike" : "Like"}">
          ${heartIcon(track.isFavorite)}
        </button>
      </div>`
      : "";

  const removeBtn =
    options.showRemoveAction && options.onRemoveFromPlaylist
      ? `<button type="button" class="playlist-remove-btn track-menu-btn" title="Remove from playlist">${SVG_MENU(20)}</button>`
      : `<button type="button" class="track-menu-btn" title="More options">${SVG_MENU(20)}</button>`;

  return `
      <div class="track-item-info">
        <img
          class="track-item-cover"
          data-track-id="${escapeHtml(track.id)}"
          src="${COVER_PLACEHOLDER}"
          alt=""
          loading="lazy"
        />
        <div class="track-item-details">
          <div class="title">${title}</div>
          <div class="artist">${artist}</div>
        </div>
      </div>
      ${inlineLike}
      <div class="track-item-duration">${duration}</div>
      <div class="track-item-actions">${removeBtn}</div>
  `;
}

function createTrackItemHTML(
  track: Track,
  options: TrackListOptions,
): string {
  return `
    <div class="${trackItemClassName(track, options)}"
         data-track-id="${escapeHtml(track.id)}"
         data-type="track">
      ${createTrackItemInnerHTML(track, options)}
    </div>
  `;
}

const TRACK_RENDER_BATCH = 40;

function wireTrackRows(
  rows: HTMLElement[],
  tracks: Track[],
  options: TrackListOptions,
  queueTracks: Track[] = tracks,
): void {
  for (const row of rows) {
    const trackId = row.dataset.trackId;
    const track = tracks.find((t) => t.id === trackId);
    if (!track) continue;

    row.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest(".like-btn")) {
        event.stopPropagation();
        void options.onToggleFavorite(track);
        return;
      }
      if (target.closest(".playlist-remove-btn") && options.onRemoveFromPlaylist) {
        event.stopPropagation();
        void options.onRemoveFromPlaylist(track);
        return;
      }
      if (target.closest(".track-menu-btn") && options.onAddToPlaylist) {
        event.stopPropagation();
        void options.onAddToPlaylist(track);
        return;
      }
      options.onPlay(track, queueTracks);
    });
  }
}

function wireTrackListRows(container: HTMLElement, tracks: Track[], options: TrackListOptions): void {
  const rows = Array.from(container.querySelectorAll<HTMLElement>(".track-item"));
  wireTrackRows(rows, tracks, options);
}

function renderTrackListSync(
  container: HTMLElement,
  tracks: Track[],
  options: TrackListOptions,
): void {
  container.innerHTML = tracks.map((track) => createTrackItemHTML(track, options)).join("");
  applyTrackCovers(container);
  wireTrackListRows(container, tracks, options);
}

function renderTrackListBatched(
  container: HTMLElement,
  tracks: Track[],
  options: TrackListOptions,
): void {
  container.replaceChildren();
  let index = 0;

  const renderBatch = () => {
    const slice = tracks.slice(index, index + TRACK_RENDER_BATCH);
    if (slice.length === 0) {
      wireTrackListRows(container, tracks, options);
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.innerHTML = slice.map((track) => createTrackItemHTML(track, options)).join("");
    while (wrapper.firstChild) {
      container.appendChild(wrapper.firstChild);
    }
    applyTrackCovers(container);
    index += slice.length;
    requestAnimationFrame(renderBatch);
  };

  requestAnimationFrame(renderBatch);
}

export function renderTrackList(
  container: HTMLElement,
  tracks: Track[],
  options: TrackListOptions,
): void {
  container.classList.remove("card-grid");
  container.classList.add("track-list");

  if (tracks.length === 0) {
    container.innerHTML = `<p class="placeholder-text">${options.emptyMessage ?? "No tracks to show."}</p>`;
    return;
  }

  if (tracks.length > TRACK_RENDER_BATCH) {
    renderTrackListBatched(container, tracks, options);
    return;
  }

  renderTrackListSync(container, tracks, options);
}

/**
 * Append `tracks` to `container` without clearing the existing rows, wiring
 * only the newly added rows (so existing rows keep their listeners and are
 * not re-wired). Used by the paged local list to grow the DOM one page at a
 * time. Assumes `container` already holds track rows from a prior
 * `renderTrackList`/`appendTrackList` call with the same `options`.
 */
export function appendTrackList(
  container: HTMLElement,
  tracks: Track[],
  options: TrackListOptions,
  queueTracks?: Track[],
): void {
  if (tracks.length === 0) return;

  // If a placeholder ("No tracks") is present, drop it before appending.
  const placeholder = container.querySelector(".placeholder-text");
  if (placeholder) placeholder.remove();

  const wrapper = document.createElement("div");
  wrapper.innerHTML = tracks.map((track) => createTrackItemHTML(track, options)).join("");
  const newRows: HTMLElement[] = [];
  while (wrapper.firstChild) {
    const node = wrapper.firstChild as HTMLElement;
    if (node.classList?.contains("track-item")) newRows.push(node);
    container.appendChild(node);
  }
  applyTrackCovers(container);
  // Wire only the newly appended rows so existing rows keep their listeners.
  // `queueTracks` (defaults to this slice) is the play queue passed to onPlay.
  wireTrackRows(newRows, tracks, options, queueTracks ?? tracks);
}

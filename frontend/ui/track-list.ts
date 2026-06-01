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

export function createTrackItemHTML(
  track: Track,
  options: TrackListOptions,
): string {
  const isPlaying = options.playingTrackId === track.id;
  const showLike = options.showInlineLike !== false;
  const title = escapeHtml(trackLabel(track));
  const artist = escapeHtml(trackArtist(track));
  const duration =
    track.durationSecs != null ? formatDuration(track.durationSecs) : "--:--";

  const inlineLike = showLike
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
    <div class="track-item${isPlaying ? " playing" : ""}${showLike ? " track-item--inline-like" : ""}"
         data-track-id="${escapeHtml(track.id)}"
         data-type="track">
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
    </div>
  `;
}

const TRACK_RENDER_BATCH = 40;

function wireTrackListRows(container: HTMLElement, tracks: Track[], options: TrackListOptions): void {
  container.querySelectorAll<HTMLElement>(".track-item").forEach((row) => {
    const trackId = row.dataset.trackId;
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;

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
        options.onAddToPlaylist(track);
        return;
      }
      options.onPlay(track, tracks);
    });
  });
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

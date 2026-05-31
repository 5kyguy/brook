import type { Track } from "../types";
import { formatDuration, trackLabel, trackSubtitle } from "./dom";
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

const TRACKLIST_HEADER_HTML = `
  <div class="track-list-header">
    <span style="width: 40px; text-align: center;">#</span>
    <span>Title</span>
    <span class="track-list-header-spacer" aria-hidden="true"></span>
    <span class="duration-header">Duration</span>
    <span style="display: flex; justify-content: flex-end; opacity: 0.8;">Menu</span>
  </div>
`;

export function createTrackItemHTML(
  track: Track,
  index: number,
  options: TrackListOptions,
): string {
  const isPlaying = options.playingTrackId === track.id;
  const showLike = options.showInlineLike !== false;
  const title = escapeHtml(trackLabel(track));
  const artist = escapeHtml(trackSubtitle(track));
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
      <div class="track-number">${index + 1}</div>
      <div class="track-item-info">
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

  container.innerHTML =
    TRACKLIST_HEADER_HTML +
    tracks.map((track, index) => createTrackItemHTML(track, index, options)).join("");

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

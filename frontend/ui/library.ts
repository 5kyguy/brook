import * as api from "../api";
import type { Track } from "../types";
import { clearChildren, el, formatDuration, trackLabel, trackSubtitle } from "./dom";

export interface LibraryPage {
  refresh(): Promise<void>;
  setScanStatus(message: string): void;
}

export function initLibraryPage(
  onPlay: (track: Track) => void,
  onToggleFavorite: (track: Track) => void,
): LibraryPage {
  const statusEl = document.getElementById("library-scan-status");
  const listEl = document.getElementById("library-track-list");
  if (!listEl) {
    throw new Error("Missing #library-track-list");
  }

  let tracks: Track[] = [];

  const render = () => {
    clearChildren(listEl);
    if (tracks.length === 0) {
      listEl.appendChild(el("p", "empty-state", "No tracks found in your music folder."));
      return;
    }

    const header = el("div", "track-list-header");
    header.append(
      el("span", "", "#"),
      el("span", "", "Title"),
      el("span", "", "Album"),
      el("span", "", "Duration"),
      el("span", "", ""),
    );
    listEl.appendChild(header);

    tracks.forEach((track, index) => {
      const row = el("button", "track-item");
      row.type = "button";
      row.dataset.trackId = track.id;

      const indexCell = el("span", "track-index", String(index + 1));
      const main = el("div", "track-main");
      const title = el("span", "track-title", trackLabel(track));
      const artist = el("span", "track-artist", trackSubtitle(track));
      main.append(title, artist);

      const album = el("span", "track-album", track.album ?? "—");
      const duration = el(
        "span",
        "track-duration",
        track.durationSecs != null ? formatDuration(track.durationSecs) : "—",
      );

      const like = el("button", `like-btn${track.isFavorite ? " active" : ""}`);
      like.type = "button";
      like.title = track.isFavorite ? "Unlike" : "Like";
      like.textContent = track.isFavorite ? "♥" : "♡";
      like.addEventListener("click", (event) => {
        event.stopPropagation();
        void onToggleFavorite(track);
      });

      row.append(indexCell, main, album, duration, like);
      row.addEventListener("click", () => onPlay(track));
      listEl.appendChild(row);
    });
  };

  return {
    async refresh() {
      tracks = await api.library.getTracks({ sortBy: "title", sortOrder: "asc" });
      render();
    },
    setScanStatus(message: string) {
      if (statusEl) statusEl.textContent = message;
    },
  };
}

export async function scanAndLoadLibrary(page: LibraryPage): Promise<void> {
  page.setScanStatus("Scanning music library…");
  await api.library.scanLibrary();
  await page.refresh();
  page.setScanStatus("");
}

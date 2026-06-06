import * as api from "../api";
import type { Track } from "../types";
import { renderTrackList, type TrackListActions } from "./track-list";

export interface SearchPage {
  search(query: string): Promise<void>;
}

export function initSearchPage(actions: TrackListActions): SearchPage {
  const container = document.getElementById("search-results-container");
  const titleEl = document.getElementById("search-results-title");
  const input = document.getElementById("search-input") as HTMLInputElement | null;
  let playingTrackId: string | null = null;
  let lastQuery = "";

  const render = (tracks: Track[], query: string) => {
    if (titleEl) {
      titleEl.textContent = query
        ? `Results for “${query}”`
        : "Search your library";
    }
    if (!container) return;
    renderTrackList(container, tracks, {
      ...actions,
      playingTrackId,
      emptyMessage: query ? "No tracks matched your search." : "Enter a search term above.",
    });
  };

  return {
    async search(query) {
      lastQuery = query.trim();
      if (!lastQuery) {
        render([], "");
        return;
      }
      const tracks = await api.library.getTracks({ query: lastQuery, sortBy: "title" });
      render(tracks, lastQuery);
    },
  };
}

export function initGlobalSearch(
  onSearch: (query: string) => void,
): void {
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input") as HTMLInputElement | null;
  const clearBtn = form?.querySelector<HTMLButtonElement>(".search-clear-btn");

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input?.value.trim() ?? "";
    if (!query) return;
    onSearch(query);
  });

  input?.addEventListener("input", () => {
    if (clearBtn) {
      clearBtn.style.display = input.value ? "" : "none";
    }
  });

  clearBtn?.addEventListener("click", () => {
    if (!input) return;
    input.value = "";
    clearBtn.style.display = "none";
    input.focus();
  });
}

export function wireInPageSearch(
  inputId: string,
  tracks: () => Track[],
  renderFn: (filtered: Track[]) => void,
): void {
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  const form = input?.closest("form");
  const clearBtn = form?.querySelector<HTMLButtonElement>(".search-clear-btn");

  const apply = () => {
    const query = input?.value.trim().toLowerCase() ?? "";
    if (clearBtn) clearBtn.style.display = query ? "" : "none";
    if (!query) {
      renderFn(tracks());
      return;
    }
    renderFn(
      tracks().filter((track) => {
        const haystack = [
          track.title,
          track.artist,
          track.album,
          track.relativePath,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      }),
    );
  };

  form?.addEventListener("submit", (event) => event.preventDefault());
  input?.addEventListener("input", apply);
  clearBtn?.addEventListener("click", () => {
    if (!input) return;
    input.value = "";
    apply();
    input.focus();
  });
}

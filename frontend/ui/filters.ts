import type { LibraryFacets, Track, TrackFilter } from "../types";
import { el } from "./dom";

export interface LibraryFilterState {
  artist: string;
  album: string;
  year: string;
  sortBy: NonNullable<TrackFilter["sortBy"]>;
  sortOrder: NonNullable<TrackFilter["sortOrder"]>;
}

export const DEFAULT_FILTER_STATE: LibraryFilterState = {
  artist: "",
  album: "",
  year: "",
  sortBy: "title",
  sortOrder: "asc",
};

export function buildFacets(tracks: Track[]): LibraryFacets {
  const artists = new Set<string>();
  const albums = new Set<string>();
  const years = new Set<number>();

  for (const track of tracks) {
    if (track.artist?.trim()) artists.add(track.artist.trim());
    if (track.album?.trim()) albums.add(track.album.trim());
    if (track.year != null) years.add(track.year);
  }

  return {
    artists: [...artists].sort((a, b) => a.localeCompare(b)),
    albums: [...albums].sort((a, b) => a.localeCompare(b)),
    years: [...years].sort((a, b) => b - a),
  };
}

export function filterStateToQuery(state: LibraryFilterState): TrackFilter {
  return {
    artist: state.artist || undefined,
    album: state.album || undefined,
    year: state.year ? Number(state.year) : undefined,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
  };
}

export interface FilterBar {
  getState(): LibraryFilterState;
  setFacets(facets: LibraryFacets): void;
  onChange(handler: (state: LibraryFilterState) => void): void;
}

export function initFilterBar(container: HTMLElement): FilterBar {
  let state = { ...DEFAULT_FILTER_STATE };
  let facets: LibraryFacets = { artists: [], albums: [], years: [] };
  let changeHandler: ((state: LibraryFilterState) => void) | null = null;

  const artistSelect = el("select", "filter-select");
  const albumSelect = el("select", "filter-select");
  const yearSelect = el("select", "filter-select");
  const sortSelect = el("select", "filter-select");
  const orderSelect = el("select", "filter-select");
  const clearBtn = el("button", "filter-clear-btn", "Clear");

  container.className = "library-liked-tracks-toolbar";
  container.append(
    el("label", "filter-field", "Artist"),
    artistSelect,
    el("label", "filter-field", "Album"),
    albumSelect,
    el("label", "filter-field", "Year"),
    yearSelect,
    el("label", "filter-field", "Sort"),
    sortSelect,
    el("label", "filter-field", "Order"),
    orderSelect,
    clearBtn,
  );

  sortSelect.innerHTML = `
    <option value="title">Title</option>
    <option value="artist">Artist</option>
    <option value="album">Album</option>
    <option value="year">Year</option>
  `;
  orderSelect.innerHTML = `
    <option value="asc">Ascending</option>
    <option value="desc">Descending</option>
  `;

  const fillSelect = (
    select: HTMLSelectElement,
    values: Array<string | number>,
    current: string,
    allLabel: string,
  ) => {
    const previous = current || select.value;
    select.innerHTML = `<option value="">${allLabel}</option>`;
    for (const value of values) {
      const option = el("option");
      option.value = String(value);
      option.textContent = String(value);
      select.appendChild(option);
    }
    select.value = values.map(String).includes(previous) ? previous : "";
  };

  const notify = () => {
    changeHandler?.(state);
  };

  const updateStateFromInputs = () => {
    state = {
      artist: artistSelect.value,
      album: albumSelect.value,
      year: yearSelect.value,
      sortBy: sortSelect.value as LibraryFilterState["sortBy"],
      sortOrder: orderSelect.value as LibraryFilterState["sortOrder"],
    };
  };

  for (const select of [artistSelect, albumSelect, yearSelect, sortSelect, orderSelect]) {
    select.addEventListener("change", () => {
      updateStateFromInputs();
      notify();
    });
  }

  clearBtn.type = "button";
  clearBtn.addEventListener("click", () => {
    state = { ...DEFAULT_FILTER_STATE };
    artistSelect.value = "";
    albumSelect.value = "";
    yearSelect.value = "";
    sortSelect.value = state.sortBy;
    orderSelect.value = state.sortOrder;
    notify();
  });

  sortSelect.value = state.sortBy;
  orderSelect.value = state.sortOrder;

  return {
    getState: () => state,
    setFacets(next) {
      facets = next;
      fillSelect(artistSelect, facets.artists, state.artist, "All artists");
      fillSelect(albumSelect, facets.albums, state.album, "All albums");
      fillSelect(yearSelect, facets.years, state.year, "All years");
    },
    onChange(handler) {
      changeHandler = handler;
    },
  };
}

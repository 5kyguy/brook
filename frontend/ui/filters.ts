import type { LibraryFacets, TrackFilter } from "../types";
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

const SORT_OPTIONS: Array<{
  value: `${LibraryFilterState["sortBy"]}:${LibraryFilterState["sortOrder"]}`;
  label: string;
}> = [
  { value: "title:asc", label: "Title (A–Z)" },
  { value: "title:desc", label: "Title (Z–A)" },
  { value: "artist:asc", label: "Artist (A–Z)" },
  { value: "artist:desc", label: "Artist (Z–A)" },
  { value: "album:asc", label: "Album (A–Z)" },
  { value: "album:desc", label: "Album (Z–A)" },
  { value: "year:desc", label: "Year (newest)" },
  { value: "year:asc", label: "Year (oldest)" },
];

function sortValue(state: LibraryFilterState): string {
  return `${state.sortBy}:${state.sortOrder}`;
}

function parseSortValue(value: string): Pick<LibraryFilterState, "sortBy" | "sortOrder"> {
  const [sortBy, sortOrder] = value.split(":") as [
    LibraryFilterState["sortBy"],
    LibraryFilterState["sortOrder"],
  ];
  return { sortBy, sortOrder };
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

function isFilterActive(state: LibraryFilterState): boolean {
  return Boolean(state.artist || state.album || state.year);
}

export interface FilterBar {
  getState(): LibraryFilterState;
  setFacets(facets: LibraryFacets): void;
  onChange(handler: (state: LibraryFilterState) => void): void;
}

function createFilterGroup(
  labelText: string,
  select: HTMLSelectElement,
  id: string,
): HTMLElement {
  select.id = id;
  const group = el("div", "library-filter-group");
  const labelEl = el("label", "library-filter-label", labelText);
  labelEl.htmlFor = id;
  group.append(labelEl, select);
  return group;
}

export function initFilterBar(container: HTMLElement): FilterBar {
  let state = { ...DEFAULT_FILTER_STATE };
  let facets: LibraryFacets = { artists: [], albums: [], years: [] };
  let changeHandler: ((state: LibraryFilterState) => void) | null = null;

  container.className = "library-filters-bar";
  container.replaceChildren();

  const header = el("div", "library-filters-header");
  const title = el("span", "library-filters-title", "Filter & sort");
  const clearBtn = el("button", "btn-secondary library-filters-clear", "Clear filters");
  clearBtn.type = "button";
  clearBtn.disabled = true;
  header.append(title, clearBtn);

  const row = el("div", "library-filters-row");

  const artistSelect = el("select", "library-filter-select");
  const albumSelect = el("select", "library-filter-select");
  const yearSelect = el("select", "library-filter-select");
  const sortSelect = el("select", "library-filter-select");

  sortSelect.innerHTML = SORT_OPTIONS.map(
    (opt) => `<option value="${opt.value}">${opt.label}</option>`,
  ).join("");

  row.append(
    createFilterGroup("Artist", artistSelect, "library-filter-artist"),
    createFilterGroup("Album", albumSelect, "library-filter-album"),
    createFilterGroup("Year", yearSelect, "library-filter-year"),
    createFilterGroup("Sort by", sortSelect, "library-filter-sort"),
  );

  container.append(header, row);

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

  const syncChrome = () => {
    const active = isFilterActive(state);
    container.classList.toggle("has-active-filters", active);
    clearBtn.disabled = !active;
  };

  const notify = () => {
    syncChrome();
    changeHandler?.(state);
  };

  const updateStateFromInputs = () => {
    const { sortBy, sortOrder } = parseSortValue(sortSelect.value);
    state = {
      artist: artistSelect.value,
      album: albumSelect.value,
      year: yearSelect.value,
      sortBy,
      sortOrder,
    };
  };

  for (const select of [artistSelect, albumSelect, yearSelect, sortSelect]) {
    select.addEventListener("change", () => {
      updateStateFromInputs();
      notify();
    });
  }

  clearBtn.addEventListener("click", () => {
    state = { ...DEFAULT_FILTER_STATE };
    artistSelect.value = "";
    albumSelect.value = "";
    yearSelect.value = "";
    sortSelect.value = sortValue(state);
    notify();
  });

  sortSelect.value = sortValue(state);
  syncChrome();

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

import * as api from "../api";
import type {
  RankedArtist,
  RankedGenre,
  RankedTrack,
  RankedYear,
  StatsSummary,
  Track,
  YearlyWrap,
} from "../types";
import { formatListenDuration } from "../api/stats";
import { renderTrackList } from "./track-list";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function placeholder(message: string): string {
  return `<p style="padding: 1rem 0; opacity: 0.75;">${escapeHtml(message)}</p>`;
}

type HighlightCard = { label: string; value: string; detail: string };

const STATS_NA = "N/A";

function rankedDetail(item: { playCount: number; totalSecs: number }): string {
  return `${item.playCount} plays · ${formatListenDuration(item.totalSecs)}`;
}

function buildYearTabList(yearsFromDb: number[]): number[] {
  const currentYear = new Date().getFullYear();
  const set = new Set(yearsFromDb);
  set.add(currentYear);
  return [...set].sort((a, b) => b - a);
}

function highlightCardsFromSummary(summary: StatsSummary): HighlightCard[] {
  return cardsFromMetrics({
    totalListenSecs: summary.totalListenSecs,
    totalPlays: summary.totalPlays,
    uniqueTracks: summary.uniqueTracks,
    fullListens: summary.fullListens,
    topArtist: summary.topArtist,
    topGenre: summary.topGenre,
    topYear: summary.topYear,
  });
}

function highlightCardsFromWrap(wrap: YearlyWrap): HighlightCard[] {
  return cardsFromMetrics({
    totalListenSecs: wrap.totalListenSecs,
    totalPlays: wrap.totalPlays,
    uniqueTracks: wrap.uniqueTracks,
    fullListens: wrap.fullListens,
    topArtist: wrap.topArtists[0] ?? null,
    topGenre: wrap.topGenre,
    topYear: wrap.topYear,
  });
}

function cardsFromMetrics(metrics: {
  totalListenSecs: number;
  totalPlays: number;
  uniqueTracks: number;
  fullListens: number;
  topArtist: RankedArtist | null;
  topGenre: RankedGenre | null;
  topYear: RankedYear | null;
}): HighlightCard[] {
  return [
    {
      label: "Listening time",
      value: formatListenDuration(metrics.totalListenSecs),
      detail: `${metrics.totalPlays} plays · ${metrics.uniqueTracks} tracks`,
    },
    {
      label: "Full listens",
      value: String(metrics.fullListens),
      detail: "Tracks played through to the end",
    },
    {
      label: "Top artist",
      value: metrics.topArtist ? escapeHtml(metrics.topArtist.name) : STATS_NA,
      detail: metrics.topArtist ? rankedDetail(metrics.topArtist) : "",
    },
    {
      label: "Top genre",
      value: metrics.topGenre ? escapeHtml(metrics.topGenre.name) : STATS_NA,
      detail: metrics.topGenre ? rankedDetail(metrics.topGenre) : "",
    },
    {
      label: "Top release year",
      value: metrics.topYear ? String(metrics.topYear.year) : STATS_NA,
      detail: metrics.topYear ? rankedDetail(metrics.topYear) : "",
    },
  ];
}

function renderHighlightGrid(cards: HighlightCard[]): string {
  return `
    <div class="stats-summary-grid">
      ${cards
        .map(
          (h) => `
        <article class="stats-stat-card">
          <p class="stats-stat-label">${h.label}</p>
          <p class="stats-stat-value">${h.value}</p>
          <p class="stats-stat-detail">${h.detail}</p>
        </article>`,
        )
        .join("")}
    </div>
  `;
}

export interface StatsPage {
  refresh(): Promise<void>;
}

export function initStatsPage(
  onPlay: (track: Track, queue?: Track[]) => void,
  onToggleFavorite: (track: Track) => void,
  onAddToPlaylist: (track: Track) => void,
  getPlayingTrackId: () => string | null,
): StatsPage {
  const container = document.getElementById("stats-page-content");
  if (!container) {
    throw new Error("Missing stats-page-content");
  }
  const root = container;

  const currentYear = new Date().getFullYear();
  let selectedYear = currentYear;

  async function renderTopTracks(
    mountId: string,
    ranked: RankedTrack[],
    emptyMessage: string,
  ): Promise<void> {
    const listEl = document.getElementById(mountId);
    if (!listEl) return;
    const tracks = ranked.map((row) => row.track);
    renderTrackList(listEl, tracks, {
      onPlay,
      onToggleFavorite,
      onAddToPlaylist,
      playingTrackId: getPlayingTrackId(),
      showInlineLike: true,
      emptyMessage,
    });
    const items = listEl.querySelectorAll(".track-list-item");
    ranked.forEach((row, index) => {
      const item = items[index];
      if (!item) return;
      const meta = document.createElement("span");
      meta.className = "stats-track-meta";
      meta.textContent = `${row.playCount}× · ${formatListenDuration(row.totalSecs)}`;
      item.querySelector(".track-item-details")?.appendChild(meta);
    });
  }

  function wireYearTabs(years: number[]): void {
    const tabsEl = document.getElementById("stats-year-tabs");
    if (!tabsEl) return;

    tabsEl.replaceChildren();
    const showTabs = years.length > 1;
    tabsEl.hidden = !showTabs;
    if (!showTabs) return;

    for (const year of years) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "search-tab";
      tab.dataset.year = String(year);
      tab.textContent = String(year);
      if (year === selectedYear) {
        tab.classList.add("active");
      }
      tab.addEventListener("click", () => {
        if (selectedYear === year) return;
        selectedYear = year;
        tabsEl.querySelectorAll<HTMLButtonElement>(".search-tab").forEach((t) => {
          t.classList.toggle("active", Number(t.dataset.year) === year);
        });
        void renderYearCards(year);
      });
      tabsEl.appendChild(tab);
    }
  }

  async function renderYearCards(year: number): Promise<void> {
    const mount = document.getElementById("stats-year-cards");
    if (!mount) return;
    mount.innerHTML = placeholder(`Loading ${year}…`);
    try {
      const wrap = await api.stats.getYearlyWrap(year);
      mount.innerHTML = renderHighlightGrid(highlightCardsFromWrap(wrap));
    } catch (error) {
      mount.innerHTML = placeholder(
        error instanceof Error ? error.message : `Failed to load ${year} stats`,
      );
    }
  }

  async function refresh() {
    root.innerHTML = placeholder("Loading your stats…");
    try {
      const [summary, yearsFromDb, currentYearWrap] = await Promise.all([
        api.stats.getStats(),
        api.stats.getStatsYears(),
        api.stats.getYearlyWrap(currentYear),
      ]);

      if (summary.uniqueTracks === 0) {
        root.innerHTML = placeholder(
          "Play some music to build your stats. Your listening time, top tracks, and chart playlists will show up here.",
        );
        return;
      }

      const years = buildYearTabList(yearsFromDb);
      if (!years.includes(selectedYear)) {
        selectedYear = years[0] ?? currentYear;
      }

      root.innerHTML = `
        <section class="stats-section">
          ${renderHighlightGrid(highlightCardsFromSummary(summary))}
        </section>
        <section class="stats-section">
          <h3 class="stats-section-title">Most played</h3>
          <div class="stats-most-played-panes">
            <div class="stats-most-played-pane">
              <h4 class="stats-pane-title">All time</h4>
              <div class="track-list" id="stats-top-tracks-all"></div>
            </div>
            <div class="stats-most-played-pane">
              <h4 class="stats-pane-title">${currentYear}</h4>
              <div class="track-list" id="stats-top-tracks-year"></div>
            </div>
          </div>
        </section>
        <section class="stats-section stats-year-section">
          <div class="search-tabs" id="stats-year-tabs" hidden></div>
          <div id="stats-year-cards"></div>
        </section>
      `;

      wireYearTabs(years);

      await Promise.all([
        renderTopTracks("stats-top-tracks-all", summary.topTracks, "No replay data yet."),
        renderTopTracks(
          "stats-top-tracks-year",
          currentYearWrap.topTracks,
          `No plays recorded in ${currentYear} yet.`,
        ),
        renderYearCards(selectedYear),
      ]);
    } catch (error) {
      root.innerHTML = placeholder(
        error instanceof Error ? error.message : "Failed to load stats",
      );
    }
  }

  return { refresh };
}

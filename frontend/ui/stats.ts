import * as api from "../api";
import type { RankedTrack, Track } from "../types";
import { formatListenDuration } from "../api/stats";
import { renderTrackList } from "./track-list";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function placeholder(message: string): string {
  return `<p style="padding: 1rem 0; opacity: 0.75;">${escapeHtml(message)}</p>`;
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
  const yearSelect = document.getElementById("stats-year-select") as HTMLSelectElement | null;
  if (!container) {
    throw new Error("Missing stats-page-content");
  }
  const root = container;

  const currentYear = new Date().getFullYear();
  if (yearSelect && yearSelect.options.length === 0) {
    for (let y = currentYear; y >= currentYear - 5; y--) {
      const opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = String(y);
      yearSelect.appendChild(opt);
    }
    yearSelect.value = String(currentYear);
    yearSelect.addEventListener("change", () => {
      void refresh();
    });
  }

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

  async function refresh() {
    root.innerHTML = placeholder("Loading your stats…");
    try {
      const year = yearSelect ? Number(yearSelect.value) : currentYear;
      const [summary, wrap] = await Promise.all([
        api.stats.getStats(),
        api.stats.getYearlyWrap(year),
      ]);

      if (summary.uniqueTracks === 0) {
        root.innerHTML = placeholder(
          "Play some music to build your stats. Your listening time, top tracks, and chart playlists will show up here.",
        );
        return;
      }

      const highlights = [
        {
          label: "Listening time",
          value: formatListenDuration(summary.totalListenSecs),
          detail: `${summary.totalPlays} plays · ${summary.uniqueTracks} tracks`,
        },
        {
          label: "Full listens",
          value: String(summary.fullListens),
          detail: "Tracks played through to the end",
        },
        summary.topArtist
          ? {
              label: "Top artist",
              value: escapeHtml(summary.topArtist.name),
              detail: `${summary.topArtist.playCount} plays · ${formatListenDuration(summary.topArtist.totalSecs)}`,
            }
          : null,
        summary.topAlbum
          ? {
              label: "Top album",
              value: escapeHtml(summary.topAlbum.name),
              detail: `${summary.topAlbum.playCount} plays · ${formatListenDuration(summary.topAlbum.totalSecs)}`,
            }
          : null,
        summary.topYear
          ? {
              label: "Top release year",
              value: String(summary.topYear.year),
              detail: `${summary.topYear.playCount} plays · ${formatListenDuration(summary.topYear.totalSecs)}`,
            }
          : null,
      ].filter(Boolean) as Array<{ label: string; value: string; detail: string }>;

      root.innerHTML = `
        <div class="stats-summary-grid">
          ${highlights
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
        <section class="stats-section">
          <h3 class="stats-section-title">${year} wrap</h3>
          <div class="stats-summary-grid stats-wrap-grid">
            <article class="stats-stat-card">
              <p class="stats-stat-label">${year} listening</p>
              <p class="stats-stat-value">${formatListenDuration(wrap.totalListenSecs)}</p>
              <p class="stats-stat-detail">${wrap.totalPlays} plays · ${wrap.uniqueTracks} tracks · ${wrap.fullListens} full listens</p>
            </article>
            ${
              wrap.topArtists[0]
                ? `<article class="stats-stat-card">
              <p class="stats-stat-label">Top artist in ${year}</p>
              <p class="stats-stat-value">${escapeHtml(wrap.topArtists[0].name)}</p>
              <p class="stats-stat-detail">${wrap.topArtists[0].playCount} plays</p>
            </article>`
                : ""
            }
            ${
              wrap.topAlbums[0]
                ? `<article class="stats-stat-card">
              <p class="stats-stat-label">Top album in ${year}</p>
              <p class="stats-stat-value">${escapeHtml(wrap.topAlbums[0].name)}</p>
              <p class="stats-stat-detail">${wrap.topAlbums[0].playCount} plays</p>
            </article>`
                : ""
            }
          </div>
        </section>
        <section class="stats-section">
          <h3 class="stats-section-title">Most replayed (all time)</h3>
          <div class="track-list" id="stats-top-tracks"></div>
        </section>
        <section class="stats-section">
          <h3 class="stats-section-title">Top tracks in ${year}</h3>
          <div class="track-list" id="stats-year-tracks"></div>
        </section>
      `;

      await renderTopTracks(
        "stats-top-tracks",
        summary.topTracks,
        "No replay data yet.",
      );
      await renderTopTracks(
        "stats-year-tracks",
        wrap.topTracks,
        `No plays recorded in ${year} yet.`,
      );
    } catch (error) {
      root.innerHTML = placeholder(
        error instanceof Error ? error.message : "Failed to load stats",
      );
    }
  }

  return { refresh };
}

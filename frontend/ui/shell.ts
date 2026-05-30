import { SVG_PLAY, SVG_VOLUME, SVG_MUTE } from "./icons";

/** Hide streaming-only chrome; init player chrome like Monochrome. */
export function initMonochromeShell(): void {
  const hideIds = [
    "shuffle-btn",
    "prev-btn",
    "next-btn",
    "repeat-btn",
    "cast-btn",
    "queue-btn",
    "download-current-btn",
    "now-playing-party-btn",
    "now-playing-mix-btn",
    "toggle-lyrics-btn",
    "sleep-timer-btn",
    "sleep-timer-btn-desktop",
    "mobile-add-playlist-btn",
    "now-playing-add-playlist-btn",
    "radio-loading-indicator",
    "shuffle-liked-tracks-btn",
    "download-liked-tracks-btn",
    "library-create-folder-card",
    "nav-back",
    "nav-forward",
    "header-account-btn",
  ];

  for (const id of hideIds) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  }

  document.querySelectorAll(".sidebar-nav-bottom").forEach((el) => {
    (el as HTMLElement).style.display = "none";
  });

  const playBtn = document.querySelector<HTMLButtonElement>(".now-playing-bar .play-pause-btn");
  if (playBtn) playBtn.innerHTML = SVG_PLAY(20);

  const volumeBtn = document.getElementById("volume-btn");
  if (volumeBtn) volumeBtn.innerHTML = SVG_VOLUME(20);

  initLibraryTabs();
}

function initLibraryTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>("#page-library .search-tab");
  const panels = document.querySelectorAll<HTMLElement>("#page-library .search-tab-content");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      panels.forEach((panel) => {
        const match =
          (name === "tracks" && panel.id === "library-tab-tracks") ||
          (name === "local" && panel.id === "library-tab-local");
        panel.classList.toggle("active", match);
      });
    });
  });
}

export function setVolumeButtonMuted(muted: boolean, volume: number): void {
  const volumeBtn = document.getElementById("volume-btn");
  if (!volumeBtn) return;
  volumeBtn.innerHTML = muted || volume === 0 ? SVG_MUTE(20) : SVG_VOLUME(20);
}

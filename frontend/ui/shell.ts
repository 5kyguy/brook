import { SVG_PLAY, SVG_VOLUME, SVG_MUTE } from "./icons";

const SIDEBAR_COLLAPSED_KEY = "brook-sidebar-collapsed";

/** Hide streaming-only chrome; init player chrome like Monochrome. */
export function initMonochromeShell(): void {
  const hideIds = [
    "cast-btn",
    "download-current-btn",
    "now-playing-party-btn",
    "now-playing-mix-btn",
    "sleep-timer-btn",
    "sleep-timer-btn-desktop",
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

  initSidebarToggle();
}

function initSidebarToggle(): void {
  const toggle = document.getElementById("sidebar-toggle");
  if (!toggle) return;

  const setCollapsed = (collapsed: boolean) => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    toggle.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  };

  if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true") {
    setCollapsed(true);
  }

  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const collapsed = !document.body.classList.contains("sidebar-collapsed");
    setCollapsed(collapsed);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  });
}

export function setVolumeButtonMuted(muted: boolean, volume: number): void {
  const volumeBtn = document.getElementById("volume-btn");
  if (!volumeBtn) return;
  volumeBtn.innerHTML = muted || volume === 0 ? SVG_MUTE(20) : SVG_VOLUME(20);
}

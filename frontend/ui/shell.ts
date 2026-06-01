import { SVG_VOLUME, SVG_MUTE } from "./icons";

const SIDEBAR_COLLAPSED_KEY = "brook-sidebar-collapsed";

/** Sidebar toggle and volume button icons. */
export function initAppShell(): void {
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

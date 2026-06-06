export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function formatDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "0:00";
  const total = Math.floor(secs);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function trackLabel(track: { title: string | null; artist: string | null; id: string }): string {
  return track.title?.trim() || track.artist?.trim() || track.id;
}

export function trackArtist(track: { artist: string | null }): string {
  return track.artist?.trim() || "Unknown artist";
}

export function trackSubtitle(track: { artist: string | null; album: string | null }): string {
  const parts = [track.artist, track.album].filter(Boolean);
  return parts.join(" · ") || "Unknown artist";
}

export function showToast(message: string, durationMs = 3200): void {
  let toast = document.getElementById("brook-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "brook-toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout((showToast as { timer?: number }).timer);
  (showToast as { timer?: number }).timer = window.setTimeout(() => {
    toast?.classList.remove("visible");
  }, durationMs);
}

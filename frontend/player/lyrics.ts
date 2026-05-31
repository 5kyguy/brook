import * as api from "../api";
import type { Track } from "../types";
import { activeLineIndex, parseLrc, parsePlainLyrics, type LyricLine } from "./lrc";

export interface LyricsPanelOptions {
  onFullscreenLyricsChange?: (open: boolean) => void;
}

export interface LyricsPanel {
  setTrack(track: Track | null): Promise<void>;
  setPosition(positionSecs: number): void;
  toggle(): void;
  toggleFullscreen(): void;
  setFullscreenHostActive(active: boolean): void;
  close(): void;
  closeFullscreen(): void;
  isOpen(): boolean;
  isFullscreenOpen(): boolean;
}

export function initLyricsPanel(options: LyricsPanelOptions = {}): LyricsPanel {
  const panel = document.getElementById("side-panel");
  const content = document.getElementById("side-panel-content");
  const titleEl = document.getElementById("side-panel-title");
  const toggleBtn = document.getElementById("toggle-lyrics-btn");
  const fsContent = document.getElementById("fullscreen-lyrics-content");
  const fsLyricsBtn = document.getElementById("fs-lyrics-btn");
  const overlay = document.getElementById("fullscreen-cover-overlay");

  let lines: LyricLine[] = [];
  let synced = false;
  let hasLyrics = false;
  let fullscreenHostActive = false;
  let fullscreenLyricsOpen = false;

  const renderTarget = () => {
    if (fullscreenHostActive && fullscreenLyricsOpen) return fsContent;
    return content;
  };

  const renderLines = (positionMs = 0) => {
    const target = renderTarget();
    if (!target) return;
    if (!hasLyrics) {
      target.innerHTML = `<p class="lyrics-error">No lyrics for this track.</p>`;
      return;
    }

    const active = synced ? activeLineIndex(lines, positionMs) : -1;
    target.innerHTML = lines
      .map((line, index) => {
        let cls = "synced-line";
        if (synced) {
          if (index === active) cls += " active";
          else if (index === active + 1) cls += " upcoming";
          else if (index < active) cls += " past";
        }
        return `<div class="${cls}">${escapeHtml(line.text)}</div>`;
      })
      .join("");

    scrollActiveLineIntoView(target);
  };

  const scrollActiveLineIntoView = (container: HTMLElement) => {
    if (!synced) return;
    const activeEl = container.querySelector(".synced-line.active") as HTMLElement | null;
    if (!activeEl) return;
    const targetTop =
      activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  };

  const syncLyricsButtons = () => {
    if (hasLyrics) {
      toggleBtn?.style.removeProperty("display");
      if (fullscreenHostActive) fsLyricsBtn?.style.removeProperty("display");
    } else {
      toggleBtn?.style.setProperty("display", "none");
      fsLyricsBtn?.style.setProperty("display", "none");
    }
  };

  const setFullscreenLyricsOpen = (open: boolean) => {
    fullscreenLyricsOpen = open;
    overlay?.classList.toggle("lyrics-open", open);
    fsLyricsBtn?.classList.toggle("active", open);
    options.onFullscreenLyricsChange?.(open);
    if (open) {
      renderLines();
    } else if (fsContent) {
      fsContent.innerHTML = "";
    }
  };

  const openSidePanel = () => {
    if (!panel || !hasLyrics) return;
    panel.classList.add("active");
    panel.dataset.view = "lyrics";
    if (titleEl) titleEl.textContent = "Lyrics";
    toggleBtn?.classList.add("active");
    renderLines();
  };

  const closeSidePanel = () => {
    panel?.classList.remove("active");
    delete panel?.dataset.view;
    toggleBtn?.classList.remove("active");
  };

  toggleBtn?.addEventListener("click", () => {
    if (fullscreenHostActive) return;
    if (panel?.classList.contains("active") && panel.dataset.view === "lyrics") {
      closeSidePanel();
    } else {
      openSidePanel();
    }
  });

  fsLyricsBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!fullscreenHostActive || !hasLyrics) return;
    setFullscreenLyricsOpen(!fullscreenLyricsOpen);
  });

  return {
    async setTrack(track) {
      lines = [];
      synced = false;
      hasLyrics = false;

      if (!track) {
        syncLyricsButtons();
        closeSidePanel();
        setFullscreenLyricsOpen(false);
        return;
      }

      try {
        const result = await api.lyrics.readLyrics(track.id);
        if (result.source === "none" || !result.text?.trim()) {
          syncLyricsButtons();
          closeSidePanel();
          setFullscreenLyricsOpen(false);
          return;
        }

        hasLyrics = true;
        synced = result.source === "lrc";
        lines = synced ? parseLrc(result.text) : parsePlainLyrics(result.text);
        if (lines.length === 0) {
          hasLyrics = false;
          syncLyricsButtons();
          closeSidePanel();
          setFullscreenLyricsOpen(false);
          return;
        }

        syncLyricsButtons();
        if (panel?.classList.contains("active") && panel.dataset.view === "lyrics") {
          renderLines();
        }
        if (fullscreenLyricsOpen) {
          renderLines();
        }
      } catch {
        syncLyricsButtons();
        closeSidePanel();
        setFullscreenLyricsOpen(false);
      }
    },
    setPosition(positionSecs) {
      const lyricsVisible =
        (fullscreenHostActive && fullscreenLyricsOpen) ||
        (panel?.classList.contains("active") && panel.dataset.view === "lyrics");
      if (!synced || !lyricsVisible) return;
      renderLines(positionSecs * 1000);
    },
    toggle() {
      if (fullscreenHostActive) {
        if (!hasLyrics) return;
        setFullscreenLyricsOpen(!fullscreenLyricsOpen);
        return;
      }
      if (panel?.classList.contains("active") && panel.dataset.view === "lyrics") {
        closeSidePanel();
      } else {
        openSidePanel();
      }
    },
    toggleFullscreen() {
      if (!fullscreenHostActive || !hasLyrics) return;
      setFullscreenLyricsOpen(!fullscreenLyricsOpen);
    },
    setFullscreenHostActive(active) {
      fullscreenHostActive = active;
      syncLyricsButtons();
      if (active) {
        closeSidePanel();
      } else {
        setFullscreenLyricsOpen(false);
        return;
      }
      if (fullscreenLyricsOpen) {
        renderLines();
      }
    },
    close() {
      closeSidePanel();
    },
    closeFullscreen() {
      setFullscreenLyricsOpen(false);
    },
    isOpen() {
      return Boolean(panel?.classList.contains("active") && panel.dataset.view === "lyrics");
    },
    isFullscreenOpen() {
      return fullscreenLyricsOpen;
    },
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

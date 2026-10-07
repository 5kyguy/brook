import * as api from "../api";
import type { Track } from "../types";
import { activeLineIndex, parseLrc, parsePlainLyrics, type LyricLine } from "./lrc";

export interface LyricsPanelOptions {
  onFullscreenLyricsChange?: (open: boolean) => void;
  /** Seek playback to a position (seconds) when a synced line is clicked. */
  onSeek?: (positionSecs: number) => void;
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
  let positionSecs = 0;
  let requestId = 0;

  const renderTarget = () => {
    if (fullscreenHostActive && fullscreenLyricsOpen) return fsContent;
    return content;
  };

  const lineSignature = () =>
    `${hasLyrics ? 1 : 0}:${synced ? 1 : 0}:${lines.length}:${lines[0]?.timeMs ?? 0}:${lines.at(-1)?.timeMs ?? 0}`;

  const scrollActiveLineIntoView = (container: HTMLElement) => {
    if (!synced) return;
    const activeEl = container.querySelector(".synced-line.active") as HTMLElement | null;
    if (!activeEl) return;
    const targetTop =
      activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
  };

  const paintActiveLine = (target: HTMLElement, positionMs: number) => {
    if (!synced) return;
    const active = activeLineIndex(lines, positionMs);
    if (target.dataset.activeIndex === String(active)) return;
    target.dataset.activeIndex = String(active);
    const rows = target.querySelectorAll<HTMLElement>(".synced-line");
    rows.forEach((row, index) => {
      row.classList.toggle("active", index === active);
      row.classList.toggle("upcoming", index === active + 1);
      row.classList.toggle("past", index < active);
    });
    scrollActiveLineIntoView(target);
  };

  const renderLines = (positionMs = positionSecs * 1000) => {
    const target = renderTarget();
    if (!target) return;
    if (!hasLyrics) {
      target.dataset.lyricsSig = "";
      target.dataset.activeIndex = "";
      target.innerHTML = `<p class="lyrics-error">No lyrics for this track.</p>`;
      return;
    }

    const signature = lineSignature();
    if (target.dataset.lyricsSig !== signature) {
      const active = synced ? activeLineIndex(lines, positionMs) : -1;
      target.dataset.lyricsSig = signature;
      target.dataset.activeIndex = String(active);
      target.innerHTML = lines
        .map((line, index) => {
          let cls = "synced-line";
          if (synced) {
            if (index === active) cls += " active";
            else if (index === active + 1) cls += " upcoming";
            else if (index < active) cls += " past";
            cls += " clickable";
          }
          return `<div class="${cls}"${synced ? ` data-time-ms="${line.timeMs}"` : ""}>${escapeHtml(line.text)}</div>`;
        })
        .join("");
      scrollActiveLineIntoView(target);
      return;
    }

    paintActiveLine(target, positionMs);
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
      renderLines(positionSecs * 1000);
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
    renderLines(positionSecs * 1000);
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

  // Click a synced line to seek. One delegated listener per render target,
  // so the frequent re-renders never re-attach per-line listeners.
  const onLineClick = (event: MouseEvent) => {
    if (!synced || !hasLyrics) return;
    const target = event.target as HTMLElement | null;
    const line = target?.closest<HTMLElement>(".synced-line[data-time-ms]");
    if (!line) return;
    const timeMs = Number(line.dataset.timeMs);
    if (!Number.isFinite(timeMs)) return;
    options.onSeek?.(timeMs / 1000);
  };
  content?.addEventListener("click", onLineClick);
  fsContent?.addEventListener("click", onLineClick);

  return {
    async setTrack(track) {
      const token = ++requestId;
      lines = [];
      synced = false;
      hasLyrics = false;
      const showing = renderTarget();
      if (showing) {
        showing.dataset.lyricsSig = "";
        showing.dataset.activeIndex = "";
        showing.replaceChildren();
      }

      if (!track) {
        syncLyricsButtons();
        closeSidePanel();
        setFullscreenLyricsOpen(false);
        return;
      }

      try {
        const result = await api.lyrics.readLyrics(track.id);
        if (token !== requestId) return;
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
          renderLines(positionSecs * 1000);
        }
        if (fullscreenLyricsOpen) {
          renderLines(positionSecs * 1000);
        }
      } catch {
        if (token !== requestId) return;
        syncLyricsButtons();
        closeSidePanel();
        setFullscreenLyricsOpen(false);
      }
    },
    setPosition(nextPositionSecs) {
      positionSecs = nextPositionSecs;
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
        renderLines(positionSecs * 1000);
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

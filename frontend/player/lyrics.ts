import * as api from "../api";
import type { Track } from "../types";
import { activeLineIndex, parseLrc, parsePlainLyrics, type LyricLine } from "./lrc";

export interface LyricsPanel {
  setTrack(track: Track | null): Promise<void>;
  setPosition(positionSecs: number): void;
  toggle(): void;
  close(): void;
  isOpen(): boolean;
}

export function initLyricsPanel(): LyricsPanel {
  const panel = document.getElementById("side-panel");
  const content = document.getElementById("side-panel-content");
  const titleEl = document.getElementById("side-panel-title");
  const toggleBtn = document.getElementById("toggle-lyrics-btn");

  let lines: LyricLine[] = [];
  let synced = false;
  let currentTrack: Track | null = null;
  let hasLyrics = false;

  const renderLines = (positionMs = 0) => {
    if (!content) return;
    if (!hasLyrics) {
      content.innerHTML = `<p class="lyrics-error">No lyrics for this track.</p>`;
      return;
    }

    const active = synced ? activeLineIndex(lines, positionMs) : -1;
    content.innerHTML = lines
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

    const activeEl = content.querySelector(".synced-line.active");
    activeEl?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const openPanel = () => {
    if (!panel || !hasLyrics) return;
    panel.classList.add("active");
    panel.dataset.view = "lyrics";
    if (titleEl) titleEl.textContent = "Lyrics";
    toggleBtn?.classList.add("active");
    renderLines();
  };

  const closePanel = () => {
    panel?.classList.remove("active");
    delete panel?.dataset.view;
    toggleBtn?.classList.remove("active");
  };

  toggleBtn?.addEventListener("click", () => {
    if (panel?.classList.contains("active") && panel.dataset.view === "lyrics") {
      closePanel();
    } else {
      openPanel();
    }
  });

  return {
    async setTrack(track) {
      currentTrack = track;
      lines = [];
      synced = false;
      hasLyrics = false;

      if (!track) {
        toggleBtn?.style.setProperty("display", "none");
        closePanel();
        return;
      }

      try {
        const result = await api.lyrics.readLyrics(track.id);
        if (result.source === "none" || !result.text?.trim()) {
          toggleBtn?.style.setProperty("display", "none");
          closePanel();
          return;
        }

        hasLyrics = true;
        toggleBtn?.style.removeProperty("display");
        synced = result.source === "lrc";
        lines = synced ? parseLrc(result.text) : parsePlainLyrics(result.text);
        if (lines.length === 0) {
          hasLyrics = false;
          toggleBtn?.style.setProperty("display", "none");
          closePanel();
          return;
        }

        if (panel?.classList.contains("active") && panel.dataset.view === "lyrics") {
          renderLines();
        }
      } catch {
        toggleBtn?.style.setProperty("display", "none");
        closePanel();
      }
    },
    setPosition(positionSecs) {
      if (!synced || !panel?.classList.contains("active")) return;
      renderLines(positionSecs * 1000);
    },
    toggle() {
      if (panel?.classList.contains("active") && panel.dataset.view === "lyrics") {
        closePanel();
      } else {
        openPanel();
      }
    },
    close() {
      closePanel();
    },
    isOpen() {
      return Boolean(panel?.classList.contains("active") && panel.dataset.view === "lyrics");
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

import type { PlaybackQueue } from "./queue";
import type { Track } from "../types";
import { formatDuration, trackArtist, trackLabel } from "../ui/dom";

export interface QueuePanelController {
  refresh(): void;
  open(): void;
  close(): void;
}

export interface QueuePanelDeps {
  queue: PlaybackQueue;
  getPlayingTrackId: () => string | null;
  onJumpTo: (track: Track) => void | Promise<void>;
  onRemove: (trackId: string) => void;
  onClear: () => void;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function initQueuePanel(deps: QueuePanelDeps): QueuePanelController {
  const overlay = document.getElementById("queue-modal-overlay");
  const listEl = document.getElementById("queue-list");
  const queueBtn = document.getElementById("queue-btn");
  const closeBtn = document.getElementById("close-queue-btn");
  const clearBtn = document.getElementById("clear-queue-btn");

  if (!overlay || !listEl) {
    throw new Error("Missing queue modal elements");
  }

  let draggedIndex: number | null = null;
  let dragArmed = false;

  const open = () => {
    overlay.classList.add("open");
    refresh();
  };

  const close = () => {
    overlay.classList.remove("open");
  };

  const wireDragReorder = () => {
    listEl.querySelectorAll<HTMLElement>(".queue-track-item").forEach((row) => {
      const handle = row.querySelector<HTMLElement>(".drag-handle");
      if (!handle) return;

      handle.addEventListener("mousedown", (event) => {
        event.stopPropagation();
        dragArmed = true;
        row.draggable = true;
      });

      row.addEventListener("dragstart", (event) => {
        if (!dragArmed) {
          event.preventDefault();
          return;
        }
        draggedIndex = Number(row.dataset.queueIndex);
        row.classList.add("dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", String(draggedIndex));
        }
      });

      row.addEventListener("dragend", () => {
        dragArmed = false;
        row.draggable = false;
        row.classList.remove("dragging");
        draggedIndex = null;
        listEl.querySelectorAll(".queue-track-item").forEach((item) => {
          item.classList.remove("drag-over");
        });
      });

      row.addEventListener("dragover", (event) => {
        if (draggedIndex === null) return;
        event.preventDefault();
        row.classList.add("drag-over");
      });

      row.addEventListener("dragleave", () => {
        row.classList.remove("drag-over");
      });

      row.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        row.classList.remove("drag-over");
        const fromIndex = draggedIndex;
        const toIndex = Number(row.dataset.queueIndex);
        if (fromIndex === null || Number.isNaN(toIndex) || fromIndex === toIndex) return;
        deps.queue.reorder(fromIndex, toIndex);
        refresh();
      });
    });
  };

  const render = () => {
    const tracks = deps.queue.getTracks();
    const playingId = deps.getPlayingTrackId();

    if (tracks.length === 0) {
      listEl.innerHTML =
        '<p class="placeholder-text">Queue is empty. Play a track or add one from the library.</p>';
      return;
    }

    listEl.innerHTML = tracks
      .map((track, index) => {
        const isPlaying = playingId === track.id;
        const title = escapeHtml(trackLabel(track));
        const artist = escapeHtml(trackArtist(track));
        const duration =
          track.durationSecs != null ? formatDuration(track.durationSecs) : "--:--";
        return `
          <div class="queue-track-item${isPlaying ? " playing" : ""}"
               data-track-id="${escapeHtml(track.id)}"
               data-queue-index="${index}">
            <span class="drag-handle" aria-hidden="true" title="Drag to reorder">
              <use svg="!lucide/grip-vertical.svg" size="16" />
            </span>
            <div class="track-item-details">
              <div class="title">${title}</div>
              <div class="artist">${artist}</div>
            </div>
            <span class="duration">${duration}</span>
            <button type="button" class="queue-remove-btn" title="Remove from queue" data-remove-id="${escapeHtml(track.id)}">
              <use svg="!lucide/x.svg" size="20" />
            </button>
          </div>
        `;
      })
      .join("");

    listEl.querySelectorAll<HTMLElement>(".queue-track-item").forEach((row) => {
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest(".queue-remove-btn")) return;
        if ((event.target as HTMLElement).closest(".drag-handle")) return;
        if (dragArmed) return;
        const trackId = row.dataset.trackId;
        if (!trackId) return;
        const track = deps.queue.jumpTo(trackId);
        if (track) void Promise.resolve(deps.onJumpTo(track));
        close();
      });
    });

    listEl.querySelectorAll<HTMLButtonElement>(".queue-remove-btn").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const trackId = btn.dataset.removeId;
        if (!trackId) return;
        deps.onRemove(trackId);
        refresh();
      });
    });

    wireDragReorder();
  };

  const refresh = () => {
    render();
  };

  queueBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    open();
  });

  closeBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });

  clearBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    deps.onClear();
    refresh();
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  return { refresh, open, close };
}

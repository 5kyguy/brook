export interface ShortcutHandlers {
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleMute: () => void;
  onVolumeDelta: (delta: number) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleLyrics: () => void;
  onFocusSearch: () => void;
  onOpenQueue: () => void;
  onSeekRelative: (deltaSecs: number) => void;
  onCloseModals: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

function isModalOpen(): boolean {
  return Boolean(
    document.getElementById("shortcuts-modal")?.classList.contains("active") ||
      document.getElementById("queue-modal-overlay")?.classList.contains("open") ||
      document.getElementById("playlist-select-modal")?.classList.contains("active") ||
      document.getElementById("playlist-modal")?.classList.contains("active"),
  );
}

export function initKeyboardShortcuts(handlers: ShortcutHandlers): void {
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || isEditableTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "Escape") {
      if (isModalOpen()) {
        event.preventDefault();
        handlers.onCloseModals();
      }
      return;
    }

    switch (event.key) {
      case " ":
        event.preventDefault();
        handlers.onPlayPause();
        break;
      case "ArrowRight":
        if (event.shiftKey) handlers.onNext();
        else handlers.onSeekRelative(10);
        break;
      case "ArrowLeft":
        if (event.shiftKey) handlers.onPrev();
        else handlers.onSeekRelative(-10);
        break;
      case "ArrowUp":
        event.preventDefault();
        handlers.onVolumeDelta(0.05);
        break;
      case "ArrowDown":
        event.preventDefault();
        handlers.onVolumeDelta(-0.05);
        break;
      case "m":
      case "M":
        handlers.onToggleMute();
        break;
      case "s":
      case "S":
        handlers.onToggleShuffle();
        break;
      case "r":
      case "R":
        handlers.onCycleRepeat();
        break;
      case "l":
      case "L":
        handlers.onToggleLyrics();
        break;
      case "/":
        event.preventDefault();
        handlers.onFocusSearch();
        break;
      case "q":
      case "Q":
        handlers.onOpenQueue();
        break;
      default:
        break;
    }
  });

  document.getElementById("customize-shortcuts-btn")?.addEventListener("click", () => {
    document.getElementById("shortcuts-modal")?.classList.add("active");
  });

  document.querySelector(".close-shortcuts")?.addEventListener("click", () => {
    document.getElementById("shortcuts-modal")?.classList.remove("active");
  });

  document.getElementById("shortcuts-modal")?.querySelector(".modal-overlay")?.addEventListener("click", () => {
    document.getElementById("shortcuts-modal")?.classList.remove("active");
  });
}

export function closeOpenModals(): void {
  document.getElementById("shortcuts-modal")?.classList.remove("active");
  document.getElementById("queue-modal-overlay")?.classList.remove("open");
  document.getElementById("playlist-select-modal")?.classList.remove("active");
  document.getElementById("playlist-modal")?.classList.remove("active");
}

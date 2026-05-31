export interface ShortcutHandlers {
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleLyrics: () => void;
  onFocusSearch: () => void;
  onOpenQueue: () => void;
  onSeekRelative: (deltaSecs: number) => void;
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

export function initKeyboardShortcuts(handlers: ShortcutHandlers): void {
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || isEditableTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case " ":
        event.preventDefault();
        handlers.onPlayPause();
        break;
      case "ArrowRight":
        if (event.shiftKey) handlers.onNext();
        else handlers.onSeekRelative(5);
        break;
      case "ArrowLeft":
        if (event.shiftKey) handlers.onPrev();
        else handlers.onSeekRelative(-5);
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

  document
    .querySelectorAll("#shortcuts-modal .modal-overlay, #shortcuts-modal .modal-close")
    .forEach((el) => {
      el.addEventListener("click", () => {
        document.getElementById("shortcuts-modal")?.classList.remove("active");
      });
    });
}

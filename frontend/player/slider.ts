/** Pointer drag + click for horizontal sliders (seek, volume). */
export function bindDragSlider(
  bar: HTMLElement,
  {
    getMax,
    onSeek,
    onPreview,
    canInteract,
    seekOnMove = false,
    onDragStart,
    onDragEnd,
  }: {
    getMax: () => number;
    onSeek: (value: number) => void;
    onPreview?: (value: number) => void;
    canInteract?: () => boolean;
    seekOnMove?: boolean;
    onDragStart?: () => void;
    onDragEnd?: () => void;
  },
): void {
  let dragging = false;

  const valueFromEvent = (event: PointerEvent) => {
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    return ratio * getMax();
  };

  const apply = (value: number, commit: boolean) => {
    onPreview?.(value);
    if (commit) onSeek(value);
  };

  const finish = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    bar.releasePointerCapture(event.pointerId);
    apply(valueFromEvent(event), true);
    onDragEnd?.();
  };

  bar.addEventListener("pointerdown", (event) => {
    if (canInteract?.() === false) return;
    dragging = true;
    onDragStart?.();
    bar.setPointerCapture(event.pointerId);
    apply(valueFromEvent(event), true);
  });

  bar.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    apply(valueFromEvent(event), seekOnMove);
  });

  bar.addEventListener("pointerup", finish);
  bar.addEventListener("pointercancel", finish);
}

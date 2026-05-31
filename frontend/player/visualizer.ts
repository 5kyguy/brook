import * as api from "../api";
import type { Track } from "../types";
import { trackLabel, trackSubtitle } from "../ui/dom";

const SMOOTHING = 0.38;
const IDLE_MS = 3200;
const CHROME_REVEAL_Y = 96;

export interface VisualizerController {
  setTrack(track: Track | null): void;
  close(): void;
}

export function initVisualizer(): VisualizerController {
  const overlay = document.getElementById("fullscreen-cover-overlay");
  if (!overlay) {
    throw new Error("fullscreen-cover-overlay missing from index.html");
  }

  const canvas = document.getElementById("visualizer-canvas") as HTMLCanvasElement | null;
  const coverImage = document.getElementById("fullscreen-cover-image") as HTMLImageElement | null;
  const titleEl = document.getElementById("fullscreen-track-title");
  const artistEl = document.getElementById("fullscreen-track-artist");
  const visualizerBtn = document.getElementById("fs-visualizer-btn");
  const closeBtn = document.getElementById("close-fullscreen-cover-btn");
  const toggleUiBtn = document.getElementById("toggle-ui-btn");
  const barCover = document.querySelector<HTMLImageElement>(".now-playing-bar .cover");

  let currentTrack: Track | null = null;
  let visualizerMode = false;
  let targetBins: number[] = [];
  let displayBins: number[] = [];
  let animationFrame = 0;
  let idleTimer = 0;

  const isOpen = () => overlay.style.display !== "none";

  const resizeCanvas = () => {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const drawFrame = () => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    if (displayBins.length === 0) return;

    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--highlight-rgb")
      .trim();
    const rgb = accent || "255, 255, 255";
    const binCount = displayBins.length;
    const gap = 2;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxWidth = width * 0.9;
    const totalBars = binCount * 2;
    const barWidth = Math.max(2, (maxWidth - gap * (totalBars - 1)) / totalBars);
    const slotWidth = barWidth + gap;
    const radius = Math.min(barWidth / 2, 3);

    const drawBar = (x: number, value: number) => {
      const barHeight = value * height * 0.36;
      if (barHeight <= 0) return;

      ctx.fillStyle = `rgba(${rgb}, ${0.12 + value * 0.28})`;
      roundRect(ctx, x, centerY - barHeight, barWidth, barHeight * 2, radius);
      ctx.fill();

      ctx.fillStyle = `rgba(${rgb}, ${0.28 + value * 0.55})`;
      roundRect(
        ctx,
        x,
        centerY - barHeight * 0.72,
        barWidth,
        barHeight * 1.44,
        radius,
      );
      ctx.fill();
    };

    // Mirror on both axes: bass at center, treble at edges, bars grow up and down.
    for (let i = 0; i < binCount; i += 1) {
      const value = displayBins[i] ?? 0;
      const leftX = centerX - gap / 2 - barWidth - i * slotWidth;
      const rightX = centerX + gap / 2 + i * slotWidth;
      drawBar(leftX, value);
      drawBar(rightX, value);
    }
  };

  const stepAnimation = () => {
    if (!isOpen() || !visualizerMode) {
      animationFrame = 0;
      return;
    }

    if (targetBins.length > 0) {
      if (displayBins.length !== targetBins.length) {
        displayBins = targetBins.slice();
      } else {
        for (let i = 0; i < targetBins.length; i += 1) {
          displayBins[i] =
            displayBins[i] * SMOOTHING + (targetBins[i] ?? 0) * (1 - SMOOTHING);
        }
      }
    }

    drawFrame();
    animationFrame = window.requestAnimationFrame(stepAnimation);
  };

  const startAnimation = () => {
    if (animationFrame !== 0) return;
    animationFrame = window.requestAnimationFrame(stepAnimation);
  };

  const stopAnimation = () => {
    if (animationFrame !== 0) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  };

  const syncTrackUi = (track: Track | null) => {
    if (titleEl) titleEl.textContent = track ? trackLabel(track) : "";
    if (artistEl) artistEl.textContent = track ? trackSubtitle(track) : "";
    if (coverImage) {
      coverImage.src = barCover?.src ?? "./assets/appicon.png";
    }
  };

  const setUiHidden = (hidden: boolean) => {
    overlay.classList.toggle("ui-hidden", hidden);
    toggleUiBtn?.classList.toggle("active", hidden);
    if (!hidden) {
      toggleUiBtn?.classList.remove("visible");
      resetIdleTimer();
    }
  };

  const setVisualizerMode = (active: boolean) => {
    visualizerMode = active;
    overlay.classList.toggle("visualizer-active", active);
    visualizerBtn?.classList.toggle("active", active);
    if (toggleUiBtn) toggleUiBtn.style.display = active ? "" : "none";
    void api.playback.setVisualizerActive(active);

    if (active) {
      setUiHidden(true);
      startAnimation();
    } else {
      setUiHidden(false);
      targetBins = [];
      displayBins = [];
      stopAnimation();
      drawFrame();
    }
    resizeCanvas();
  };

  const resetIdleTimer = () => {
    overlay.classList.remove("controls-idle");
    window.clearTimeout(idleTimer);
    if (!isOpen() || overlay.classList.contains("ui-hidden")) return;
    idleTimer = window.setTimeout(() => {
      if (isOpen() && !overlay.classList.contains("ui-hidden")) {
        overlay.classList.add("controls-idle");
      }
    }, IDLE_MS);
  };

  const revealChrome = (clientY: number) => {
    if (!overlay.classList.contains("ui-hidden")) return;
    const nearTop = clientY <= CHROME_REVEAL_Y;
    toggleUiBtn?.classList.toggle("visible", nearTop);
  };

  const open = () => {
    if (!currentTrack) return;
    syncTrackUi(currentTrack);
    overlay.style.display = "flex";
    overlay.classList.remove("controls-idle");
    resizeCanvas();
    resetIdleTimer();

    setVisualizerMode(true);
  };

  const close = () => {
    overlay.style.display = "none";
    setVisualizerMode(false);
    toggleUiBtn?.classList.remove("visible");
    window.clearTimeout(idleTimer);
  };

  barCover?.addEventListener("click", () => open());
  closeBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay && !overlay.classList.contains("ui-hidden")) {
      close();
    }
  });

  visualizerBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (visualizerMode) {
      setVisualizerMode(false);
    } else {
      setVisualizerMode(true);
    }
    resetIdleTimer();
  });

  toggleUiBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!visualizerMode) return;
    const hidden = overlay.classList.contains("ui-hidden");
    setUiHidden(!hidden);
    if (!hidden) {
      resetIdleTimer();
    }
  });

  overlay.addEventListener("mousemove", (event) => {
    revealChrome(event.clientY);
    resetIdleTimer();
  });

  overlay.addEventListener("mouseleave", () => {
    toggleUiBtn?.classList.remove("visible");
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      close();
    }
  });

  window.addEventListener("resize", () => {
    if (!isOpen()) return;
    resizeCanvas();
  });

  void api.events.onPlaybackSpectrum((payload) => {
    if (!isOpen() || !visualizerMode) return;
    targetBins = payload.bins;
    startAnimation();
  });

  return {
    setTrack(track) {
      currentTrack = track;
      if (isOpen()) syncTrackUi(track);
    },
    close,
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

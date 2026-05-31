import { loadVisualSettings } from "../settings/visual";
import { applyCdAlbumCoverEffect } from "../settings/visual-effects";
import * as api from "../api";
import type { PlaybackState } from "../types";
import type { Track } from "../types";
import { formatDuration, trackLabel, trackSubtitle } from "../ui/dom";
import type { RepeatMode } from "./queue";
import { bindDragSlider } from "./slider";

const SMOOTHING = 0.38;
const IDLE_MS = 3200;
const CHROME_REVEAL_Y = 96;

export interface FullscreenHandlers {
  onPrev?: () => void | Promise<void>;
  onNext?: () => void | Promise<void>;
  onPlayPause?: () => void | Promise<void>;
  onToggleShuffle?: () => boolean | Promise<boolean>;
  onCycleRepeat?: () => RepeatMode | Promise<RepeatMode>;
  getNextLabel?: () => string | null;
}

export interface VisualizerController {
  setTrack(track: Track | null): void;
  setProgress(positionSecs: number, durationSecs: number): void;
  syncPlaybackState(status: PlaybackState["status"]): void;
  syncQueueControls(shuffle: boolean, repeat: RepeatMode): void;
  close(): void;
}

export function initVisualizer(handlers: FullscreenHandlers = {}): VisualizerController {
  const overlay = document.getElementById("fullscreen-cover-overlay");
  if (!overlay) {
    throw new Error("fullscreen-cover-overlay missing from index.html");
  }

  const canvas = document.getElementById("visualizer-canvas") as HTMLCanvasElement | null;
  const coverImage = document.getElementById("fullscreen-cover-image") as HTMLImageElement | null;
  const titleEl = document.getElementById("fullscreen-track-title");
  const artistEl = document.getElementById("fullscreen-track-artist");
  const visualizerBtn = document.getElementById("fs-visualizer-btn");
  const albumCoverBtn = document.getElementById("fs-album-cover-btn");
  const closeBtn = document.getElementById("close-fullscreen-cover-btn");
  const toggleUiBtn = document.getElementById("toggle-ui-btn");
  const barCover = document.querySelector<HTMLImageElement>(".now-playing-bar .cover");

  const fsPlayBtn = document.getElementById("fs-play-pause-btn");
  const fsShuffleBtn = document.getElementById("fs-shuffle-btn");
  const fsPrevBtn = document.getElementById("fs-prev-btn");
  const fsNextBtn = document.getElementById("fs-next-btn");
  const fsRepeatBtn = document.getElementById("fs-repeat-btn");
  const fsCurrentTime = document.getElementById("fs-current-time");
  const fsTotalTime = document.getElementById("fs-total-time");
  const fsProgressBar = document.getElementById("fs-progress-bar");
  const fsProgressFill = document.getElementById("fs-progress-fill");
  const upNextBlock = document.getElementById("fullscreen-next-track");
  const upNextValue = document.getElementById("fullscreen-next-track-value");

  let currentTrack: Track | null = null;
  let visualizerMode = false;
  let albumCoverMode = false;
  let targetBins: number[] = [];
  let displayBins: number[] = [];
  let animationFrame = 0;
  let idleTimer = 0;
  let playbackStatus: PlaybackState["status"] = "stopped";
  let durationSecs = 0;
  let positionSecs = 0;
  let fsScrubbing = false;

  const isOpen = () => overlay.style.display !== "none";

  const syncUpNext = () => {
    const label = handlers.getNextLabel?.() ?? null;
    if (upNextBlock && upNextValue) {
      if (label) {
        upNextBlock.style.display = "";
        upNextValue.textContent = label;
      } else {
        upNextBlock.style.display = "none";
        upNextValue.textContent = "";
      }
    }
  };

  const updateFsPlayButton = () => {
    if (!fsPlayBtn) return;
    const playing = playbackStatus === "playing";
    fsPlayBtn.innerHTML = playing
      ? `<use svg="./images/pause.svg" size="28" />`
      : `<use svg="./images/play.svg" size="28" />`;
    fsPlayBtn.title = playing ? "Pause" : "Play";
  };

  const setFsProgressUi = (position: number, duration: number) => {
    if (fsCurrentTime) fsCurrentTime.textContent = formatDuration(position);
    if (fsTotalTime) fsTotalTime.textContent = formatDuration(duration);
    if (fsProgressFill && duration > 0) {
      fsProgressFill.style.width = `${(position / duration) * 100}%`;
    } else if (fsProgressFill) {
      fsProgressFill.style.width = "0%";
    }
  };

  const syncFsQueueControls = (shuffle: boolean, repeat: RepeatMode) => {
    fsShuffleBtn?.classList.toggle("active", shuffle);
    if (fsRepeatBtn) {
      fsRepeatBtn.classList.toggle("active", repeat !== "off");
      fsRepeatBtn.classList.toggle("repeat-one", repeat === "one");
    }
  };

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
    syncUpNext();
  };

  const setUiHidden = (hidden: boolean) => {
    overlay.classList.toggle("ui-hidden", hidden);
    toggleUiBtn?.classList.toggle("active", hidden);
    if (!hidden) {
      toggleUiBtn?.classList.remove("visible");
      resetIdleTimer();
    }
  };

  const syncPresentation = () => {
    overlay.classList.toggle("visualizer-active", visualizerMode);
    overlay.classList.toggle("album-cover-active", albumCoverMode);
    visualizerBtn?.classList.toggle("active", visualizerMode);
    albumCoverBtn?.classList.toggle("active", albumCoverMode);
    applyCdAlbumCoverEffect(albumCoverMode);

    if (toggleUiBtn) {
      toggleUiBtn.style.display = visualizerMode && !albumCoverMode ? "" : "none";
    }

    void api.playback.setVisualizerActive(visualizerMode);

    if (visualizerMode) {
      setUiHidden(!albumCoverMode);
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

  const setVisualizerMode = (active: boolean) => {
    visualizerMode = active;
    syncPresentation();
  };

  const setAlbumCoverMode = (active: boolean) => {
    albumCoverMode = active;
    syncPresentation();
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
    albumCoverMode = loadVisualSettings().cdAlbumCover;
    overlay.style.display = "flex";
    overlay.classList.remove("controls-idle");
    resizeCanvas();
    resetIdleTimer();
    updateFsPlayButton();
    setFsProgressUi(positionSecs, durationSecs);

    visualizerMode = false;
    syncPresentation();
  };

  const close = () => {
    overlay.style.display = "none";
    visualizerMode = false;
    albumCoverMode = false;
    syncPresentation();
    applyCdAlbumCoverEffect(loadVisualSettings().cdAlbumCover);
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
    setVisualizerMode(!visualizerMode);
    resetIdleTimer();
  });

  albumCoverBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    setAlbumCoverMode(!albumCoverMode);
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

  fsPlayBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    void handlers.onPlayPause?.();
  });

  fsPrevBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    void handlers.onPrev?.();
  });

  fsNextBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    void handlers.onNext?.();
  });

  fsShuffleBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    void Promise.resolve(handlers.onToggleShuffle?.()).then((shuffle) => {
      if (typeof shuffle === "boolean") fsShuffleBtn?.classList.toggle("active", shuffle);
    });
  });

  fsRepeatBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    void Promise.resolve(handlers.onCycleRepeat?.()).then((repeat) => {
      if (repeat) syncFsQueueControls(fsShuffleBtn?.classList.contains("active") ?? false, repeat);
    });
  });

  if (fsProgressBar) {
    bindDragSlider(fsProgressBar, {
      getMax: () => durationSecs,
      canInteract: () => durationSecs > 0,
      onDragStart: () => {
        fsScrubbing = true;
      },
      onDragEnd: () => {
        fsScrubbing = false;
      },
      onPreview: (value) => {
        setFsProgressUi(value, durationSecs);
      },
      onSeek: (value) => {
        void api.playback.seek(value);
      },
    });
  }

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
    setProgress(position, duration) {
      durationSecs = duration;
      if (!fsScrubbing) positionSecs = position;
      if (!fsScrubbing && isOpen()) setFsProgressUi(position, duration);
    },
    syncPlaybackState(status) {
      playbackStatus = status;
      updateFsPlayButton();
    },
    syncQueueControls: syncFsQueueControls,
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

import * as api from "../api";
import type { PlaybackState } from "../types";
import type { Track } from "../types";
import { applyTrackCovers, COVER_PLACEHOLDER } from "../ui/cover-art";
import { formatDuration, trackArtist, trackLabel } from "../ui/dom";
import { SVG_HEART, SVG_HEART_FILLED } from "../ui/icons";
import type { RepeatMode } from "./queue";
import { bindDragSlider } from "./slider";

const SMOOTHING = 0.38;
type VisualizerLevel = 0 | 1 | 2 | 3;

const VISUALIZER_TITLES: Record<VisualizerLevel, string> = {
  0: "Visualizer off",
  1: "Visualizer — heavy blur",
  2: "Visualizer — light blur",
  3: "Visualizer — sharp",
};

export interface FullscreenHandlers {
  onPrev?: () => void | Promise<void>;
  onNext?: () => void | Promise<void>;
  onPlayPause?: () => void | Promise<void>;
  onToggleShuffle?: () => boolean | Promise<boolean>;
  onCycleRepeat?: () => RepeatMode | Promise<RepeatMode>;
  onToggleFavorite?: () => void | Promise<void>;
  onAddToPlaylist?: () => void;
  onOpenQueue?: () => void;
  getNextTrack?: () => Track | null;
  onFullscreenOpen?: () => void;
  onFullscreenClose?: () => void;
}

export interface VisualizerController {
  setTrack(track: Track | null): void;
  setProgress(positionSecs: number, durationSecs: number): void;
  syncPlaybackState(status: PlaybackState["status"]): void;
  syncQueueControls(shuffle: boolean, repeat: RepeatMode): void;
  clampVisualizerForLyrics(open: boolean): void;
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
  const closeBtn = document.getElementById("close-fullscreen-cover-btn");
  const barCover = document.querySelector<HTMLImageElement>(".now-playing-bar .cover");

  const fsPlayBtn = document.getElementById("fs-play-pause-btn");
  const fsShuffleBtn = document.getElementById("fs-shuffle-btn");
  const fsPrevBtn = document.getElementById("fs-prev-btn");
  const fsNextBtn = document.getElementById("fs-next-btn");
  const fsRepeatBtn = document.getElementById("fs-repeat-btn");
  const fsLikeBtn = document.getElementById("fs-like-btn");
  const fsAddPlaylistBtn = document.getElementById("fs-add-playlist-btn");
  const fsQueueBtn = document.getElementById("fs-queue-btn");
  const fsCurrentTime = document.getElementById("fs-current-time");
  const fsTotalTime = document.getElementById("fs-total-time");
  const fsProgressBar = document.getElementById("fs-progress-bar");
  const fsProgressFill = document.getElementById("fs-progress-fill");
  const upNextBtn = document.getElementById("fullscreen-up-next");
  const upNextCover = upNextBtn?.querySelector<HTMLImageElement>(".fs-up-next-cover") ?? null;
  const upNextTitle = upNextBtn?.querySelector<HTMLElement>(".fs-up-next-title") ?? null;
  const upNextArtist = upNextBtn?.querySelector<HTMLElement>(".fs-up-next-artist") ?? null;

  let currentTrack: Track | null = null;
  let visualizerLevel: VisualizerLevel = 0;
  let lyricsLimitVisualizer = false;
  let targetBins: number[] = [];
  let displayBins: number[] = [];
  let animationFrame = 0;
  let playbackStatus: PlaybackState["status"] = "stopped";
  let durationSecs = 0;
  let positionSecs = 0;
  let fsScrubbing = false;

  const isOpen = () => overlay.style.display !== "none";

  const syncLikeButton = (track: Track | null) => {
    if (!fsLikeBtn) return;
    if (!track) {
      fsLikeBtn.classList.remove("active");
      fsLikeBtn.innerHTML = SVG_HEART(20);
      return;
    }
    fsLikeBtn.classList.toggle("active", track.isFavorite);
    fsLikeBtn.innerHTML = track.isFavorite ? SVG_HEART_FILLED(20) : SVG_HEART(20);
    fsLikeBtn.title = track.isFavorite ? "Remove from Favorites" : "Save to Favorites";
  };

  const syncUpNext = (next: Track | null) => {
    if (!upNextBtn) return;
    if (!next) {
      upNextBtn.hidden = true;
      return;
    }
    upNextBtn.hidden = false;
    if (upNextTitle) upNextTitle.textContent = trackLabel(next);
    if (upNextArtist) upNextArtist.textContent = trackArtist(next);
    if (upNextCover) {
      upNextCover.src = COVER_PLACEHOLDER;
      upNextCover.dataset.trackId = next.id;
      upNextCover.alt = trackLabel(next);
    }
    applyTrackCovers(upNextBtn);
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
    if (!isOpen() || visualizerLevel === 0) {
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
    if (artistEl) artistEl.textContent = track ? trackArtist(track) : "";
    if (coverImage) {
      coverImage.src = barCover?.src ?? "./assets/appicon.png";
    }
    syncLikeButton(track);
    syncUpNext(handlers.getNextTrack?.() ?? null);
  };

  const syncPresentation = () => {
    overlay.dataset.viz = String(visualizerLevel);
    const active = visualizerLevel > 0;
    overlay.classList.toggle("visualizer-active", active);
    visualizerBtn?.classList.toggle("active", active);

    const title = VISUALIZER_TITLES[visualizerLevel];
    if (visualizerBtn) {
      visualizerBtn.title = title;
      visualizerBtn.setAttribute("aria-label", title);
    }

    void api.playback.setVisualizerActive(active);

    if (active) {
      startAnimation();
    } else {
      targetBins = [];
      displayBins = [];
      stopAnimation();
      drawFrame();
    }
    resizeCanvas();
  };

  const maxVisualizerLevel = () => (lyricsLimitVisualizer ? 1 : 3);

  const cycleVisualizer = () => {
    const max = maxVisualizerLevel();
    visualizerLevel = (visualizerLevel >= max ? 0 : visualizerLevel + 1) as VisualizerLevel;
    syncPresentation();
  };

  const open = () => {
    if (!currentTrack) return;
    syncTrackUi(currentTrack);
    overlay.style.display = "flex";
    document.body.classList.add("fullscreen-active");
    handlers.onFullscreenOpen?.();
    visualizerLevel = 0;
    syncPresentation();
    resizeCanvas();
    updateFsPlayButton();
    setFsProgressUi(positionSecs, durationSecs);
  };

  const close = () => {
    overlay.style.display = "none";
    document.body.classList.remove("fullscreen-active");
    overlay.classList.remove("lyrics-open");
    handlers.onFullscreenClose?.();
    visualizerLevel = 0;
    syncPresentation();
  };

  barCover?.addEventListener("click", () => open());
  closeBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  visualizerBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    cycleVisualizer();
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

  fsLikeBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    void handlers.onToggleFavorite?.();
  });

  fsAddPlaylistBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    handlers.onAddToPlaylist?.();
  });

  fsQueueBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    handlers.onOpenQueue?.();
  });

  upNextBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    void handlers.onNext?.();
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
    if (!isOpen() || visualizerLevel === 0) return;
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
    clampVisualizerForLyrics(open) {
      lyricsLimitVisualizer = open;
      if (open && visualizerLevel > 1) {
        visualizerLevel = 1;
        syncPresentation();
      }
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

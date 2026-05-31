import * as api from "../api";
import { loadVisualSettings } from "../settings/visual";

export interface WaveformController {
  loadTrack(trackId: string | null): void;
  setProgress(positionSecs: number, durationSecs: number): void;
  clear(): void;
}

export function initWaveform(): WaveformController {
  const progressBar = document.getElementById("progress-bar");
  const playerControls = document.querySelector(".player-controls");
  let canvas = document.getElementById("waveform-canvas") as HTMLCanvasElement | null;

  if (progressBar && !canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "waveform-canvas";
    canvas.setAttribute("aria-hidden", "true");
    progressBar.prepend(canvas);
  }

  let peaks: number[] = [];
  let loadingTrackId: string | null = null;

  const syncEnabledClasses = () => {
    const enabled = loadVisualSettings().waveformEnabled;
    progressBar?.classList.toggle("has-waveform", enabled);
    if (!enabled) {
      progressBar?.classList.remove("waveform-loaded");
      playerControls?.classList.remove("waveform-loaded");
      if (canvas) canvas.style.display = "none";
    }
  };

  syncEnabledClasses();
  document.getElementById("waveform-toggle")?.addEventListener("change", syncEnabledClasses);

  const draw = (positionSecs: number, durationSecs: number) => {
    if (!canvas || !progressBar || peaks.length === 0) return;
    const rect = progressBar.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas.style.display = "block";

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const mid = rect.height / 2;
    const barWidth = rect.width / peaks.length;
    ctx.fillStyle = "rgba(255,255,255,0.25)";

    peaks.forEach((peak, index) => {
      const h = Math.max(2, peak * rect.height * 0.85);
      const x = index * barWidth;
      ctx.fillRect(x, mid - h / 2, Math.max(1, barWidth - 0.5), h);
    });

    if (durationSecs > 0) {
      const progressX = (positionSecs / durationSecs) * rect.width;
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(0, 0, progressX, rect.height);
    }
  };

  return {
    loadTrack(trackId) {
      peaks = [];
      loadingTrackId = trackId;
      progressBar?.classList.remove("waveform-loaded");
      playerControls?.classList.remove("waveform-loaded");

      if (!trackId || !loadVisualSettings().waveformEnabled || !api.isTauri()) {
        return;
      }

      void api.library.getWaveformPeaks(trackId).then((loaded) => {
        if (loadingTrackId !== trackId) return;
        peaks = loaded;
        if (peaks.length > 0) {
          progressBar?.classList.add("waveform-loaded");
          playerControls?.classList.add("waveform-loaded");
          draw(0, 1);
        }
      });
    },
    setProgress(positionSecs, durationSecs) {
      if (!loadVisualSettings().waveformEnabled || peaks.length === 0) return;
      draw(positionSecs, durationSecs);
    },
    clear() {
      peaks = [];
      loadingTrackId = null;
      progressBar?.classList.remove("waveform-loaded");
      playerControls?.classList.remove("waveform-loaded");
      if (canvas) canvas.style.display = "none";
    },
  };
}

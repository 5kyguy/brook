import type { PlaybackState, Track } from "../types";
import { formatDuration, trackLabel, trackSubtitle } from "../ui/dom";
import * as api from "../api";

export interface PlayerBar {
  sync(state: PlaybackState): void;
  setTrack(track: Track | null): void;
  setProgress(positionSecs: number, durationSecs: number): void;
}

export function initPlayerBar(): PlayerBar {
  const titleEl = document.querySelector<HTMLElement>(".now-playing-bar .details .title");
  const artistEl = document.querySelector<HTMLElement>(".now-playing-bar .details .artist");
  const playBtn = document.getElementById("play-pause-btn");
  const currentTimeEl = document.getElementById("current-time");
  const totalTimeEl = document.getElementById("total-duration");
  const progressBar = document.getElementById("progress-bar");
  const progressFill = document.getElementById("progress-fill");
  const volumeBar = document.getElementById("volume-bar");
  const volumeFill = document.getElementById("volume-fill");

  let currentTrack: Track | null = null;
  let playbackStatus: PlaybackState["status"] = "stopped";
  let durationSecs = 0;

  const updatePlayButton = () => {
    if (!playBtn) return;
    const playing = playbackStatus === "playing";
    playBtn.textContent = playing ? "⏸" : "▶";
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  };

  playBtn?.addEventListener("click", () => {
    if (!currentTrack) return;
    void (async () => {
      if (playbackStatus === "playing") {
        await api.playback.pause();
      } else if (playbackStatus === "paused") {
        await api.playback.resume();
      } else {
        await api.playback.playTrack(currentTrack!.id);
      }
    })();
  });

  progressBar?.addEventListener("click", (event) => {
    if (!progressBar || durationSecs <= 0) return;
    const rect = progressBar.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const target = Math.max(0, Math.min(durationSecs, ratio * durationSecs));
    void api.playback.seek(target);
  });

  volumeBar?.addEventListener("click", (event) => {
    if (!volumeBar) return;
    const rect = volumeBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    void api.playback.setVolume(ratio);
    if (volumeFill) volumeFill.style.width = `${ratio * 100}%`;
  });

  return {
    sync(state) {
      playbackStatus = state.status;
      durationSecs = state.durationSecs;
      updatePlayButton();
      if (volumeFill) volumeFill.style.width = `${state.volume * 100}%`;
      this.setProgress(state.positionSecs, state.durationSecs);
    },
    setTrack(track) {
      currentTrack = track;
      if (!titleEl || !artistEl) return;
      if (!track) {
        titleEl.textContent = "Select a song";
        artistEl.textContent = "";
        return;
      }
      titleEl.textContent = trackLabel(track);
      artistEl.textContent = trackSubtitle(track);
    },
    setProgress(positionSecs, duration) {
      durationSecs = duration;
      if (currentTimeEl) currentTimeEl.textContent = formatDuration(positionSecs);
      if (totalTimeEl) totalTimeEl.textContent = formatDuration(duration);
      if (progressFill && duration > 0) {
        progressFill.style.width = `${(positionSecs / duration) * 100}%`;
      } else if (progressFill) {
        progressFill.style.width = "0%";
      }
    },
  };
}

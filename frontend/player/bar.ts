import type { PlaybackState, Track } from "../types";
import { formatDuration, trackLabel, trackSubtitle } from "../ui/dom";
import { SVG_PAUSE, SVG_PLAY } from "../ui/icons";
import { setVolumeButtonMuted } from "../ui/shell";
import * as api from "../api";

export interface PlayerBar {
  sync(state: PlaybackState): void;
  setTrack(track: Track | null): void;
  setProgress(positionSecs: number, durationSecs: number): void;
}

const PLACEHOLDER_TITLE = "Nothing playing";
const PLACEHOLDER_ARTIST = "Pick a track from your library";

export function initPlayerBar(): PlayerBar {
  const titleEl = document.querySelector<HTMLElement>(".now-playing-bar .details .title");
  const albumEl = document.querySelector<HTMLElement>(".now-playing-bar .details .album");
  const artistEl = document.querySelector<HTMLElement>(".now-playing-bar .details .artist");
  const playBtn = document.querySelector<HTMLButtonElement>(".now-playing-bar .play-pause-btn");
  const currentTimeEl = document.getElementById("current-time");
  const totalTimeEl = document.getElementById("total-duration");
  const progressBar = document.getElementById("progress-bar");
  const progressFill = document.getElementById("progress-fill");
  const volumeBar = document.getElementById("volume-bar");
  const volumeFill = document.getElementById("volume-fill");
  const coverEl = document.querySelector<HTMLImageElement>(".now-playing-bar .cover");

  let currentTrack: Track | null = null;
  let playbackStatus: PlaybackState["status"] = "stopped";
  let durationSecs = 0;
  let volume = 1;

  const updatePlayButton = () => {
    if (!playBtn) return;
    const playing = playbackStatus === "playing";
    playBtn.innerHTML = playing ? SVG_PAUSE(20) : SVG_PLAY(20);
    playBtn.title = playing ? "Pause" : "Play";
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
    if (!volumeBar || !volumeFill) return;
    const rect = volumeBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    volume = ratio;
    void api.playback.setVolume(ratio);
    const pct = ratio * 100;
    volumeFill.style.setProperty("--volume-level", `${pct}%`);
    volumeFill.style.width = `${pct}%`;
    setVolumeButtonMuted(false, ratio);
  });

  return {
    sync(state) {
      playbackStatus = state.status;
      durationSecs = state.durationSecs;
      volume = state.volume;
      updatePlayButton();
      const pct = state.volume * 100;
      if (volumeFill) {
        volumeFill.style.setProperty("--volume-level", `${pct}%`);
        volumeFill.style.width = `${pct}%`;
      }
      setVolumeButtonMuted(false, state.volume);
      this.setProgress(state.positionSecs, state.durationSecs);
    },
    setTrack(track) {
      currentTrack = track;
      if (!titleEl || !artistEl || !albumEl) return;
      if (!track) {
        titleEl.textContent = PLACEHOLDER_TITLE;
        albumEl.textContent = "";
        artistEl.textContent = PLACEHOLDER_ARTIST;
        if (coverEl) {
          coverEl.src = "./assets/appicon.png";
          coverEl.style.cursor = "default";
        }
        return;
      }
      titleEl.textContent = trackLabel(track);
      albumEl.textContent = track.album ?? "";
      artistEl.textContent = track.artist ?? trackSubtitle(track);
      if (coverEl) {
        coverEl.src = "./assets/appicon.png";
        coverEl.style.cursor = "pointer";
        coverEl.title = "Open fullscreen player";
      }
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

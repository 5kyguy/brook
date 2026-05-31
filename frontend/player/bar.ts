import type { PlaybackState, Track } from "../types";
import { formatDuration, trackLabel, trackSubtitle } from "../ui/dom";
import { setCoverImage } from "../ui/cover-art";
import { SVG_HEART, SVG_HEART_FILLED, SVG_PAUSE, SVG_PLAY } from "../ui/icons";
import { setVolumeButtonMuted } from "../ui/shell";
import * as api from "../api";
import type { RepeatMode } from "./queue";
import { bindDragSlider } from "./slider";

export interface PlayerBar {
  sync(state: PlaybackState): void;
  setTrack(track: Track | null): void;
  setProgress(positionSecs: number, durationSecs: number): void;
  syncQueueControls(shuffle: boolean, repeat: RepeatMode): void;
}

export interface PlayerBarOptions {
  onPrev?: () => void | Promise<void>;
  onNext?: () => void | Promise<void>;
  onToggleShuffle?: () => boolean | Promise<boolean>;
  onCycleRepeat?: () => RepeatMode | Promise<RepeatMode>;
  onToggleFavorite?: () => void | Promise<void>;
  onAddToPlaylist?: () => void | Promise<void>;
}

const PLACEHOLDER_TITLE = "Nothing playing";
const PLACEHOLDER_ARTIST = "Pick a track from your library";

export function initPlayerBar(options: PlayerBarOptions = {}): PlayerBar {
  const titleEl = document.querySelector<HTMLElement>(".now-playing-bar .details .title");
  const albumEl = document.querySelector<HTMLElement>(".now-playing-bar .details .album");
  const artistEl = document.querySelector<HTMLElement>(".now-playing-bar .details .artist");
  const playBtn = document.querySelector<HTMLButtonElement>(".now-playing-bar .play-pause-btn");
  const shuffleBtn = document.getElementById("shuffle-btn");
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  const repeatBtn = document.getElementById("repeat-btn");
  const likeBtn = document.getElementById("now-playing-like-btn");
  const addPlaylistBtn = document.getElementById("now-playing-add-playlist-btn");
  const mobileAddPlaylistBtn = document.getElementById("mobile-add-playlist-btn");
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
  let positionSecs = 0;
  let volume = 1;
  let scrubbing = false;

  const updatePlayButton = () => {
    if (!playBtn) return;
    const playing = playbackStatus === "playing";
    playBtn.innerHTML = playing ? SVG_PAUSE(20) : SVG_PLAY(20);
    playBtn.title = playing ? "Pause" : "Play";
  };

  const updateLikeButton = (track: Track | null) => {
    if (!likeBtn) return;
    if (!track) {
      likeBtn.classList.remove("active");
      likeBtn.innerHTML = SVG_HEART(20);
      likeBtn.title = "Save to Favorites";
      return;
    }
    likeBtn.classList.toggle("active", track.isFavorite);
    likeBtn.innerHTML = track.isFavorite ? SVG_HEART_FILLED(20) : SVG_HEART(20);
    likeBtn.title = track.isFavorite ? "Remove from Favorites" : "Save to Favorites";
  };

  const syncQueueControls = (shuffle: boolean, repeat: RepeatMode) => {
    shuffleBtn?.classList.toggle("active", shuffle);
    if (repeatBtn) {
      repeatBtn.classList.toggle("active", repeat !== "off");
      repeatBtn.classList.toggle("repeat-one", repeat === "one");
    }
  };

  const setVolumeUi = (level: number) => {
    const pct = level * 100;
    if (volumeFill) {
      volumeFill.style.setProperty("--volume-level", `${pct}%`);
      volumeFill.style.width = `${pct}%`;
    }
    setVolumeButtonMuted(false, level);
  };

  const setProgressUi = (position: number, duration: number) => {
    if (currentTimeEl) currentTimeEl.textContent = formatDuration(position);
    if (totalTimeEl) totalTimeEl.textContent = formatDuration(duration);
    if (progressFill && duration > 0) {
      progressFill.style.width = `${(position / duration) * 100}%`;
    } else if (progressFill) {
      progressFill.style.width = "0%";
    }
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

  shuffleBtn?.addEventListener("click", () => {
    void Promise.resolve(options.onToggleShuffle?.()).then((shuffle) => {
      if (typeof shuffle === "boolean") shuffleBtn.classList.toggle("active", shuffle);
    });
  });

  prevBtn?.addEventListener("click", () => {
    void options.onPrev?.();
  });

  nextBtn?.addEventListener("click", () => {
    void options.onNext?.();
  });

  repeatBtn?.addEventListener("click", () => {
    void Promise.resolve(options.onCycleRepeat?.()).then((repeat) => {
      if (repeat) {
        syncQueueControls(shuffleBtn?.classList.contains("active") ?? false, repeat);
      }
    });
  });

  likeBtn?.addEventListener("click", () => {
    if (!currentTrack) return;
    void options.onToggleFavorite?.();
  });

  const openAddToPlaylist = () => {
    if (!currentTrack) return;
    void options.onAddToPlaylist?.();
  };
  addPlaylistBtn?.addEventListener("click", openAddToPlaylist);
  mobileAddPlaylistBtn?.addEventListener("click", openAddToPlaylist);

  if (likeBtn) likeBtn.innerHTML = SVG_HEART(20);

  if (progressBar) {
    bindDragSlider(progressBar, {
      getMax: () => durationSecs,
      canInteract: () => durationSecs > 0,
      onDragStart: () => {
        scrubbing = true;
      },
      onDragEnd: () => {
        scrubbing = false;
      },
      onPreview: (value) => {
        setProgressUi(value, durationSecs);
      },
      onSeek: (value) => {
        void api.playback.seek(value);
      },
    });
  }

  if (volumeBar) {
    bindDragSlider(volumeBar, {
      getMax: () => 1,
      seekOnMove: true,
      onPreview: (value) => {
        volume = value;
        setVolumeUi(value);
      },
      onSeek: (value) => {
        volume = value;
        void api.playback.setVolume(value);
        setVolumeUi(value);
      },
    });
  }

  return {
    sync(state) {
      playbackStatus = state.status;
      durationSecs = state.durationSecs;
      volume = state.volume;
      if (!scrubbing) positionSecs = state.positionSecs;
      updatePlayButton();
      setVolumeUi(state.volume);
      this.setProgress(state.positionSecs, state.durationSecs);
    },
    setTrack(track) {
      currentTrack = track;
      updateLikeButton(track);
      if (!titleEl || !artistEl || !albumEl) return;
      if (!track) {
        titleEl.textContent = PLACEHOLDER_TITLE;
        albumEl.textContent = "";
        artistEl.textContent = PLACEHOLDER_ARTIST;
        if (coverEl) {
          setCoverImage(coverEl, null);
          coverEl.style.cursor = "default";
        }
        return;
      }
      titleEl.textContent = trackLabel(track);
      albumEl.textContent = track.album ?? "";
      artistEl.textContent = track.artist ?? trackSubtitle(track);
      if (coverEl) {
        setCoverImage(coverEl, track.id);
        coverEl.style.cursor = "pointer";
        coverEl.title = "Open fullscreen player";
      }
    },
    setProgress(position, duration) {
      durationSecs = duration;
      if (!scrubbing) positionSecs = position;
      if (!scrubbing) setProgressUi(position, duration);
    },
    syncQueueControls,
  };
}

import type { Track } from "../types";

export type RepeatMode = "off" | "all" | "one";

export interface PlaybackQueue {
  setQueue(tracks: Track[], currentId: string): void;
  getCurrent(): Track | null;
  getNext(): Track | null;
  getPrev(): Track | null;
  advance(): Track | null;
  retreat(): Track | null;
  toggleShuffle(): boolean;
  cycleRepeat(): RepeatMode;
  isShuffled(): boolean;
  getRepeatMode(): RepeatMode;
}

function shuffleKeepCurrent(tracks: Track[], currentId: string | undefined): Track[] {
  const current = currentId ? tracks.find((t) => t.id === currentId) : null;
  const rest = tracks.filter((t) => t.id !== currentId);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return current ? [current, ...rest] : rest;
}

export function createPlaybackQueue(): PlaybackQueue {
  let tracks: Track[] = [];
  let originalTracks: Track[] = [];
  let currentIndex = -1;
  let shuffle = false;
  let repeat: RepeatMode = "off";

  const syncIndex = (currentId: string) => {
    currentIndex = tracks.findIndex((t) => t.id === currentId);
  };

  return {
    setQueue(newTracks, currentId) {
      originalTracks = [...newTracks];
      tracks = shuffle ? shuffleKeepCurrent(originalTracks, currentId) : [...originalTracks];
      syncIndex(currentId);
    },

    getCurrent() {
      return currentIndex >= 0 ? tracks[currentIndex] : null;
    },

    getNext() {
      if (repeat === "one") return tracks[currentIndex] ?? null;
      if (currentIndex >= 0 && currentIndex < tracks.length - 1) {
        return tracks[currentIndex + 1];
      }
      if (repeat === "all" && tracks.length > 0) return tracks[0];
      return null;
    },

    getPrev() {
      if (currentIndex > 0) return tracks[currentIndex - 1];
      if (repeat === "all" && tracks.length > 0) return tracks[tracks.length - 1];
      return null;
    },

    advance() {
      const next = this.getNext();
      if (!next) return null;
      currentIndex = tracks.findIndex((t) => t.id === next.id);
      return next;
    },

    retreat() {
      const prev = this.getPrev();
      if (!prev) return null;
      currentIndex = tracks.findIndex((t) => t.id === prev.id);
      return prev;
    },

    toggleShuffle() {
      shuffle = !shuffle;
      const current = this.getCurrent();
      tracks = shuffle
        ? shuffleKeepCurrent(originalTracks, current?.id)
        : [...originalTracks];
      if (current) syncIndex(current.id);
      return shuffle;
    },

    cycleRepeat() {
      repeat = repeat === "off" ? "all" : repeat === "all" ? "one" : "off";
      return repeat;
    },

    isShuffled() {
      return shuffle;
    },

    getRepeatMode() {
      return repeat;
    },
  };
}

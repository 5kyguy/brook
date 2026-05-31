import type { Track } from "../types";

export type RepeatMode = "off" | "all" | "one";

export interface PlaybackQueue {
  setQueue(tracks: Track[], currentId: string): void;
  getTracks(): Track[];
  getCurrent(): Track | null;
  getNext(): Track | null;
  getPrev(): Track | null;
  advance(): Track | null;
  retreat(): Track | null;
  insertNext(track: Track): void;
  append(track: Track): void;
  remove(trackId: string): void;
  jumpTo(trackId: string): Track | null;
  clear(): void;
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

  const syncOriginalFromTracks = () => {
    if (!shuffle) {
      originalTracks = [...tracks];
    }
  };

  const applyShuffle = (currentId: string | undefined) => {
    tracks = shuffle ? shuffleKeepCurrent(originalTracks, currentId) : [...originalTracks];
  };

  const syncIndex = (currentId: string) => {
    currentIndex = tracks.findIndex((t) => t.id === currentId);
  };

  const removeFromLists = (trackId: string) => {
    originalTracks = originalTracks.filter((t) => t.id !== trackId);
    tracks = tracks.filter((t) => t.id !== trackId);
    if (currentIndex >= tracks.length) {
      currentIndex = tracks.length - 1;
    }
  };

  return {
    setQueue(newTracks, currentId) {
      originalTracks = [...newTracks];
      applyShuffle(currentId);
      syncIndex(currentId);
    },

    getTracks() {
      return [...tracks];
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

    insertNext(track) {
      const current = this.getCurrent();
      if (!current) {
        originalTracks = [track];
        tracks = [track];
        currentIndex = 0;
        return;
      }

      removeFromLists(track.id);

      const origIdx = originalTracks.findIndex((t) => t.id === current.id);
      const insertAt = origIdx >= 0 ? origIdx + 1 : originalTracks.length;
      originalTracks.splice(insertAt, 0, track);

      applyShuffle(current.id);
      syncIndex(current.id);
    },

    append(track) {
      const current = this.getCurrent();
      if (current?.id === track.id) return;

      if (originalTracks.some((t) => t.id === track.id)) {
        return;
      }

      originalTracks.push(track);
      applyShuffle(current?.id);
      if (current) syncIndex(current.id);
    },

    remove(trackId) {
      const wasCurrent = tracks[currentIndex]?.id === trackId;
      removeFromLists(trackId);
      if (wasCurrent && tracks.length > 0) {
        currentIndex = Math.min(currentIndex, tracks.length - 1);
      } else if (tracks.length === 0) {
        currentIndex = -1;
      } else if (currentIndex >= tracks.length) {
        currentIndex = tracks.length - 1;
      }
    },

    jumpTo(trackId) {
      const idx = tracks.findIndex((t) => t.id === trackId);
      if (idx < 0) return null;
      currentIndex = idx;
      return tracks[currentIndex];
    },

    clear() {
      const current = this.getCurrent();
      if (current) {
        originalTracks = [current];
        tracks = [current];
        currentIndex = 0;
      } else {
        originalTracks = [];
        tracks = [];
        currentIndex = -1;
      }
    },

    toggleShuffle() {
      shuffle = !shuffle;
      const current = this.getCurrent();
      if (!shuffle) {
        originalTracks = [...tracks];
      }
      applyShuffle(current?.id);
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

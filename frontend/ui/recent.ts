import * as api from "../api";
import type { Track } from "../types";
import { renderTrackList } from "./track-list";

export interface RecentPage {
  refresh(): Promise<void>;
}

export function initRecentPage(
  onPlay: (track: Track, queue?: Track[]) => void,
  onToggleFavorite: (track: Track) => void,
  onAddToPlaylist: (track: Track) => void,
  getPlayingTrackId: () => string | null,
): RecentPage {
  const container = document.getElementById("recent-tracks-container");
  if (!container) {
    throw new Error("Missing recent-tracks-container");
  }
  const listEl = container;

  async function refresh() {
    const tracks = await api.stats.getRecentTracks(50);
    renderTrackList(listEl, tracks, {
      onPlay,
      onToggleFavorite,
      onAddToPlaylist,
      playingTrackId: getPlayingTrackId(),
      showInlineLike: true,
      emptyMessage: "Nothing played yet. Start a track from your library.",
    });
  }

  return { refresh };
}

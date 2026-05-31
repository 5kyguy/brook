import * as api from "../api";
import type { Track } from "../types";
import { renderTrackList, type TrackListActions } from "./track-list";

export interface EntityPageController {
  openArtist(name: string): Promise<void>;
  openAlbum(name: string): Promise<void>;
  refresh(): Promise<void>;
}

export function initEntityPages(
  actions: TrackListActions,
  getPlayingTrackId: () => string | null,
): EntityPageController {
  const artistContainer = document.getElementById("artist-tracks-container");
  const albumContainer = document.getElementById("album-tracks-container");
  const artistTitle = document.getElementById("entity-artist-title");
  const albumTitle = document.getElementById("entity-album-title");
  let artistName = "";
  let albumName = "";

  const renderArtist = (tracks: Track[]) => {
    if (artistTitle) artistTitle.textContent = artistName;
    if (!artistContainer) return;
    renderTrackList(artistContainer, tracks, {
      ...actions,
      playingTrackId: getPlayingTrackId(),
      emptyMessage: "No tracks for this artist.",
    });
  };

  const renderAlbum = (tracks: Track[]) => {
    if (albumTitle) albumTitle.textContent = albumName;
    if (!albumContainer) return;
    renderTrackList(albumContainer, tracks, {
      ...actions,
      playingTrackId: getPlayingTrackId(),
      emptyMessage: "No tracks for this album.",
    });
  };

  return {
    async openArtist(name) {
      artistName = name;
      const tracks = await api.library.getTracks({ artist: name, sortBy: "album" });
      renderArtist(tracks);
    },
    async openAlbum(name) {
      albumName = name;
      const tracks = await api.library.getTracks({ album: name, sortBy: "title" });
      renderAlbum(tracks);
    },
    async refresh() {
      if (artistName) await this.openArtist(artistName);
      if (albumName) await this.openAlbum(albumName);
    },
  };
}

export function initTrackContextMenu(handlers: {
  onGoToArtist: (name: string) => void;
  onGoToAlbum: (name: string) => void;
  onAddToPlaylist: (track: Track) => void;
  onPlayNext: (track: Track) => void;
  onAddToQueue: (track: Track) => void;
}): void {
  const menu = document.getElementById("context-menu");
  if (!menu) return;

  let targetTrack: Track | null = null;

  document.addEventListener("contextmenu", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>(".track-item[data-track-id]");
    if (!row) return;
    event.preventDefault();
    const trackId = row.dataset.trackId;
    if (!trackId) return;

    void api.library.getTrack(trackId).then((track) => {
      targetTrack = track;
      menu.style.display = "block";
      menu.style.left = `${event.clientX}px`;
      menu.style.top = `${event.clientY}px`;
    });
  });

  document.addEventListener("click", () => {
    menu.style.display = "none";
  });

  menu.querySelectorAll<HTMLElement>("li[data-action]").forEach((item) => {
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!targetTrack) return;
      const action = item.dataset.action;
      if (action === "play-next") {
        handlers.onPlayNext(targetTrack);
      } else if (action === "add-to-queue") {
        handlers.onAddToQueue(targetTrack);
      } else if (action === "go-to-artist" && targetTrack.artist) {
        handlers.onGoToArtist(targetTrack.artist);
      } else if (action === "go-to-album" && targetTrack.album) {
        handlers.onGoToAlbum(targetTrack.album);
      } else if (action === "add-to-playlist") {
        handlers.onAddToPlaylist(targetTrack);
      }
      menu.style.display = "none";
    });
  });
}

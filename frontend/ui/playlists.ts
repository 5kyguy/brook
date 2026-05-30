import * as api from "../api";
import type { Playlist, Track } from "../types";
import { SVG_LIST_MUSIC } from "./icons";
import { renderTrackList } from "./track-list";
import type { Router } from "./router";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function createUserPlaylistCardHTML(playlist: Playlist): string {
  const count = playlist.trackCount;
  return `
    <div class="card user-playlist" data-user-playlist-id="${escapeHtml(playlist.id)}" data-href="/userplaylist/${escapeHtml(playlist.id)}" style="cursor: pointer;">
      <div class="card-image-wrapper">
        <img src="./assets/appicon.png" alt="" class="card-image" loading="lazy" />
      </div>
      <div class="card-info">
        <h3 class="card-title">${escapeHtml(playlist.name)}</h3>
        <p class="card-subtitle">${count} track${count === 1 ? "" : "s"}</p>
      </div>
    </div>
  `;
}

export interface PlaylistsController {
  refresh(): Promise<void>;
  openPlaylist(id: string): Promise<void>;
}

export function initPlaylists(
  router: Router,
  onPlay: (track: Track) => void,
  onToggleFavorite: (track: Track) => void,
  onAddToPlaylist: (track: Track) => void,
  getPlayingTrackId: () => string | null,
): PlaylistsController {
  const grid = document.getElementById("my-playlists-container");
  const createCard = document.getElementById("library-create-playlist-card");
  const detailTitle = document.getElementById("playlist-detail-title");
  const detailMeta = document.getElementById("playlist-detail-meta");
  const detailList = document.getElementById("playlist-detail-tracklist");
  const playPlaylistBtn = document.getElementById("play-playlist-btn");

  if (!grid || !createCard || !detailTitle || !detailMeta || !detailList) {
    throw new Error("Missing playlist elements");
  }

  const playlistGrid = grid;
  const titleEl = detailTitle;
  const metaEl = detailMeta;
  const tracksList = detailList;

  let playlists: Playlist[] = [];
  let currentPlaylistId: string | null = null;

  if (playPlaylistBtn) playPlaylistBtn.style.display = "none";
  document.getElementById("shuffle-playlist-btn")?.style.setProperty("display", "none");
  document.getElementById("download-playlist-btn")?.style.setProperty("display", "none");
  document.getElementById("like-playlist-btn")?.style.setProperty("display", "none");

  createCard.addEventListener("click", () => {
    const name = window.prompt("Playlist name");
    if (!name?.trim()) return;
    void (async () => {
      const playlist = await api.playlists.createPlaylist(name.trim());
      await refresh();
      router.openPlaylist(playlist.id);
    })();
  });

  async function refresh() {
    playlists = await api.playlists.getPlaylists();
    playlistGrid.querySelectorAll(".user-playlist").forEach((el) => el.remove());
    for (const playlist of playlists) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = createUserPlaylistCardHTML(playlist);
      const card = wrapper.firstElementChild as HTMLElement;
      card.addEventListener("click", () => {
        void openPlaylist(playlist.id);
      });
      playlistGrid.insertBefore(card, createCard);
    }
  }

  async function openPlaylist(id: string) {
    currentPlaylistId = id;
    const playlist = playlists.find((p) => p.id === id);
    const tracks = await api.playlists.getPlaylistTracks(id);
    titleEl.textContent = playlist?.name ?? "Playlist";
    metaEl.textContent = `${tracks.length} tracks`;
    renderTrackList(tracksList, tracks, {
      onPlay,
      onToggleFavorite,
      onAddToPlaylist,
      playingTrackId: getPlayingTrackId(),
      showInlineLike: true,
      showRemoveAction: true,
      onRemoveFromPlaylist: (track) => {
        void (async () => {
          await api.playlists.removeFromPlaylist(id, track.id);
          await openPlaylist(id);
        })();
      },
      emptyMessage: "This playlist is empty.",
    });
    router.openPlaylist(id);
  }

  return { refresh, openPlaylist };
}

export function wirePlaylistModalSave(onSaved: () => void): void {
  const modal = document.getElementById("playlist-modal");
  const saveBtn = document.getElementById("playlist-modal-save");
  const cancelBtn = document.getElementById("playlist-modal-cancel");
  const nameInput = document.getElementById("playlist-name-input") as HTMLInputElement | null;

  if (!modal || !saveBtn || !nameInput) return;

  const close = () => modal.classList.remove("active");

  cancelBtn?.addEventListener("click", close);
  modal.querySelector(".modal-overlay")?.addEventListener("click", close);

  saveBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) return;
    void (async () => {
      await api.playlists.createPlaylist(name);
      close();
      onSaved();
    })();
  });
}

export function ensureCreatePlaylistCardArt(): void {
  const art = document.querySelector("#library-create-playlist-card .library-create-dashed-art");
  if (art && !art.innerHTML.trim()) {
    art.innerHTML = SVG_LIST_MUSIC(28);
  }
}

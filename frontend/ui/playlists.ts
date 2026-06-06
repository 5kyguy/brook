import * as api from "../api";
import type { Playlist, PlaylistKind, Track } from "../types";
import { applyPlaylistCardCover, applyPlaylistDetailArtwork } from "./cover-art";
import { showToast } from "./dom";
import { SVG_LIST_MUSIC } from "./icons";
import { renderTrackList } from "./track-list";
import { wireInPageSearch } from "./search";
import type { Router } from "./router";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function chartDescription(kind: PlaylistKind): string {
  switch (kind) {
    case "weeklyTop":
      return "Your most played tracks this week.";
    case "monthlyTop":
      return "Your most played tracks this month.";
    case "quarterlyTop":
      return "Your most played tracks this quarter.";
    case "yearlyTop":
      return "Your most played tracks this year.";
    default:
      return "";
  }
}

function createUserPlaylistCardHTML(playlist: Playlist): string {
  const count = playlist.trackCount;
  const chartClass = playlist.kind !== "user" ? " chart-playlist" : "";
  return `
    <div class="card user-playlist${chartClass}" data-user-playlist-id="${escapeHtml(playlist.id)}" data-href="/userplaylist/${escapeHtml(playlist.id)}" style="cursor: pointer;">
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

async function decoratePlaylistCard(card: HTMLElement, playlistId: string): Promise<void> {
  try {
    const tracks = await api.playlists.getPlaylistTracks(playlistId);
    await applyPlaylistCardCover(
      card,
      tracks.slice(0, 4).map((track) => track.id),
    );
  } catch {
    /* keep placeholder */
  }
}

export interface PlaylistsController {
  refresh(): Promise<void>;
  openPlaylist(id: string): Promise<void>;
}

export function initPlaylists(
  router: Router,
  onPlay: (track: Track, queue?: Track[]) => void,
  onToggleFavorite: (track: Track) => void,
  onAddToPlaylist: (track: Track) => void,
  getPlayingTrackId: () => string | null,
): PlaylistsController {
  const grid = document.getElementById("my-playlists-container");
  const chartGrid = document.getElementById("chart-playlists-container");
  const createCard = document.getElementById("library-create-playlist-card");
  const detailTitle = document.getElementById("playlist-detail-title");
  const detailMeta = document.getElementById("playlist-detail-meta");
  const detailDescription = document.getElementById("playlist-detail-description");
  const detailImage = document.getElementById("playlist-detail-image") as HTMLImageElement | null;
  const detailCollage = document.getElementById("playlist-detail-collage");
  const detailList = document.getElementById("playlist-detail-tracklist");
  const playPlaylistBtn = document.getElementById("play-playlist-btn");
  const detailActions = document.querySelector("#page-playlist .detail-header-actions");

  if (!grid || !createCard || !detailTitle || !detailMeta || !detailList) {
    throw new Error("Missing playlist elements");
  }

  const playlistGrid = grid;
  const titleEl = detailTitle;
  const metaEl = detailMeta;
  const tracksList = detailList;

  let playlists: Playlist[] = [];
  let currentPlaylistId: string | null = null;
  let currentPlaylistKind: PlaylistKind = "user";
  let currentPlaylistTracks: Track[] = [];

  wireInPageSearch(
    "track-list-search-input",
    () => currentPlaylistTracks,
    (filtered) => {
      renderTrackList(tracksList, filtered, {
        onPlay,
        onToggleFavorite,
        onAddToPlaylist,
        playingTrackId: getPlayingTrackId(),
        showInlineLike: true,
        showRemoveAction: currentPlaylistKind === "user",
        onRemoveFromPlaylist: currentPlaylistId
          ? (track) => {
              void (async () => {
                await api.playlists.removeFromPlaylist(currentPlaylistId!, track.id);
                await openPlaylist(currentPlaylistId!);
              })();
            }
          : undefined,
        emptyMessage: "This playlist is empty.",
      });
    },
  );

  createCard.addEventListener("click", () => {
    openCreatePlaylistModal({ openAfterCreate: true });
  });

  playPlaylistBtn?.addEventListener("click", () => {
    if (currentPlaylistTracks.length === 0) return;
    onPlay(currentPlaylistTracks[0], currentPlaylistTracks);
  });

  function ensurePlaylistAdminButtons(isChart: boolean): void {
    document.getElementById("playlist-rename-btn")?.remove();
    document.getElementById("playlist-delete-btn")?.remove();
    if (isChart || !detailActions || !currentPlaylistId) return;

    const renameBtn = document.createElement("button");
    renameBtn.id = "playlist-rename-btn";
    renameBtn.type = "button";
    renameBtn.className = "btn-secondary";
    renameBtn.textContent = "Rename";
    renameBtn.addEventListener("click", () => {
      const playlist = playlists.find((p) => p.id === currentPlaylistId);
      const nextName = window.prompt("Rename playlist", playlist?.name ?? "");
      if (!nextName?.trim() || !currentPlaylistId) return;
      void (async () => {
        await api.playlists.updatePlaylist(currentPlaylistId!, nextName.trim());
        await refresh();
        await openPlaylist(currentPlaylistId!);
      })();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.id = "playlist-delete-btn";
    deleteBtn.type = "button";
    deleteBtn.className = "btn-secondary delete-playlist-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      if (!currentPlaylistId) return;
      const playlist = playlists.find((p) => p.id === currentPlaylistId);
      if (!window.confirm(`Delete playlist "${playlist?.name ?? "this playlist"}"?`)) return;
      void (async () => {
        await api.playlists.deletePlaylist(currentPlaylistId!);
        currentPlaylistId = null;
        await refresh();
        router.navigate("library");
      })();
    });

    detailActions.appendChild(renameBtn);
    detailActions.appendChild(deleteBtn);
  }

  async function refresh() {
    playlists = await api.playlists.getPlaylists();
    const charts = playlists.filter((p) => p.kind !== "user");
    const userPlaylists = playlists.filter((p) => p.kind === "user");

    if (chartGrid) {
      chartGrid.replaceChildren();
      for (const playlist of charts) {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = createUserPlaylistCardHTML(playlist);
        const card = wrapper.firstElementChild as HTMLElement;
        card.addEventListener("click", () => {
          router.openPlaylist(playlist.id);
        });
        chartGrid.appendChild(card);
        void decoratePlaylistCard(card, playlist.id);
      }
      chartGrid.parentElement?.classList.toggle("hidden-section", charts.length === 0);
    }

    playlistGrid.querySelectorAll(".user-playlist").forEach((el) => el.remove());
    for (const playlist of userPlaylists) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = createUserPlaylistCardHTML(playlist);
      const card = wrapper.firstElementChild as HTMLElement;
      card.addEventListener("click", () => {
        router.openPlaylist(playlist.id);
      });
      playlistGrid.insertBefore(card, createCard);
      void decoratePlaylistCard(card, playlist.id);
    }
  }

  async function openPlaylist(id: string) {
    currentPlaylistId = id;
    const playlist = playlists.find((p) => p.id === id);
    currentPlaylistKind = playlist?.kind ?? "user";
    const isChart = currentPlaylistKind !== "user";
    const tracks = await api.playlists.getPlaylistTracks(id);
    currentPlaylistTracks = tracks;
    titleEl.textContent = playlist?.name ?? "Playlist";
    metaEl.textContent = isChart
      ? `${tracks.length} tracks · auto-updated`
      : `${tracks.length} tracks`;

    if (detailDescription) {
      if (isChart) {
        detailDescription.textContent = chartDescription(currentPlaylistKind);
        detailDescription.style.display = detailDescription.textContent ? "" : "none";
      } else {
        detailDescription.textContent = "";
        detailDescription.style.display = "none";
      }
    }

    await applyPlaylistDetailArtwork(
      detailImage,
      detailCollage,
      tracks.slice(0, 4).map((track) => track.id),
    );
    ensurePlaylistAdminButtons(isChart);

    renderTrackList(tracksList, tracks, {
      onPlay,
      onToggleFavorite,
      onAddToPlaylist,
      playingTrackId: getPlayingTrackId(),
      showInlineLike: true,
      showRemoveAction: !isChart,
      onRemoveFromPlaylist: (track) => {
        void (async () => {
          await api.playlists.removeFromPlaylist(id, track.id);
          await openPlaylist(id);
        })();
      },
      emptyMessage: "This playlist is empty.",
    });
  }

  return { refresh, openPlaylist };
}

export interface OpenCreatePlaylistModalOptions {
  /** Add this track to the new playlist after creation (from add-to-playlist flow). */
  pendingTrackId?: string;
  /** Navigate to the new playlist detail view after creation (library create card). */
  openAfterCreate?: boolean;
}

export interface PlaylistModalSaveResult {
  playlist: Playlist;
  pendingTrackId?: string;
  openAfterCreate: boolean;
}

export function openCreatePlaylistModal(options: OpenCreatePlaylistModalOptions = {}): void {
  const modal = document.getElementById("playlist-modal");
  const nameInput = document.getElementById("playlist-name-input") as HTMLInputElement | null;
  if (!modal || !nameInput) return;

  delete modal.dataset.pendingTrackId;
  delete modal.dataset.openAfterCreate;
  if (options.pendingTrackId) modal.dataset.pendingTrackId = options.pendingTrackId;
  if (options.openAfterCreate) modal.dataset.openAfterCreate = "true";

  nameInput.value = "";
  modal.classList.add("active");
  nameInput.focus();
}

export function wirePlaylistModalSave(
  onSaved: (result: PlaylistModalSaveResult) => void,
): void {
  const modal = document.getElementById("playlist-modal");
  const saveBtn = document.getElementById("playlist-modal-save");
  const cancelBtn = document.getElementById("playlist-modal-cancel");
  const nameInput = document.getElementById("playlist-name-input") as HTMLInputElement | null;

  if (!modal || !saveBtn || !nameInput) return;

  let saving = false;

  const close = () => {
    modal.classList.remove("active");
    delete modal.dataset.pendingTrackId;
    delete modal.dataset.openAfterCreate;
  };

  const submit = () => {
    if (saving) return;
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    const pendingTrackId = modal.dataset.pendingTrackId;
    const openAfterCreate = modal.dataset.openAfterCreate === "true";
    saving = true;
    saveBtn.setAttribute("disabled", "true");
    void (async () => {
      try {
        const playlist = await api.playlists.createPlaylist(name);
        close();
        onSaved({
          playlist,
          pendingTrackId,
          openAfterCreate,
        });
      } finally {
        saving = false;
        saveBtn.removeAttribute("disabled");
      }
    })();
  };

  cancelBtn?.addEventListener("click", close);
  modal.querySelector(".modal-overlay")?.addEventListener("click", close);

  saveBtn.addEventListener("click", submit);

  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
}

export function ensureCreatePlaylistCardArt(): void {
  const art = document.querySelector("#library-create-playlist-card .library-create-dashed-art");
  if (art && !art.innerHTML.trim()) {
    art.innerHTML = SVG_LIST_MUSIC(28);
  }
}

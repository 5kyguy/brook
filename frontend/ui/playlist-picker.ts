import * as api from "../api";
import type { Track } from "../types";
import { openCreatePlaylistModal } from "./playlists";
import { showToast } from "./dom";

export interface PlaylistPicker {
  open(track: Track): Promise<void>;
}

export function initPlaylistPicker(onChanged?: () => void): PlaylistPicker {
  const modal = document.getElementById("playlist-select-modal");
  const list = document.getElementById("playlist-select-list");
  const cancelBtn = document.getElementById("playlist-select-cancel");

  if (!modal || !list) {
    return { async open() {} };
  }

  let currentTrack: Track | null = null;

  const close = () => {
    modal.classList.remove("active");
    currentTrack = null;
  };

  cancelBtn?.addEventListener("click", close);
  modal.querySelector(".modal-overlay")?.addEventListener("click", close);

  const render = async () => {
    const playlists = (await api.playlists.getPlaylists()).filter((p) => p.kind === "user");
    list.innerHTML =
      `<div class="modal-option create-new-option" data-action="create">
        <span style="font-weight: 600; color: var(--primary);">+ Create New Playlist</span>
      </div>` +
      playlists
        .map(
          (p) =>
            `<div class="modal-option" data-id="${p.id}"><span>${p.name}</span></div>`,
        )
        .join("");

    list.querySelectorAll(".modal-option").forEach((option) => {
      option.addEventListener("click", () => {
        if (!currentTrack) return;
        if (option.classList.contains("create-new-option")) {
          close();
          openCreatePlaylistModal({ pendingTrackId: currentTrack.id });
          return;
        }
        const id = (option as HTMLElement).dataset.id;
        if (!id) return;
        void (async () => {
          try {
            await api.playlists.addToPlaylist(id, currentTrack!.id);
            close();
            onChanged?.();
          } catch (error) {
            showToast(error instanceof Error ? error.message : "Could not add to playlist.");
          }
        })();
      });
    });
  };

  return {
    async open(track) {
      currentTrack = track;
      await render();
      modal.classList.add("active");
    },
  };
}

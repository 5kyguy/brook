import { initThemeSettings } from "./theme";
import { initVisualSettings } from "./visual";
import * as api from "../api";

export interface SettingsPage {
  refreshMusicRoot(): Promise<void>;
}

export function initSettingsPage(
  onRescan: () => Promise<void>,
  onMusicRootChanged: () => Promise<void>,
): SettingsPage {
  initThemeSettings();
  initVisualSettings();

  const statusEl = document.getElementById("settings-music-root-status");

  if (!document.getElementById("settings-music-folder-group")) {
    const list = document.querySelector("#page-settings .settings-list");
    if (list) {
      const group = document.createElement("div");
      group.className = "settings-group";
      group.id = "settings-music-folder-group";
      group.innerHTML = `
        <div class="setting-item">
          <div class="info">
            <span class="label">Music folder</span>
            <span class="description">Where Brook scans for audio files. Changing this clears scanned tracks, play history, stats, likes, and playlist entries tied to those tracks. Your playlist names are kept.</span>
          </div>
          <div class="settings-music-folder-actions">
            <button type="button" id="settings-choose-music-folder-btn" class="btn-secondary">Choose folder…</button>
          </div>
        </div>
        <p id="settings-music-root-status" style="text-align:center;color:var(--muted-foreground);font-size:0.8rem"></p>
        <div class="setting-item">
          <div class="info">
            <span class="label">Music library</span>
            <span class="description">Rescan files under your music folder</span>
          </div>
          <button type="button" id="settings-rescan-btn" class="btn-secondary">Rescan library</button>
        </div>
        <p id="settings-rescan-status" style="text-align:center;color:var(--muted-foreground);font-size:0.8rem"></p>
      `;
      list.insertBefore(group, list.firstChild);
    }
  }

  const musicStatus =
    document.getElementById("settings-music-root-status") ?? statusEl;

  async function refreshMusicRoot() {
    await api.library.getMusicRoot();
  }

  document.getElementById("settings-choose-music-folder-btn")?.addEventListener("click", () => {
    const btn = document.getElementById("settings-choose-music-folder-btn") as HTMLButtonElement | null;
    if (!btn) return;
    btn.disabled = true;
    if (musicStatus) musicStatus.textContent = "";
    void (async () => {
      try {
        const picked = await api.library.pickMusicFolder();
        if (!picked) return;
        if (musicStatus) musicStatus.textContent = "Updating music folder…";
        await api.library.setMusicRoot(picked);
        await onMusicRootChanged();
        if (musicStatus) musicStatus.textContent = "Music folder updated and library rescanned.";
      } catch (error) {
        if (musicStatus) {
          musicStatus.textContent =
            error instanceof Error ? error.message : "Failed to update music folder.";
        }
      } finally {
        btn.disabled = false;
      }
    })();
  });

  document.getElementById("settings-rescan-btn")?.addEventListener("click", () => {
    const btn = document.getElementById("settings-rescan-btn") as HTMLButtonElement | null;
    const rescanStatus = document.getElementById("settings-rescan-status");
    if (!btn) return;
    btn.disabled = true;
    if (rescanStatus) rescanStatus.textContent = "Scanning…";
    void onRescan()
      .then(() => {
        if (rescanStatus) rescanStatus.textContent = "Library scan complete.";
      })
      .catch((error: unknown) => {
        if (rescanStatus) {
          rescanStatus.textContent = error instanceof Error ? error.message : "Scan failed.";
        }
      })
      .finally(() => {
        btn.disabled = false;
      });
  });

  document.getElementById("customize-shortcuts-btn")?.addEventListener("click", () => {
    document.getElementById("shortcuts-modal")?.classList.add("active");
  });
  document.querySelector(".close-shortcuts")?.addEventListener("click", () => {
    document.getElementById("shortcuts-modal")?.classList.remove("active");
  });

  return {
    refreshMusicRoot,
  };
}

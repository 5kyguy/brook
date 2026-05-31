import { initThemeSettings } from "./theme";
import { initVisualSettings } from "./visual";
import * as api from "../api";

export interface SettingsPage {
  setMusicRoot(path: string): void;
  refreshMusicRoot(): Promise<void>;
}

export function initSettingsPage(
  onRescan: () => Promise<void>,
  onMusicRootChanged: () => Promise<void>,
): SettingsPage {
  initThemeSettings();
  initVisualSettings();

  const rootEl = document.getElementById("settings-music-root");
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
            <span class="description">Where Brook scans for audio files. Changing this clears your library scan, stats, and likes.</span>
          </div>
          <div class="settings-music-folder-actions">
            <button type="button" id="settings-choose-music-folder-btn" class="btn-secondary">Choose folder…</button>
            <button type="button" id="settings-reset-music-folder-btn" class="btn-secondary">Use default</button>
          </div>
        </div>
        <p id="settings-music-root-status" style="text-align:center;color:var(--muted-foreground);font-size:0.8rem"></p>
      `;
      list.insertBefore(group, list.firstChild);
    }
  }

  if (!document.getElementById("settings-rescan-btn")) {
    const list = document.querySelector("#page-settings .settings-list");
    if (list) {
      const group = document.createElement("div");
      group.className = "settings-group";
      group.innerHTML = `
        <div class="setting-item">
          <div class="info">
            <span class="label">Music library</span>
            <span class="description">Rescan files under your music folder</span>
          </div>
          <button type="button" id="settings-rescan-btn" class="btn-secondary">Rescan library</button>
        </div>
        <p id="settings-rescan-status" style="text-align:center;color:var(--muted-foreground);font-size:0.8rem"></p>
      `;
      list.appendChild(group);
    }
  }

  const musicStatus =
    document.getElementById("settings-music-root-status") ?? statusEl;

  async function refreshMusicRoot() {
    const path = await api.library.getMusicRoot();
    setMusicRoot(path);
  }

  function setMusicRoot(path: string) {
    if (rootEl) rootEl.textContent = path;
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
        const path = await api.library.setMusicRoot(picked);
        setMusicRoot(path);
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

  document.getElementById("settings-reset-music-folder-btn")?.addEventListener("click", () => {
    const btn = document.getElementById("settings-reset-music-folder-btn") as HTMLButtonElement | null;
    if (!btn) return;
    btn.disabled = true;
    if (musicStatus) musicStatus.textContent = "";
    void (async () => {
      try {
        if (musicStatus) musicStatus.textContent = "Resetting to default folder…";
        const path = await api.library.resetMusicRoot();
        setMusicRoot(path);
        await onMusicRootChanged();
        if (musicStatus) musicStatus.textContent = "Using default music folder.";
      } catch (error) {
        if (musicStatus) {
          musicStatus.textContent =
            error instanceof Error ? error.message : "Failed to reset music folder.";
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
    setMusicRoot,
    refreshMusicRoot,
  };
}

import { initThemeSettings } from "./theme";
import { initVisualSettings } from "./visual";

export interface SettingsPage {
  setMusicRoot(path: string): void;
}

export function initSettingsPage(onRescan: () => Promise<void>): SettingsPage {
  initThemeSettings();
  initVisualSettings();

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

  document.getElementById("settings-rescan-btn")?.addEventListener("click", () => {
    const btn = document.getElementById("settings-rescan-btn") as HTMLButtonElement | null;
    const status = document.getElementById("settings-rescan-status");
    if (!btn) return;
    btn.disabled = true;
    if (status) status.textContent = "Scanning…";
    void onRescan()
      .then(() => {
        if (status) status.textContent = "Library scan complete.";
      })
      .catch((error: unknown) => {
        if (status) {
          status.textContent = error instanceof Error ? error.message : "Scan failed.";
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
    setMusicRoot(path: string) {
      const rootEl = document.getElementById("settings-music-root");
      if (rootEl) rootEl.textContent = path;
      const commitEl = document.getElementById("settings-commit-info");
      if (commitEl) commitEl.textContent = "Brook · offline desktop player";
    },
  };
}

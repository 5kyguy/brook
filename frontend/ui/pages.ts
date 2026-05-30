import { el } from "./dom";

export function initSearchPage(): void {
  const container = document.getElementById("search-results");
  if (!container) return;
  container.textContent = "Search UI coming soon.";
}

export function initStatsPage(): void {
  const container = document.getElementById("stats-content");
  if (!container) return;
  container.textContent = "Listening stats coming soon.";
}

export function renderSettingsPlaceholder(musicRoot: string): void {
  const rootEl = document.getElementById("settings-music-root");
  if (rootEl) rootEl.textContent = musicRoot;

  const commitEl = document.getElementById("settings-commit-info");
  if (commitEl) commitEl.textContent = "Brook dev build";
}

export function buildSettingsGroups(): void {
  const page = document.getElementById("page-settings");
  if (!page || page.querySelector(".settings-list")) return;

  const list = el("div", "settings-list");
  list.innerHTML = `
    <div class="settings-group">
      <div class="setting-item">
        <div class="info">
          <span class="label">Theme</span>
          <span class="description">Choose your preferred color scheme</span>
        </div>
      </div>
      <div class="theme-picker" id="theme-picker">
        <div class="theme-option" data-theme="monochrome">Black</div>
        <div class="theme-option" data-theme="white">White</div>
        <div class="theme-option" data-theme="ocean">Ocean</div>
        <div class="theme-option" data-theme="purple">Purple</div>
        <div class="theme-option" data-theme="forest">Forest</div>
      </div>
    </div>
    <p id="settings-music-root" class="settings-meta"></p>
    <p id="settings-commit-info" class="settings-meta"></p>
  `;
  page.appendChild(list);
}

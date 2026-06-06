import { reapplyTrackVisualEffects } from "./visual-effects";

const STORAGE_PREFIX = "brook-";

export interface VisualSettings {
  dynamicColor: boolean;
}

const DEFAULTS: VisualSettings = {
  dynamicColor: false,
};

function key(name: keyof VisualSettings): string {
  const map: Record<keyof VisualSettings, string> = {
    dynamicColor: "dynamic-color",
  };
  return STORAGE_PREFIX + map[name];
}

export function loadVisualSettings(): VisualSettings {
  const read = (name: keyof VisualSettings): boolean => {
    const stored = localStorage.getItem(key(name));
    if (stored === null) return DEFAULTS[name];
    return stored === "true";
  };
  return {
    dynamicColor: read("dynamicColor"),
  };
}

function saveVisualSetting(name: keyof VisualSettings, value: boolean): void {
  localStorage.setItem(key(name), String(value));
  const datasetKey = name.replace(/([A-Z])/g, "-$1").toLowerCase();
  document.body.dataset[datasetKey] = String(value);
}

function applyVisualSettings(settings: VisualSettings): void {
  document.body.dataset.dynamicColor = String(settings.dynamicColor);
}

export function initVisualSettings(): void {
  document.getElementById("page-background")?.remove();
  document.body.classList.remove("album-background-enabled", "cd-spin-enabled");
  localStorage.removeItem(STORAGE_PREFIX + "album-background");
  localStorage.removeItem(STORAGE_PREFIX + "waveform");
  localStorage.removeItem(STORAGE_PREFIX + "cd-spin");
  document.querySelectorAll(".waveform-canvas").forEach((el) => el.remove());
  document.querySelectorAll(".progress-bar.waveform-enabled").forEach((el) => {
    el.classList.remove("waveform-enabled");
  });
  document.querySelectorAll(".fullscreen-artwork-card.cd-spin").forEach((el) => {
    el.classList.remove("cd-spin");
  });

  const settings = loadVisualSettings();
  applyVisualSettings(settings);

  const input = document.getElementById("dynamic-color-toggle") as HTMLInputElement | null;
  if (!input) return;
  input.checked = settings.dynamicColor;
  input.addEventListener("change", () => {
    saveVisualSetting("dynamicColor", input.checked);
    applyVisualSettings(loadVisualSettings());
    reapplyTrackVisualEffects();
  });
}

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

export function saveVisualSetting(name: keyof VisualSettings, value: boolean): void {
  localStorage.setItem(key(name), String(value));
  document.body.dataset[name.replace(/([A-Z])/g, "-$1").toLowerCase()] = String(value);
}

export function applyVisualSettings(settings: VisualSettings): void {
  document.body.dataset.dynamicColor = String(settings.dynamicColor);
}

export function initVisualSettings(): void {
  const settings = loadVisualSettings();
  applyVisualSettings(settings);

  const bindToggle = (id: string, name: keyof VisualSettings) => {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) return;
    input.checked = settings[name];
    input.addEventListener("change", () => {
      saveVisualSetting(name, input.checked);
      if (name === "dynamicColor") {
        reapplyTrackVisualEffects();
      }
    });
  };

  bindToggle("dynamic-color-toggle", "dynamicColor");
}

const STORAGE_PREFIX = "brook-";

export interface VisualSettings {
  waveformEnabled: boolean;
  albumBackground: boolean;
  dynamicColor: boolean;
  cdAlbumCover: boolean;
}

const DEFAULTS: VisualSettings = {
  waveformEnabled: true,
  albumBackground: true,
  dynamicColor: false,
  cdAlbumCover: false,
};

function key(name: keyof VisualSettings): string {
  const map: Record<keyof VisualSettings, string> = {
    waveformEnabled: "waveform-enabled",
    albumBackground: "album-background",
    dynamicColor: "dynamic-color",
    cdAlbumCover: "cd-album-cover",
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
    waveformEnabled: read("waveformEnabled"),
    albumBackground: read("albumBackground"),
    dynamicColor: read("dynamicColor"),
    cdAlbumCover: read("cdAlbumCover"),
  };
}

export function saveVisualSetting(name: keyof VisualSettings, value: boolean): void {
  localStorage.setItem(key(name), String(value));
  document.body.dataset[name.replace(/([A-Z])/g, "-$1").toLowerCase()] = String(value);
}

export function applyVisualSettings(settings: VisualSettings): void {
  document.body.dataset.waveformEnabled = String(settings.waveformEnabled);
  document.body.dataset.albumBackground = String(settings.albumBackground);
  document.body.dataset.dynamicColor = String(settings.dynamicColor);
  document.body.dataset.cdAlbumCover = String(settings.cdAlbumCover);
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
    });
  };

  bindToggle("waveform-toggle", "waveformEnabled");
  bindToggle("album-background-toggle", "albumBackground");
  bindToggle("dynamic-color-toggle", "dynamicColor");
  bindToggle("cd-album-cover-toggle", "cdAlbumCover");
}

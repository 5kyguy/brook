import { getTrackCoverUrl } from "../ui/cover-art";
import type { Track } from "../types";
import { loadVisualSettings } from "./visual";

let dynamicColorStyle: HTMLStyleElement | null = null;

function pageBackgroundEl(): HTMLElement | null {
  return document.getElementById("page-background");
}

let currentTrackForVisuals: Track | null = null;

export function setCurrentTrackForVisuals(track: Track | null): void {
  currentTrackForVisuals = track;
  void applyTrackVisualEffects(track);
}

export function reapplyTrackVisualEffects(): void {
  void applyTrackVisualEffects(currentTrackForVisuals);
}

export async function applyTrackVisualEffects(track: Track | null): Promise<void> {
  const settings = loadVisualSettings();
  const bg = pageBackgroundEl();

  if (!track || !settings.albumBackground) {
    document.body.classList.remove("has-page-background");
    if (bg) {
      bg.classList.remove("active");
      bg.style.backgroundImage = "";
    }
    if (!settings.dynamicColor) {
      clearDynamicAccent();
    }
    return;
  }

  const coverUrl = await getTrackCoverUrl(track.id);

  if (settings.albumBackground && bg) {
    bg.style.backgroundImage = `url("${coverUrl}")`;
    bg.classList.add("active");
    document.body.classList.add("has-page-background");
  }

  if (settings.dynamicColor) {
    await applyDynamicAccent(coverUrl);
  } else {
    clearDynamicAccent();
  }
}

export function applyCdAlbumCoverEffect(enabled: boolean): void {
  const overlay = document.getElementById("fullscreen-cover-overlay");
  const image = document.getElementById("fullscreen-cover-image");
  const card = image?.closest(".fullscreen-artwork-card") as HTMLElement | null;
  if (card) {
    card.classList.toggle("cd", enabled);
  }
  image?.classList.toggle("cd", enabled);
  overlay?.classList.toggle("cd-mode", enabled);
}

export function syncVisualEffectToggles(): void {
  const settings = loadVisualSettings();
  applyCdAlbumCoverEffect(settings.cdAlbumCover);
}

async function applyDynamicAccent(coverUrl: string): Promise<void> {
  if (coverUrl.includes("appicon.png")) {
    clearDynamicAccent();
    return;
  }

  try {
    const color = await extractAverageColor(coverUrl);
    if (!dynamicColorStyle) {
      dynamicColorStyle = document.createElement("style");
      dynamicColorStyle.id = "brook-dynamic-accent";
      document.head.appendChild(dynamicColorStyle);
    }
    dynamicColorStyle.textContent = `:root {
      --primary: ${color};
      --highlight: ${color};
      --brand: ${color};
    }`;
  } catch {
    clearDynamicAccent();
  }
}

function clearDynamicAccent(): void {
  dynamicColorStyle?.remove();
  dynamicColorStyle = null;
}

function extractAverageColor(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, 32, 32);
      const { data } = ctx.getImageData(0, 0, 32, 32);
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        count += 1;
      }
      if (count === 0) {
        reject(new Error("empty image"));
        return;
      }
      resolve(
        `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`,
      );
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

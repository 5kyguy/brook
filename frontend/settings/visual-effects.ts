import { getTrackCoverUrl } from "../ui/cover-art";
import type { Track } from "../types";
import { loadVisualSettings } from "./visual";

let dynamicColorStyle: HTMLStyleElement | null = null;

let currentTrackForVisuals: Track | null = null;

export function setCurrentTrackForVisuals(track: Track | null): void {
  currentTrackForVisuals = track;
  void applyTrackVisualEffects(track);
}

export function reapplyTrackVisualEffects(): void {
  void applyTrackVisualEffects(currentTrackForVisuals);
}

async function applyTrackVisualEffects(track: Track | null): Promise<void> {
  const settings = loadVisualSettings();

  if (!track || !settings.dynamicColor) {
    clearDynamicAccent();
    return;
  }

  const coverUrl = await getTrackCoverUrl(track.id);
  await applyDynamicAccent(coverUrl);
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

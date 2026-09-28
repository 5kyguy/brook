import { getTrackCoverUrl } from "../ui/cover-art";
import type { Track } from "../types";
import { deriveDarkAccent } from "./accent";
import {
  beginAccentExtract,
  bindSharedThemeInvalidation,
  finishAccentExtract,
  isCurrentAccentExtract,
} from "./shared-theme";
import { loadVisualSettings } from "./visual";

let currentTrackForVisuals: Track | null = null;

bindSharedThemeInvalidation(() => {
  void applyTrackVisualEffects(currentTrackForVisuals);
});

export function setCurrentTrackForVisuals(track: Track | null): void {
  currentTrackForVisuals = track;
  void applyTrackVisualEffects(track);
}

export function reapplyTrackVisualEffects(): void {
  void applyTrackVisualEffects(currentTrackForVisuals);
}

async function applyTrackVisualEffects(track: Track | null): Promise<void> {
  const settings = loadVisualSettings();
  const id = beginAccentExtract(track?.id ?? null, settings.dynamicColor);
  if (!track || !settings.dynamicColor) return;

  try {
    const coverUrl = await getTrackCoverUrl(track.id);
    if (!isCurrentAccentExtract(id)) return;
    if (coverUrl.includes("appicon.png")) {
      finishAccentExtract(id, null);
      return;
    }
    const color = await extractAverageHex(coverUrl);
    if (!isCurrentAccentExtract(id)) return;
    finishAccentExtract(id, deriveDarkAccent(color));
  } catch {
    if (isCurrentAccentExtract(id)) finishAccentExtract(id, null);
  }
}

function extractAverageHex(url: string): Promise<string> {
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
        const alpha = data[i + 3] ?? 0;
        if (alpha < 16) continue;
        r += data[i] ?? 0;
        g += data[i + 1] ?? 0;
        b += data[i + 2] ?? 0;
        count += 1;
      }
      if (count === 0) {
        reject(new Error("empty image"));
        return;
      }
      const channel = (value: number) =>
        Math.max(0, Math.min(255, Math.round(value / count)))
          .toString(16)
          .padStart(2, "0");
      resolve(`#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase());
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

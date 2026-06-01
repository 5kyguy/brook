import * as api from "../api";

export const COVER_PLACEHOLDER = "./assets/appicon.png";

const coverUrlCache = new Map<string, string>();

const MAX_CONCURRENT_COVERS = 6;
let coversInFlight = 0;
const coverQueue: Array<() => void> = [];

function runCoverQueue(): void {
  while (coversInFlight < MAX_CONCURRENT_COVERS && coverQueue.length > 0) {
    const next = coverQueue.shift();
    if (!next) break;
    coversInFlight += 1;
    next();
  }
}

function scheduleCoverTask(task: () => Promise<void>): void {
  const run = () => {
    void task().finally(() => {
      coversInFlight -= 1;
      runCoverQueue();
    });
  };

  if (coversInFlight < MAX_CONCURRENT_COVERS) {
    coversInFlight += 1;
    run();
  } else {
    coverQueue.push(run);
  }
}

export async function getTrackCoverUrl(trackId: string): Promise<string> {
  const cached = coverUrlCache.get(trackId);
  if (cached) return cached;

  if (!api.isTauri()) {
    return COVER_PLACEHOLDER;
  }

  return new Promise((resolve) => {
    scheduleCoverTask(async () => {
      try {
        const art = await api.library.getAlbumArt(trackId);
        if (!art?.data?.length) {
          coverUrlCache.set(trackId, COVER_PLACEHOLDER);
          resolve(COVER_PLACEHOLDER);
          return;
        }
        const blob = new Blob([Uint8Array.from(art.data)], { type: art.mimeType });
        const url = URL.createObjectURL(blob);
        coverUrlCache.set(trackId, url);
        resolve(url);
      } catch {
        coverUrlCache.set(trackId, COVER_PLACEHOLDER);
        resolve(COVER_PLACEHOLDER);
      }
    });
  });
}

export function applyTrackCovers(container: HTMLElement): void {
  container.querySelectorAll<HTMLImageElement>(".track-item-cover[data-track-id]").forEach((img) => {
    const trackId = img.dataset.trackId;
    if (!trackId) return;
    void getTrackCoverUrl(trackId).then((url) => {
      img.src = url;
    });
  });
}

export function setCoverImage(img: HTMLImageElement | null, trackId: string | null): void {
  if (!img) return;
  if (!trackId) {
    img.src = COVER_PLACEHOLDER;
    return;
  }
  void getTrackCoverUrl(trackId).then((url) => {
    img.src = url;
  });
}

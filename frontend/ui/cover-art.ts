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

export async function fillCoverCollage(
  container: HTMLElement,
  trackIds: string[],
): Promise<void> {
  container.replaceChildren();
  const ids = trackIds.slice(0, 4);
  if (ids.length === 0) return;

  const urls = await Promise.all(ids.map((id) => getTrackCoverUrl(id)));
  const isDetailCollage = container.classList.contains("detail-header-collage");

  if (ids.length === 1) {
    const img = document.createElement("img");
    img.src = urls[0] ?? COVER_PLACEHOLDER;
    img.alt = "";
    container.appendChild(img);
    return;
  }

  if (!isDetailCollage) {
    container.classList.add("card-collage", `items-${ids.length}`);
  }

  urls.forEach((url, index) => {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    if (ids.length === 3 && index === 0) {
      img.style.gridRow = "span 2";
    }
    container.appendChild(img);
  });
}

export async function applyPlaylistCardCover(
  card: HTMLElement,
  trackIds: string[],
): Promise<void> {
  const wrapper = card.querySelector<HTMLElement>(".card-image-wrapper");
  if (!wrapper) return;

  wrapper.querySelector(".card-collage")?.remove();
  const img = wrapper.querySelector<HTMLImageElement>(".card-image");

  if (trackIds.length === 0) {
    if (img) img.src = COVER_PLACEHOLDER;
    return;
  }

  if (trackIds.length === 1 && img) {
    img.style.display = "";
    setCoverImage(img, trackIds[0]);
    return;
  }

  if (img) img.style.display = "none";
  const collage = document.createElement("div");
  collage.className = "card-collage";
  wrapper.appendChild(collage);
  await fillCoverCollage(collage, trackIds);
}

export async function applyPlaylistDetailArtwork(
  imageEl: HTMLImageElement | null,
  collageEl: HTMLElement | null,
  trackIds: string[],
): Promise<void> {
  if (!imageEl || !collageEl) return;

  collageEl.className = "detail-header-collage";
  collageEl.replaceChildren();

  if (trackIds.length === 0) {
    imageEl.style.display = "";
    collageEl.style.display = "none";
    imageEl.src = COVER_PLACEHOLDER;
    return;
  }

  if (trackIds.length === 1) {
    collageEl.style.display = "none";
    imageEl.style.display = "";
    setCoverImage(imageEl, trackIds[0]);
    return;
  }

  imageEl.style.display = "none";
  collageEl.style.display = "";
  await fillCoverCollage(collageEl, trackIds);
}

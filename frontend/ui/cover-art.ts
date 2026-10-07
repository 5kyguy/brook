import * as api from "../api";

export const COVER_PLACEHOLDER = "./assets/appicon.png";

/** Which cover variant to resolve for a given track. Lists use the small
 *  thumbnail (one IPC round-trip, tiny payload); the player and detail
 *  headers use the full image. */
export type CoverVariant = "thumb" | "full";

// Separate URL caches per variant so a list thumb and a player full do not
// clobber each other for the same track.
const coverUrlCache = new Map<CoverVariant, Map<string, string>>([
  ["thumb", new Map()],
  ["full", new Map()],
]);

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

export async function getTrackCoverUrl(
  trackId: string,
  variant: CoverVariant = "full",
): Promise<string> {
  const cache = coverUrlCache.get(variant)!;
  const cached = cache.get(trackId);
  if (cached) return cached;

  if (!api.isTauri()) {
    return COVER_PLACEHOLDER;
  }

  return new Promise((resolve) => {
    scheduleCoverTask(async () => {
      try {
        const art =
          variant === "thumb"
            ? await api.library.getAlbumArtThumb(trackId)
            : await api.library.getAlbumArt(trackId);
        if (!art?.data?.length) {
          cache.set(trackId, COVER_PLACEHOLDER);
          resolve(COVER_PLACEHOLDER);
          return;
        }
        const blob = new Blob([Uint8Array.from(art.data)], { type: art.mimeType });
        const url = URL.createObjectURL(blob);
        cache.set(trackId, url);
        resolve(url);
      } catch {
        cache.set(trackId, COVER_PLACEHOLDER);
        resolve(COVER_PLACEHOLDER);
      }
    });
  });
}

/** List rows use the small thumbnail, fetched in one batched IPC round-trip
 *  for all visible rows that are not already cached. */
export function applyTrackCovers(container: HTMLElement): void {
  const imgs = Array.from(
    container.querySelectorAll<HTMLImageElement>(".track-item-cover[data-track-id]"),
  );
  if (imgs.length === 0) return;

  const cache = coverUrlCache.get("thumb")!;
  const need: Array<{ img: HTMLImageElement; id: string }> = [];
  for (const img of imgs) {
    const id = img.dataset.trackId;
    if (!id) continue;
    const cached = cache.get(id);
    if (cached) {
      img.src = cached;
    } else {
      need.push({ img, id });
    }
  }
  if (need.length === 0) return;

  // Dedupe ids (several rows can share an album cover).
  const uniqueIds = Array.from(new Set(need.map((n) => n.id)));

  scheduleCoverTask(async () => {
    let items;
    try {
      items = await api.library.getAlbumArtBatch(uniqueIds);
    } catch {
      for (const n of need) {
        cache.set(n.id, COVER_PLACEHOLDER);
        n.img.src = COVER_PLACEHOLDER;
      }
      return;
    }
    const byId = new Map(items.map((i) => [i.id, i.art]));
    for (const n of need) {
      const art = byId.get(n.id);
      if (!art?.data?.length) {
        cache.set(n.id, COVER_PLACEHOLDER);
        n.img.src = COVER_PLACEHOLDER;
        continue;
      }
      const blob = new Blob([Uint8Array.from(art.data)], { type: art.mimeType });
      const url = URL.createObjectURL(blob);
      cache.set(n.id, url);
      n.img.src = url;
    }
  });
}

/** Player / now-playing uses the full image. A slower fetch for an older
 *  track must not replace the cover after the track has already changed. */
export function setCoverImage(img: HTMLImageElement | null, trackId: string | null): void {
  if (!img) return;
  const token = trackId ?? "";
  img.dataset.coverTrack = token;
  if (!trackId) {
    img.src = COVER_PLACEHOLDER;
    return;
  }
  void getTrackCoverUrl(trackId, "full").then((url) => {
    if (img.dataset.coverTrack !== token) return;
    img.src = url;
  });
}

export async function fillCoverCollage(
  container: HTMLElement,
  trackIds: string[],
  variant: CoverVariant = "full",
): Promise<void> {
  container.replaceChildren();
  const ids = trackIds.slice(0, 4);
  if (ids.length === 0) return;

  const urls = await Promise.all(ids.map((id) => getTrackCoverUrl(id, variant)));
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
    void getTrackCoverUrl(trackIds[0], "thumb").then((url) => {
      img.src = url;
    });
    return;
  }

  if (img) img.style.display = "none";
  const collage = document.createElement("div");
  collage.className = "card-collage";
  wrapper.appendChild(collage);
  await fillCoverCollage(collage, trackIds, "thumb");
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

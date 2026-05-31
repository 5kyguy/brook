import * as api from "../api";

export const COVER_PLACEHOLDER = "./assets/appicon.png";

const coverUrlCache = new Map<string, string>();

export async function getTrackCoverUrl(trackId: string): Promise<string> {
  const cached = coverUrlCache.get(trackId);
  if (cached) return cached;

  if (!api.isTauri()) {
    return COVER_PLACEHOLDER;
  }

  try {
    const art = await api.library.getAlbumArt(trackId);
    if (!art?.data?.length) {
      coverUrlCache.set(trackId, COVER_PLACEHOLDER);
      return COVER_PLACEHOLDER;
    }
    const blob = new Blob([Uint8Array.from(art.data)], { type: art.mimeType });
    const url = URL.createObjectURL(blob);
    coverUrlCache.set(trackId, url);
    return url;
  } catch {
    coverUrlCache.set(trackId, COVER_PLACEHOLDER);
    return COVER_PLACEHOLDER;
  }
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

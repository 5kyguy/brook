const LAST_TRACK_ID_KEY = "brook-last-track-id";

export function saveLastTrackId(trackId: string): void {
  try {
    localStorage.setItem(LAST_TRACK_ID_KEY, trackId);
  } catch {
    /* ignore quota / private mode */
  }
}

export function getLastTrackId(): string | null {
  try {
    return localStorage.getItem(LAST_TRACK_ID_KEY);
  } catch {
    return null;
  }
}

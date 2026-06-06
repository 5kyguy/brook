import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  FavoritesChangedPayload,
  PlaybackEndedPayload,
  PlaybackPositionPayload,
  PlaybackSpectrumPayload,
  PlaybackStatePayload,
  PlaylistsChangedPayload,
  ScanCompletePayload,
  ScanProgressPayload,
  Track,
} from "../types";
import { isTauri } from "./client";

export async function onScanProgress(
  handler: (payload: ScanProgressPayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<ScanProgressPayload>("library:scan-progress", (event) => {
    handler(event.payload);
  });
}

export async function onScanComplete(
  handler: (payload: ScanCompletePayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<ScanCompletePayload>("library:scan-complete", (event) => {
    handler(event.payload);
  });
}

export function onceScanComplete(): Promise<ScanCompletePayload> {
  return new Promise((resolve) => {
    void (async () => {
      const unlisten = await onScanComplete((payload) => {
        void unlisten();
        resolve(payload);
      });
    })();
  });
}

export async function onPlaybackState(
  handler: (payload: PlaybackStatePayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<PlaybackStatePayload>("playback:state", (event) => {
    handler(event.payload);
  });
}

export async function onPlaybackPosition(
  handler: (payload: PlaybackPositionPayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<PlaybackPositionPayload>("playback:position", (event) => {
    handler(event.payload);
  });
}

export async function onPlaybackTrackChanged(
  handler: (track: Track) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<Track>("playback:track-changed", (event) => {
    handler(event.payload);
  });
}

export async function onPlaybackEnded(
  handler: (payload: PlaybackEndedPayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<PlaybackEndedPayload>("playback:ended", (event) => {
    handler(event.payload);
  });
}

export async function onPlaybackSpectrum(
  handler: (payload: PlaybackSpectrumPayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<PlaybackSpectrumPayload>("playback:spectrum", (event) => {
    handler(event.payload);
  });
}

export async function onFavoritesChanged(
  handler: (payload: FavoritesChangedPayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<FavoritesChangedPayload>("db:favorites-changed", (event) => {
    handler(event.payload);
  });
}

export async function onPlaylistsChanged(
  handler: (payload: PlaylistsChangedPayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<PlaylistsChangedPayload>("db:playlists-changed", (event) => {
    handler(event.payload);
  });
}

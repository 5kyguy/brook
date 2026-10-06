import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  FavoritesChangedPayload,
  PlaybackAdvancedPayload,
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

/** Fired on a gapless advance: the engine swapped to a preloaded track without
 * a second `play_track`. The frontend advances its queue to match. */
export async function onPlaybackAdvanced(
  handler: (payload: PlaybackAdvancedPayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<PlaybackAdvancedPayload>("playback:advanced", (event) => {
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

/** MPRIS Next: a desktop media key / playerctl asked for the next track. */
export async function onMprisNext(handler: () => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<null>("mpris:next", () => {
    handler();
  });
}

/** MPRIS Previous: a desktop media key / playerctl asked for the previous track. */
export async function onMprisPrevious(handler: () => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<null>("mpris:previous", () => {
    handler();
  });
}

/** MPRIS Shuffle: the desktop asked to toggle shuffle. */
export async function onMprisShuffle(handler: (shuffle: boolean) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<boolean>("mpris:shuffle", (event) => {
    handler(event.payload);
  });
}

/** MPRIS Loop: the desktop asked to change repeat mode ("off"|"all"|"one"). */
export async function onMprisLoop(handler: (repeat: string) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<string>("mpris:loop", (event) => {
    handler(event.payload);
  });
}

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  PlaybackEndedPayload,
  PlaybackPositionPayload,
  PlaybackStatePayload,
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

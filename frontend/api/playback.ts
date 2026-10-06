import { invoke } from "@tauri-apps/api/core";

import type { PlaybackState, QueueSnapshot, ResumeState } from "../types";
import { requireTauri } from "./client";

export async function getPlaybackState(): Promise<PlaybackState> {
  requireTauri();
  return invoke<PlaybackState>("get_playback_state");
}

export async function playTrack(id: string): Promise<void> {
  requireTauri();
  return invoke<void>("play_track", { id });
}

export async function pause(): Promise<void> {
  requireTauri();
  return invoke<void>("pause");
}

export async function resume(): Promise<void> {
  requireTauri();
  return invoke<void>("resume");
}

export async function seek(positionSecs: number): Promise<void> {
  requireTauri();
  return invoke<void>("seek", { positionSecs });
}

export async function setVolume(volume: number): Promise<void> {
  requireTauri();
  return invoke<void>("set_volume", { volume });
}

export async function setVisualizerActive(active: boolean): Promise<void> {
  requireTauri();
  return invoke<void>("set_visualizer_active", { active });
}

/** Start the queued track when the engine is stopped. */
export async function playCurrent(): Promise<void> {
  requireTauri();
  return invoke<void>("play_current");
}

export async function getQueue(): Promise<QueueSnapshot> {
  requireTauri();
  return invoke<QueueSnapshot>("get_queue");
}

export async function playQueue(ids: string[], currentId: string): Promise<QueueSnapshot> {
  requireTauri();
  return invoke<QueueSnapshot>("play_queue", { ids, currentId });
}

export async function queueInsertNext(id: string): Promise<QueueSnapshot> {
  requireTauri();
  return invoke<QueueSnapshot>("queue_insert_next", { id });
}

export async function queueAppend(id: string): Promise<QueueSnapshot> {
  requireTauri();
  return invoke<QueueSnapshot>("queue_append", { id });
}

export async function queueRemove(id: string): Promise<QueueSnapshot> {
  requireTauri();
  return invoke<QueueSnapshot>("queue_remove", { id });
}

export async function queueReorder(fromIndex: number, toIndex: number): Promise<QueueSnapshot> {
  requireTauri();
  return invoke<QueueSnapshot>("queue_reorder", { fromIndex, toIndex });
}

export async function queueJump(id: string): Promise<QueueSnapshot> {
  requireTauri();
  return invoke<QueueSnapshot>("queue_jump", { id });
}

export async function queueClear(): Promise<QueueSnapshot> {
  requireTauri();
  return invoke<QueueSnapshot>("queue_clear");
}

export async function queueToggleShuffle(): Promise<QueueSnapshot> {
  requireTauri();
  return invoke<QueueSnapshot>("queue_toggle_shuffle");
}

export async function queueCycleRepeat(): Promise<QueueSnapshot> {
  requireTauri();
  return invoke<QueueSnapshot>("queue_cycle_repeat");
}

export async function queueNext(): Promise<QueueSnapshot> {
  requireTauri();
  return invoke<QueueSnapshot>("queue_next");
}

export async function queuePrevious(): Promise<QueueSnapshot> {
  requireTauri();
  return invoke<QueueSnapshot>("queue_previous");
}

/** Tell the engine which track is next in the queue so it can preload it.
 * Pass `null` to drop the preload (end of queue). */
export async function setUpcomingTrack(id: string | null): Promise<void> {
  requireTauri();
  return invoke<void>("set_upcoming_track", { id });
}

/** Stop playback without advancing the queue (MPRIS Stop). */
export async function stop(): Promise<void> {
  requireTauri();
  return invoke<void>("stop");
}

export async function getResumeState(): Promise<ResumeState | null> {
  requireTauri();
  return invoke<ResumeState | null>("get_resume_state");
}

export async function saveResumeState(
  trackId: string | null,
  positionSecs: number,
): Promise<void> {
  requireTauri();
  return invoke<void>("save_resume_state", { trackId, positionSecs });
}

/** Open a track paused at a position (resume-on-launch). Does not play. */
export async function loadTrackPaused(id: string, positionSecs: number): Promise<void> {
  requireTauri();
  return invoke<void>("load_track_paused", { id, positionSecs });
}

/** Push shuffle/loop state to the MPRIS player (Linux only). */
export async function setMprisControls(shuffle: boolean, repeat: string): Promise<void> {
  requireTauri();
  return invoke<void>("set_mpris_controls", { shuffle, repeat });
}

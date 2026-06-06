import { invoke } from "@tauri-apps/api/core";

import type { PlaybackState } from "../types";
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

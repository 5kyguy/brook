import { invoke } from "@tauri-apps/api/core";

import type { ScanResult, Track, TrackFilter } from "../types";
import { requireTauri } from "./client";

export async function getMusicRoot(): Promise<string> {
  requireTauri();
  return invoke<string>("get_music_root");
}

export async function pickMusicFolder(): Promise<string | null> {
  requireTauri();
  return invoke<string | null>("pick_music_folder");
}

export async function setMusicRoot(path: string): Promise<string> {
  requireTauri();
  return invoke<string>("set_music_root", { path });
}

export async function resetMusicRoot(): Promise<string> {
  requireTauri();
  return invoke<string>("reset_music_root");
}

export async function scanLibrary(): Promise<ScanResult> {
  requireTauri();
  return invoke<ScanResult>("scan_library");
}

export async function getTracks(filter?: TrackFilter): Promise<Track[]> {
  requireTauri();
  return invoke<Track[]>("get_tracks", { filter: filter ?? null });
}

export async function getTrack(id: string): Promise<Track> {
  requireTauri();
  return invoke<Track>("get_track", { id });
}

export async function getFavorites(): Promise<Track[]> {
  requireTauri();
  return invoke<Track[]>("get_favorites");
}

export async function toggleFavorite(trackId: string): Promise<boolean> {
  requireTauri();
  return invoke<boolean>("toggle_favorite", { trackId });
}

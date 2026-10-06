import { invoke } from "@tauri-apps/api/core";

import type { LibraryFacets, Track, TrackFilter, TracksPage } from "../types";
import { requireTauri } from "./client";
import { onceScanComplete } from "./events";

export interface AlbumArtPayload {
  data: number[];
  mimeType: string;
}

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

export async function startLibraryScan(): Promise<void> {
  requireTauri();
  await invoke("start_library_scan");
}

export async function getLibraryFacets(): Promise<LibraryFacets> {
  requireTauri();
  return invoke<LibraryFacets>("get_library_facets");
}

/** Resolves when the current or next background scan finishes. */
export async function waitForLibraryScanComplete(): Promise<void> {
  requireTauri();
  await onceScanComplete();
}

export async function getTracks(filter?: TrackFilter): Promise<Track[]> {
  requireTauri();
  return invoke<Track[]>("get_tracks", { filter: filter ?? null });
}

/** Fetch one page of tracks plus the total count for the same filter. */
export async function getTracksPage(filter?: TrackFilter): Promise<TracksPage> {
  requireTauri();
  return invoke<TracksPage>("get_tracks_page", { filter: filter ?? null });
}

/** Count of tracks matching `filter` (ignores `limit`/`offset`). */
export async function getTracksCount(filter?: TrackFilter): Promise<number> {
  requireTauri();
  return invoke<number>("get_tracks_count", { filter: filter ?? null });
}

export async function getTrack(id: string): Promise<Track> {
  requireTauri();
  return invoke<Track>("get_track", { id });
}

export async function getAlbumArt(id: string): Promise<AlbumArtPayload | null> {
  requireTauri();
  return invoke<AlbumArtPayload | null>("get_album_art", { id });
}

/** Small (96px) list thumbnail. Cheaper over IPC than the full cover. */
export async function getAlbumArtThumb(id: string): Promise<AlbumArtPayload | null> {
  requireTauri();
  return invoke<AlbumArtPayload | null>("get_album_art_thumb", { id });
}

export interface AlbumArtBatchItem {
  id: string;
  art: AlbumArtPayload | null;
}

/** Resolve list thumbnails for many ids in one IPC round-trip. */
export async function getAlbumArtBatch(ids: string[]): Promise<AlbumArtBatchItem[]> {
  requireTauri();
  return invoke<AlbumArtBatchItem[]>("get_album_art_batch", { ids });
}

export async function getFavorites(): Promise<Track[]> {
  requireTauri();
  return invoke<Track[]>("get_favorites");
}

export async function toggleFavorite(trackId: string): Promise<boolean> {
  requireTauri();
  return invoke<boolean>("toggle_favorite", { trackId });
}

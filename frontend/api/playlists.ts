import { invoke } from "@tauri-apps/api/core";

import type { Playlist, Track } from "../types";
import { requireTauri } from "./client";

export async function getPlaylists(): Promise<Playlist[]> {
  requireTauri();
  return invoke<Playlist[]>("get_playlists");
}

export async function getPlaylistTracks(playlistId: string): Promise<Track[]> {
  requireTauri();
  return invoke<Track[]>("get_playlist_tracks", { playlistId });
}

export async function createPlaylist(name: string): Promise<Playlist> {
  requireTauri();
  return invoke<Playlist>("create_playlist", { name });
}

export async function updatePlaylist(id: string, name: string): Promise<Playlist> {
  requireTauri();
  return invoke<Playlist>("update_playlist", { id, name });
}

export async function deletePlaylist(id: string): Promise<void> {
  requireTauri();
  return invoke<void>("delete_playlist", { id });
}

export async function addToPlaylist(playlistId: string, trackId: string): Promise<void> {
  requireTauri();
  return invoke<void>("add_to_playlist", { playlistId, trackId });
}

export async function removeFromPlaylist(playlistId: string, trackId: string): Promise<void> {
  requireTauri();
  return invoke<void>("remove_from_playlist", { playlistId, trackId });
}

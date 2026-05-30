export type PlaybackStatus = "playing" | "paused" | "stopped";

export interface Track {
  id: string;
  relativePath: string;
  absolutePath: string;
  extension: string;
  fileSize: number;
  modifiedMs: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  durationSecs: number | null;
  hasLrc: boolean;
  isFavorite: boolean;
}

export interface TrackFilter {
  artist?: string;
  album?: string;
  year?: number;
  sortBy?: "title" | "artist" | "album" | "year" | "dateAdded";
  sortOrder?: "asc" | "desc";
}

export interface ScanResult {
  trackCount: number;
  added: number;
  updated: number;
}

export interface PlaybackState {
  status: PlaybackStatus;
  trackId: string | null;
  positionSecs: number;
  durationSecs: number;
  volume: number;
}

export interface PlaybackStatePayload {
  status: PlaybackStatus;
}

export interface PlaybackPositionPayload {
  positionSecs: number;
  durationSecs: number;
}

export interface PlaybackEndedPayload {
  trackId: string;
}

export interface ScanProgressPayload {
  current: number;
  total: number;
  path?: string;
}

export interface ScanCompletePayload {
  trackCount: number;
}

export interface Playlist {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  trackCount: number;
}

export interface LibraryFacets {
  artists: string[];
  albums: string[];
  years: number[];
}

export type RouteId = "library" | "recent" | "stats" | "settings" | "playlist";

export interface RouteDefinition {
  id: RouteId;
  path: string;
  label: string;
}

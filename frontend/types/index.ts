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
  query?: string;
  sortBy?: "title" | "artist" | "album" | "year" | "dateAdded";
  sortOrder?: "asc" | "desc";
}

export interface ScanResult {
  trackCount: number;
  added: number;
  updated: number;
  skipped: number;
  removed: number;
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

export interface PlaybackSpectrumPayload {
  bins: number[];
}

export interface ScanProgressPayload {
  current: number;
  total: number;
  path?: string;
}

export interface ScanCompletePayload {
  trackCount: number;
}

export interface FavoritesChangedPayload {
  trackId: string;
  liked: boolean;
}

export interface PlaylistsChangedPayload {
  playlistId?: string;
}

export interface Playlist {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  trackCount: number;
  kind: PlaylistKind;
}

export type PlaylistKind =
  | "user"
  | "weeklyTop"
  | "monthlyTop"
  | "quarterlyTop"
  | "yearlyTop";

export interface RankedTrack {
  track: Track;
  playCount: number;
  totalSecs: number;
}

export interface RankedArtist {
  name: string;
  playCount: number;
  totalSecs: number;
}

export interface RankedAlbum {
  name: string;
  playCount: number;
  totalSecs: number;
}

export interface RankedGenre {
  name: string;
  playCount: number;
  totalSecs: number;
}

export interface RankedYear {
  year: number;
  playCount: number;
  totalSecs: number;
}

export interface StatsSummary {
  totalPlays: number;
  totalListenSecs: number;
  uniqueTracks: number;
  fullListens: number;
  topTracks: RankedTrack[];
  topArtist: RankedArtist | null;
  topAlbum: RankedAlbum | null;
  topGenre: RankedGenre | null;
  topYear: RankedYear | null;
}

export interface YearlyWrap {
  year: number;
  totalPlays: number;
  totalListenSecs: number;
  uniqueTracks: number;
  fullListens: number;
  topTracks: RankedTrack[];
  topArtists: RankedArtist[];
  topAlbums: RankedAlbum[];
  topGenre: RankedGenre | null;
  topYear: RankedYear | null;
}

export interface LibraryFacets {
  artists: string[];
  albums: string[];
  years: number[];
  trackCount: number;
}

export type RouteId =
  | "library"
  | "recent"
  | "stats"
  | "settings"
  | "playlist"
  | "search"
  | "artist"
  | "album";

export interface RouteDefinition {
  id: RouteId;
  path: string;
  label: string;
}

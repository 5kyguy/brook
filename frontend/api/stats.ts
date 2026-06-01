import { invoke } from "@tauri-apps/api/core";

import type { StatsSummary, Track, YearlyWrap } from "../types";
import { requireTauri } from "./client";

export async function getStats(): Promise<StatsSummary> {
  requireTauri();
  return invoke<StatsSummary>("get_stats");
}

export async function getStatsYears(): Promise<number[]> {
  requireTauri();
  return invoke<number[]>("get_stats_years");
}

export async function getYearlyWrap(year: number): Promise<YearlyWrap> {
  requireTauri();
  return invoke<YearlyWrap>("get_yearly_wrap", { year });
}

export async function getRecentTracks(limit = 50): Promise<Track[]> {
  requireTauri();
  return invoke<Track[]>("get_recent_tracks", { limit });
}

export async function clearPlayHistory(): Promise<void> {
  requireTauri();
  return invoke<void>("clear_play_history");
}

export function formatListenDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs < 60) {
    return `${Math.round(secs || 0)} sec`;
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
}

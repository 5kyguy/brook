import { invoke } from "@tauri-apps/api/core";

import { requireTauri } from "./client";

export type LyricsSource = "lrc" | "embedded" | "none";

export interface LyricsResult {
  source: LyricsSource;
  text: string | null;
}

export async function readLyrics(trackId: string): Promise<LyricsResult> {
  requireTauri();
  return invoke<LyricsResult>("read_lyrics", { trackId });
}

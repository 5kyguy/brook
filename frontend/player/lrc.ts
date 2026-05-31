export interface LyricLine {
  timeMs: number;
  text: string;
}

const TIME_TAG = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const matches = [...trimmed.matchAll(TIME_TAG)];
    if (matches.length === 0) continue;

    const lyricText = trimmed.replace(TIME_TAG, "").trim();
    if (!lyricText) continue;

    for (const match of matches) {
      const minutes = Number.parseInt(match[1], 10);
      const seconds = Number.parseFloat(match[2]);
      lines.push({
        timeMs: (minutes * 60 + seconds) * 1000,
        text: lyricText,
      });
    }
  }

  lines.sort((a, b) => a.timeMs - b.timeMs);
  return lines;
}

export function parsePlainLyrics(text: string): LyricLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({ timeMs: index * 1000, text: line }));
}

export function activeLineIndex(lines: LyricLine[], positionMs: number): number {
  if (lines.length === 0) return -1;
  let active = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].timeMs <= positionMs) active = i;
    else break;
  }
  return active;
}

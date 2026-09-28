import { getSharedTheme, onSharedThemeChanged, type SharedTheme } from "../api/theme";
import {
  accentDeclarations,
  effectiveAccent,
  ExtractGate,
  MONOCHROME_DARK,
  OBSOLETE_THEME_KEYS,
  type AccentRoles,
} from "./accent";

const gate = new ExtractGate();
let shared: AccentRoles | null = null;
let sharedRevision = "monochrome";
let dynamicColor = false;
let track: AccentRoles | null = null;
let onInvalidate: (() => void) | null = null;

export function migrateObsoleteThemePrefs(): void {
  for (const key of OBSOLETE_THEME_KEYS) {
    localStorage.removeItem(key);
  }
  document.getElementById("custom-theme-style")?.remove();
  document.documentElement.removeAttribute("data-theme");
  const style = document.documentElement.style;
  for (const name of Object.keys(accentDeclarations(MONOCHROME_DARK))) {
    style.removeProperty(name);
  }
}

export function applyAccentRoles(roles: AccentRoles): void {
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(accentDeclarations(roles))) {
    style.setProperty(name, value);
  }
}

export function bindSharedThemeInvalidation(handler: () => void): void {
  onInvalidate = handler;
}

export function sharedThemeRevision(): string {
  return sharedRevision;
}

export function beginAccentExtract(trackId: string | null, dynamic: boolean): number {
  dynamicColor = dynamic;
  const id = gate.begin(trackId, dynamic, sharedRevision);
  if (!dynamic || trackId === null) {
    track = null;
    paint();
  }
  return id;
}

export function finishAccentExtract(id: number, roles: AccentRoles | null): void {
  if (!gate.matches(id)) return;
  track = roles;
  paint();
}

export function isCurrentAccentExtract(id: number): boolean {
  return gate.matches(id);
}

export async function initSharedTheme(): Promise<void> {
  migrateObsoleteThemePrefs();
  paint();
  await onSharedThemeChanged((theme) => {
    acceptShared(theme);
  });
  acceptShared(await getSharedTheme());
  acceptShared(await getSharedTheme());
}

function acceptShared(theme: SharedTheme): void {
  const available = theme.available ? theme.accent : null;
  if (theme.revision === sharedRevision && sameRoles(shared, available)) return;
  sharedRevision = theme.revision;
  shared = available;
  gate.begin(gate.current().trackId, dynamicColor, sharedRevision);
  paint();
  onInvalidate?.();
}

function paint(): void {
  applyAccentRoles(
    effectiveAccent({
      dynamicColor,
      track,
      shared,
    }).roles,
  );
}

function sameRoles(left: AccentRoles | null, right: AccentRoles | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.source === right.source &&
    left.text === right.text &&
    left.border === right.border &&
    left.control === right.control &&
    left.onControl === right.onControl &&
    left.rgb === right.rgb
  );
}

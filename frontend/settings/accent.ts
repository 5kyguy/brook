export interface AccentRoles {
  source: string;
  text: string;
  border: string;
  control: string;
  onControl: string;
  rgb: string;
}

export const OBSOLETE_THEME_KEYS = [
  "brook-theme",
  "brook-custom-theme",
  "custom_theme_css",
] as const;

const DARK_SURFACES = ["#0A0A0A", "#121212", "#1A1A1A"] as const;
const INK_DARK = "#0A0A0A";
const INK_LIGHT = "#FAFAFA";

export function deriveDarkAccent(source: string): AccentRoles {
  const normalized = normalizeHex(source);
  const channels = rgb(normalized);
  const text = readable(normalized, DARK_SURFACES, 255, 4.5);
  const border = readable(normalized, DARK_SURFACES, 255, 3);
  const darkInk = contrast(normalized, INK_DARK);
  const lightInk = contrast(normalized, INK_LIGHT);
  let ink = lightInk > darkInk ? INK_LIGHT : INK_DARK;
  let fill = normalized;
  if (contrast(fill, ink) < 4.5) {
    const towardWhite = readable(normalized, [INK_DARK], 255, 4.5);
    const towardBlack = readable(normalized, [INK_LIGHT], 0, 4.5);
    if (towardBlack.mix < towardWhite.mix) {
      fill = towardBlack.color;
      ink = INK_LIGHT;
    } else {
      fill = towardWhite.color;
      ink = INK_DARK;
    }
  }
  return {
    source: normalized,
    text: text.color,
    border: border.color,
    control: fill,
    onControl: ink,
    rgb: `${channels[0]}, ${channels[1]}, ${channels[2]}`,
  };
}

export const MONOCHROME_DARK: AccentRoles = deriveDarkAccent("#FFFFFF");

export function effectiveAccent(input: {
  dynamicColor: boolean;
  track: AccentRoles | null;
  shared: AccentRoles | null;
}): { kind: "track" | "shared" | "monochrome"; roles: AccentRoles } {
  if (input.dynamicColor && input.track) {
    return { kind: "track", roles: input.track };
  }
  if (input.shared) {
    return { kind: "shared", roles: input.shared };
  }
  return { kind: "monochrome", roles: MONOCHROME_DARK };
}

export function accentDeclarations(roles: AccentRoles): Record<string, string> {
  return {
    "--primary": roles.control,
    "--primary-foreground": roles.onControl,
    "--highlight": roles.text,
    "--highlight-rgb": roles.rgb,
    "--fs-accent-rgb": roles.rgb,
    "--ring": roles.border,
    "--brand": roles.source,
    "--active-highlight": roles.text,
    "--accent-source": roles.source,
    "--accent-text": roles.text,
    "--accent-border": roles.border,
    "--accent-control": roles.control,
    "--accent-on-control": roles.onControl,
  };
}

export class ExtractGate {
  private id = 0;
  private trackId: string | null = null;
  private dynamic = false;
  private revision = "monochrome";

  begin(trackId: string | null, dynamic: boolean, revision: string): number {
    this.id += 1;
    this.trackId = trackId;
    this.dynamic = dynamic;
    this.revision = revision;
    return this.id;
  }

  current(): { id: number; trackId: string | null; dynamic: boolean; revision: string } {
    return {
      id: this.id,
      trackId: this.trackId,
      dynamic: this.dynamic,
      revision: this.revision,
    };
  }

  matches(id: number): boolean {
    return id === this.id;
  }
}

function normalizeHex(value: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error("Expected a full #RRGGBB color");
  }
  return value.toUpperCase();
}

function rgb(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function luminance(color: string): number {
  const linear = rgb(color).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  const [high, low] = a > b ? [a, b] : [b, a];
  return (high + 0.05) / (low + 0.05);
}

function mix(source: string, target: number, step: number): string {
  const channels = rgb(source).map((channel) => {
    const mixed = channel + (target - channel) * (step / 100) + 0.5;
    return Math.max(0, Math.min(255, Math.floor(mixed)));
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function readable(
  source: string,
  surfaces: readonly string[],
  target: number,
  threshold: number,
): { color: string; mix: number } {
  for (let step = 0; step <= 100; step += 1) {
    const color = mix(source, target, step);
    const ratio = Math.min(...surfaces.map((surface) => contrast(color, surface)));
    if (ratio >= threshold) return { color, mix: step };
  }
  return { color: target === 255 ? "#FFFFFF" : "#000000", mix: 100 };
}

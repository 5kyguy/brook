import { describe, expect, test } from "bun:test";

import {
  accentDeclarations,
  deriveDarkAccent,
  effectiveAccent,
  ExtractGate,
  MONOCHROME_DARK,
  OBSOLETE_THEME_KEYS,
} from "./accent";

const fixture = (await Bun.file(
  new URL("../../docs/fixtures/contrast-v1.json", import.meta.url),
).json()) as {
  samples: Record<string, { dark: { source: string; text: string; border: string; control: string; on_control: string; rgb: string } }>;
};

describe("shared accent", () => {
  test("dark derivation matches the contract fixture", () => {
    for (const sample of Object.values(fixture.samples)) {
      const derived = deriveDarkAccent(sample.dark.source);
      expect(derived.text).toBe(sample.dark.text);
      expect(derived.border).toBe(sample.dark.border);
      expect(derived.control).toBe(sample.dark.control);
      expect(derived.onControl).toBe(sample.dark.on_control);
      expect(derived.rgb).toBe(sample.dark.rgb);
    }
  });

  test("dynamic color off ignores a track accent", () => {
    const track = deriveDarkAccent("#E11D48");
    const shared = deriveDarkAccent("#1D4ED8");
    const resolved = effectiveAccent({ dynamicColor: false, track, shared });
    expect(resolved.kind).toBe("shared");
    expect(resolved.roles).toEqual(shared);
  });

  test("dynamic color on uses a valid track accent", () => {
    const track = deriveDarkAccent("#E11D48");
    const shared = deriveDarkAccent("#1D4ED8");
    const resolved = effectiveAccent({ dynamicColor: true, track, shared });
    expect(resolved.kind).toBe("track");
    expect(resolved.roles.source).toBe("#E11D48");
  });

  test("missing artwork falls through to the shared accent, then monochrome", () => {
    const shared = deriveDarkAccent("#1D4ED8");
    expect(effectiveAccent({ dynamicColor: true, track: null, shared }).kind).toBe("shared");
    const fallback = effectiveAccent({ dynamicColor: true, track: null, shared: null });
    expect(fallback.kind).toBe("monochrome");
    expect(fallback.roles).toEqual(MONOCHROME_DARK);
    expect(fallback.roles.rgb).toBe("255, 255, 255");
  });

  test("every accent role is rewritten together", () => {
    const first = accentDeclarations(deriveDarkAccent("#1D4ED8"));
    const second = accentDeclarations(MONOCHROME_DARK);
    expect(Object.keys(first).sort()).toEqual(Object.keys(second).sort());
    expect(first["--highlight-rgb"]).toBe("29, 78, 216");
    expect(first["--fs-accent-rgb"]).toBe(first["--highlight-rgb"]);
    expect(second["--highlight-rgb"]).toBe("255, 255, 255");
    expect(second["--primary"]).toBe("#FFFFFF");
    expect(second["--accent-border"]).toBe("#FFFFFF");
    expect(second["--accent-on-control"]).toBe("#0A0A0A");
  });

  test("a late extract is ignored after the track, toggle, or revision changes", () => {
    const gate = new ExtractGate();
    const started = gate.begin("track-a", true, "rev-1");
    expect(gate.matches(started)).toBe(true);
    gate.begin("track-b", true, "rev-1");
    expect(gate.matches(started)).toBe(false);
    const next = gate.begin("track-b", false, "rev-1");
    expect(gate.matches(next)).toBe(true);
    gate.begin("track-b", false, "rev-2");
    expect(gate.matches(next)).toBe(false);
  });

  test("obsolete picker keys are the ones migration removes", () => {
    expect(OBSOLETE_THEME_KEYS).toEqual([
      "brook-theme",
      "brook-custom-theme",
      "custom_theme_css",
    ]);
  });
});

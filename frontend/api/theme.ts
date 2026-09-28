import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { AccentRoles } from "../settings/accent";
import { isTauri } from "./client";

export interface SharedTheme {
  available: boolean;
  revision: string;
  accent: AccentRoles;
}

export async function getSharedTheme(): Promise<SharedTheme> {
  if (!isTauri()) {
    return {
      available: false,
      revision: "monochrome",
      accent: {
        source: "#FFFFFF",
        text: "#FFFFFF",
        border: "#FFFFFF",
        control: "#FFFFFF",
        onControl: "#0A0A0A",
        rgb: "255, 255, 255",
      },
    };
  }
  return invoke<SharedTheme>("get_shared_theme");
}

export async function onSharedThemeChanged(
  handler: (theme: SharedTheme) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<SharedTheme>("theme:changed", (event) => {
    handler(event.payload);
  });
}

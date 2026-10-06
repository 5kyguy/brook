import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "./client";

/** Open a http(s) URL in the system browser. The webview does not navigate. */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    await invoke("plugin:opener|open_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener");
}

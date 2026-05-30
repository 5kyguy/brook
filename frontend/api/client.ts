export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function requireTauri(): void {
  if (!isTauri()) {
    throw new Error("Brook must run inside the Tauri shell (bun run tauri:dev).");
  }
}

import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "./client";

const ENABLED = import.meta.env.DEV;

function write(source: string, message: string): void {
  if (!ENABLED) return;
  console.debug(`[brook:${source}]`, message);
  if (isTauri()) {
    void invoke("dev_log_append", { source, message }).catch(() => {
      // Ignore when shell is not ready yet.
    });
  }
}

export function devLog(source: string, message: string): void {
  write(source, message);
}

export class DevTimer {
  private readonly source: string;
  private readonly label: string;
  private readonly start: number;

  constructor(source: string, label: string) {
    this.source = source;
    this.label = label;
    this.start = performance.now();
    write(source, `${label} start`);
  }

  elapsedMs(): number {
    return Math.round(performance.now() - this.start);
  }

  step(detail: string): void {
    write(this.source, `${this.label} … ${detail} (${this.elapsedMs()}ms)`);
  }

  finish(detail: string): void {
    write(
      this.source,
      `${this.label} done ${this.elapsedMs()}ms — ${detail}`,
    );
  }
}

/** Log file path hint (Rust writes the real file in dev). */
export function logStartupHint(): void {
  if (!ENABLED) return;
  devLog("boot", "frontend dev logs append to repo logs/brook.log via dev_log_append");
}

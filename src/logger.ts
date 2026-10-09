import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PnlEvent } from "./types.js";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  pnl(event: PnlEvent): void;
}

export function createLogger(opts: { verbose?: boolean; pnlPath?: string }): Logger {
  const verbose = opts.verbose ?? false;
  const pnlPath = opts.pnlPath;
  return {
    info(message) {
      if (verbose) console.log(message);
    },
    warn(message) {
      console.warn(message);
    },
    error(message) {
      console.error(message);
    },
    debug(message) {
      if (verbose) console.log(message);
    },
    pnl(event) {
      if (!pnlPath) return;
      mkdirSync(dirname(pnlPath), { recursive: true });
      appendFileSync(pnlPath, `${JSON.stringify(event)}\n`);
    },
  };
}

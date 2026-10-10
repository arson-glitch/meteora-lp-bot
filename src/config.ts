import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RiskLimits, RunMode } from "./types.js";

export interface AppConfig {
  mode: RunMode;
  walletPrivateKey?: string;
  rpcUrl: string;
  cluster: "mainnet-beta" | "devnet";
  limits: RiskLimits;
  rugFailScore: number;
  rugMinHolders: number;
  rugFailClosed: boolean;
  scanLimit: number;
  consider: number;
  horizonHours: number;
  birdeyeApiKey?: string;
  bookPath: string;
  liveBookPath: string;
  pnlPath: string;
  strategiesDir: string;
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

export function loadEnvFile(path = resolve(process.cwd(), ".env")): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mode: RunMode = env.MODE?.trim().toLowerCase() === "live" ? "live" : "paper";
  const cluster = env.SOLANA_CLUSTER?.trim() === "devnet" ? "devnet" : "mainnet-beta";
  const key = env.WALLET_PRIVATE_KEY?.trim();
  return {
    mode,
    walletPrivateKey: key ? key : undefined,
    rpcUrl: env.RPC_URL?.trim() || "https://api.mainnet-beta.solana.com",
    cluster,
    limits: {
      maxPositionUsd: num(env.MAX_POSITION_USD, 250),
      maxOpenPositions: num(env.MAX_OPEN_POSITIONS, 3),
      dailyLossCapUsd: num(env.DAILY_LOSS_CAP_USD, 100),
      minTvlUsd: num(env.MIN_TVL_USD, 5_000),
      minVolume24hUsd: num(env.MIN_VOLUME_24H_USD, 10_000),
    },
    rugFailScore: num(env.RUG_FAIL_SCORE, 60),
    rugMinHolders: num(env.RUG_MIN_HOLDERS, 100),
    rugFailClosed: bool(env.RUG_FAIL_CLOSED, true),
    scanLimit: num(env.SCAN_LIMIT, 40),
    consider: num(env.CONSIDER, 6),
    horizonHours: num(env.HORIZON_HOURS, 1),
    birdeyeApiKey: env.BIRDEYE_API_KEY?.trim() || undefined,
    bookPath: resolve(process.cwd(), "data/paper-book.json"),
    liveBookPath: resolve(process.cwd(), "data/live-book.json"),
    pnlPath: resolve(process.cwd(), "logs/pnl.jsonl"),
    strategiesDir: resolve(process.cwd(), "strategies"),
  };
}

import { existsSync, readFileSync } from "node:fs";
import type { CoinType } from "../types.js";
import type { TrackedPool } from "./pools.js";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const COIN_TYPES = new Set<CoinType>([
  "stable",
  "bluechip",
  "fresh-memecoin",
  "high-vol-trending",
  "established-midcap",
  "older-memecoin",
]);

export function isPoolAddress(value: string): boolean {
  return ADDRESS.test(value);
}

/** Comma/whitespace list, JSON array, pools file, or an H12 trial book. Closed slots are skipped. */
export function addressesFromText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return addressesFromJson(JSON.parse(trimmed) as unknown);
  return unique(trimmed.split(/[\s,]+/).map((part) => part.trim()).filter(isPoolAddress));
}

/**
 * A path is read from disk. Anything else is parsed as an address list.
 * Missing files throw so the caller can keep the previous subscription set.
 */
export function loadWsAddresses(spec: string): string[] {
  const trimmed = spec.trim();
  if (!trimmed) return [];
  if (existsSync(trimmed) || trimmed.includes("/") || trimmed.endsWith(".json") || trimmed.endsWith(".txt")) {
    return addressesFromText(readFileSync(trimmed, "utf8"));
  }
  return addressesFromText(trimmed);
}

/** Token metadata from an H12 book, when the file has it. Plain address lists return nothing. */
export function loadWsTracked(spec: string): TrackedPool[] {
  const trimmed = spec.trim();
  if (!trimmed) return [];
  if (!existsSync(trimmed) && !trimmed.endsWith(".json") && !trimmed.includes("/")) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(trimmed, "utf8")) as unknown;
  } catch {
    return [];
  }
  return trackedFromJson(parsed);
}

export function addressesFromJson(value: unknown): string[] {
  if (Array.isArray(value)) {
    return unique(value.filter((item): item is string => typeof item === "string" && isPoolAddress(item)));
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.addresses)) return addressesFromJson(record.addresses);
  if (Array.isArray(record.pools)) {
    return unique(record.pools.map(addressOf).filter(isPoolAddress));
  }
  if (Array.isArray(record.slots)) {
    return unique(record.slots.filter(isOpenSlot).map((slot) => addressOf((slot as { position?: unknown }).position)).filter(isPoolAddress));
  }
  if (Array.isArray(record.positions)) {
    return unique(record.positions.filter(isOpenPosition).map(addressOf).filter(isPoolAddress));
  }
  return [];
}

function trackedFromJson(value: unknown): TrackedPool[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.slots)) return [];
  const pools: TrackedPool[] = [];
  for (const slot of record.slots) {
    if (!isOpenSlot(slot)) continue;
    const row = slot as { coinType?: unknown; entryTvlUsd?: unknown; position?: Record<string, unknown> };
    const position = row.position;
    if (!position) continue;
    const address = addressOf(position);
    if (!isPoolAddress(address)) continue;
    const tokenX = tokenOf(position.tokenX);
    const tokenY = tokenOf(position.tokenY);
    const coin = typeof row.coinType === "string" && COIN_TYPES.has(row.coinType as CoinType) ? row.coinType as CoinType : "unclassified";
    pools.push({
      address,
      name: typeof position.poolName === "string" && position.poolName ? position.poolName : address.slice(0, 8),
      coinType: coin,
      binStep: numberOf(position.binStep, 1),
      mintX: tokenX.address,
      mintY: tokenY.address,
      symbolX: tokenX.symbol,
      symbolY: tokenY.symbol,
      decimalsX: tokenX.decimals,
      decimalsY: tokenY.decimals,
      priceUsdX: tokenX.priceUsd,
      priceUsdY: tokenY.priceUsd,
      tvlUsd: numberOf(row.entryTvlUsd, 0),
      baseFeePct: null,
      dynamicFeePct: null,
      protocolFeePct: null,
      currentPrice: numberOf(position.lastPrice, 0),
      addedAtMs: Date.parse(typeof position.openedAt === "string" ? position.openedAt : "") || Date.now(),
    });
  }
  return pools;
}

function isOpenSlot(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const position = (value as { position?: unknown }).position;
  return isOpenPosition(position);
}

function isOpenPosition(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status !== "closed";
}

function addressOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const address = (value as { address?: unknown; poolAddress?: unknown }).poolAddress ?? (value as { address?: unknown }).address;
  return typeof address === "string" ? address : "";
}

function tokenOf(value: unknown): { address: string; symbol: string; decimals: number; priceUsd: number } {
  if (!value || typeof value !== "object") return { address: "", symbol: "", decimals: 0, priceUsd: 0 };
  const token = value as { address?: unknown; symbol?: unknown; decimals?: unknown; priceUsd?: unknown };
  return {
    address: typeof token.address === "string" ? token.address : "",
    symbol: typeof token.symbol === "string" ? token.symbol : "",
    decimals: numberOf(token.decimals, 0),
    priceUsd: numberOf(token.priceUsd, 0),
  };
}

function numberOf(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function unique(addresses: string[]): string[] {
  return [...new Set(addresses)];
}

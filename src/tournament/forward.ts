import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { advancePosition, openPaperPosition } from "../executor/paper.js";
import { displayPnlUsd } from "../executor/pnl.js";
import { fetchDlmmPool } from "../scanner/meteora.js";
import type { StrategyConfig } from "../strategy/schema.js";
import type { CoinType, DiscoveredPool, PaperPosition } from "../types.js";
import type { BucketAssignment } from "./discover.js";

/**
 * Forward paper book for the tournament. It is not the 3-position paper book
 * and it never calls the live executor. Every grid cell is opened on one
 * live pool per bucket so later marks can compare the same rules out of sample.
 */

export const FORWARD_POSITION_CAP = 2_000;

export interface TournamentForwardBook {
  version: 1;
  mode: "paper";
  kind: "tournament-forward";
  updatedAt: string;
  sizeUsd: number;
  pools: Array<{ coinType: CoinType; address: string; name: string }>;
  positions: PaperPosition[];
}

export function openForwardBook(params: {
  buckets: BucketAssignment[];
  strategies: StrategyConfig[];
  sizeUsd: number;
  nowMs: number;
}): TournamentForwardBook {
  const positions: PaperPosition[] = [];
  const pools: TournamentForwardBook["pools"] = [];
  for (const bucket of params.buckets) {
    const pool = bucket.pools[0];
    if (!pool) continue;
    pools.push({ coinType: bucket.type, address: pool.address, name: pool.name });
    for (const strategy of params.strategies) {
      if (positions.length >= FORWARD_POSITION_CAP) break;
      positions.push(
        openPaperPosition({
          pool,
          strategy,
          sizeUsd: params.sizeUsd,
          nowMs: params.nowMs,
        }),
      );
    }
  }
  return {
    version: 1,
    mode: "paper",
    kind: "tournament-forward",
    updatedAt: new Date(params.nowMs).toISOString(),
    sizeUsd: params.sizeUsd,
    pools,
    positions,
  };
}

export function saveForwardBook(path: string, book: TournamentForwardBook): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(book));
}

export function loadForwardBook(path: string): TournamentForwardBook {
  const raw = JSON.parse(readFileSync(path, "utf8")) as TournamentForwardBook;
  if (raw.kind !== "tournament-forward" || !Array.isArray(raw.positions)) {
    throw new Error(`${path} is not a tournament forward book`);
  }
  return raw;
}

export async function markForwardBook(path: string, nowMs: number): Promise<TournamentForwardBook> {
  const book = loadForwardBook(path);
  const open = book.positions.filter((position) => position.status === "open");
  const addresses = [...new Set(open.map((position) => position.poolAddress))];
  const pools = new Map<string, DiscoveredPool>();
  for (const address of addresses) {
    const pool = await fetchDlmmPool(address);
    if (pool) pools.set(address, pool);
  }
  book.positions = book.positions.map((position) => {
    if (position.status !== "open") return position;
    const pool = pools.get(position.poolAddress);
    if (!pool) return position;
    return advancePosition({ position, pool, nowMs }).position;
  });
  book.updatedAt = new Date(nowMs).toISOString();
  saveForwardBook(path, book);
  return book;
}

export function summarizeForward(book: TournamentForwardBook): string {
  const open = book.positions.filter((position) => position.status === "open");
  const closed = book.positions.length - open.length;
  const pnl = book.positions.reduce((sum, position) => sum + displayPnlUsd(position), 0);
  const lines = [
    `Forward paper book: ${book.positions.length} virtual positions (${open.length} open, ${closed} closed).`,
    `Pools: ${book.pools.map((pool) => `${pool.coinType} ${pool.name}`).join("; ") || "none"}.`,
    `Marked PnL across the book: $${pnl.toFixed(2)}. This book ignores the 3-position cap and does not send transactions.`,
  ];
  return lines.join("\n");
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { advancePosition, openPaperPosition } from "../executor/paper.js";
import { displayPnlUsd } from "../executor/pnl.js";
import { fetchDlmmPool } from "../scanner/meteora.js";
import type { StrategyConfig } from "../strategy/schema.js";
import type { CoinType, DiscoveredPool, PaperPosition } from "../types.js";
import { sampleKey } from "./classify.js";
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
  pools: Array<{ coinType: CoinType; address: string; name: string; sampleKey?: string }>;
  positions: PaperPosition[];
}

export interface ForwardPoolStatus {
  coinType: CoinType;
  name: string;
  address: string;
  open: number;
  closed: number;
  pnlUsd: number;
  closeReasons: string;
}

export interface ForwardStatus {
  positions: number;
  open: number;
  closed: number;
  pnlUsd: number;
  pools: ForwardPoolStatus[];
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
    pools.push({ coinType: bucket.type, address: pool.address, name: pool.name, sampleKey: sampleKey(pool) });
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

export function emptyForwardBook(nowMs: number, sizeUsd: number): TournamentForwardBook {
  return {
    version: 1,
    mode: "paper",
    kind: "tournament-forward",
    updatedAt: new Date(nowMs).toISOString(),
    sizeUsd,
    pools: [],
    positions: [],
  };
}

export function loadForwardBook(path: string): TournamentForwardBook {
  const raw = JSON.parse(readFileSync(path, "utf8")) as TournamentForwardBook;
  if (raw.kind !== "tournament-forward" || !Array.isArray(raw.positions)) {
    throw new Error(`${path} is not a tournament forward book`);
  }
  return raw;
}

/**
 * Opens the full grid on one new pool per bucket. A pool is new when neither
 * its address nor its coin key is already in the book. Stops at the position cap.
 */
export function appendForwardPools(params: {
  book: TournamentForwardBook;
  buckets: BucketAssignment[];
  strategies: StrategyConfig[];
  sizeUsd: number;
  nowMs: number;
  /** Pools used to recover coin keys for book rows written before sampleKey existed. */
  knownPools?: DiscoveredPool[];
}): { book: TournamentForwardBook; added: TournamentForwardBook["pools"] } {
  const addresses = new Set(params.book.pools.map((pool) => pool.address));
  const keys = new Set(params.book.pools.map((pool) => pool.sampleKey).filter((key): key is string => Boolean(key)));
  const known = params.knownPools ?? params.buckets.flatMap((bucket) => bucket.pools);
  for (const meta of params.book.pools) {
    if (meta.sampleKey) continue;
    const match = known.find((pool) => pool.address === meta.address);
    if (!match) continue;
    meta.sampleKey = sampleKey(match);
    keys.add(meta.sampleKey);
  }
  const added: TournamentForwardBook["pools"] = [];
  for (const bucket of params.buckets) {
    const pool = bucket.pools.find((candidate) => {
      const key = sampleKey(candidate);
      return !addresses.has(candidate.address) && !keys.has(key);
    });
    if (!pool) continue;
    if (params.book.positions.length + params.strategies.length > FORWARD_POSITION_CAP) break;
    const opened = openForwardBook({
      buckets: [{ type: bucket.type, pools: [pool] }],
      strategies: params.strategies,
      sizeUsd: params.sizeUsd,
      nowMs: params.nowMs,
    });
    params.book.positions.push(...opened.positions);
    params.book.pools.push(...opened.pools);
    added.push(...opened.pools);
    addresses.add(pool.address);
    keys.add(sampleKey(pool));
  }
  params.book.updatedAt = new Date(params.nowMs).toISOString();
  params.book.sizeUsd = params.sizeUsd;
  return { book: params.book, added };
}

export function loadForwardBookIfPresent(path: string, nowMs: number, sizeUsd: number): TournamentForwardBook {
  if (!existsSync(path)) return emptyForwardBook(nowMs, sizeUsd);
  return loadForwardBook(path);
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

export function forwardStatus(book: TournamentForwardBook): ForwardStatus {
  const byPool = new Map<string, ForwardPoolStatus>();
  for (const meta of book.pools) {
    byPool.set(meta.address, {
      coinType: meta.coinType,
      name: meta.name,
      address: meta.address,
      open: 0,
      closed: 0,
      pnlUsd: 0,
      closeReasons: "",
    });
  }
  const reasons = new Map<string, Map<string, number>>();
  for (const position of book.positions) {
    const row = byPool.get(position.poolAddress) ?? {
      coinType: "older-memecoin",
      name: position.poolName,
      address: position.poolAddress,
      open: 0,
      closed: 0,
      pnlUsd: 0,
      closeReasons: "",
    };
    byPool.set(position.poolAddress, row);
    row.pnlUsd += displayPnlUsd(position);
    if (position.status === "open") row.open += 1;
    else {
      row.closed += 1;
      const reason = position.closeReason ?? "closed";
      const counts = reasons.get(position.poolAddress) ?? new Map<string, number>();
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
      reasons.set(position.poolAddress, counts);
    }
  }
  const pools = [...byPool.values()].map((row) => {
    const counts = reasons.get(row.address);
    row.closeReasons = counts
      ? [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => `${reason} ${count}`).join(", ")
      : "";
    return row;
  });
  return {
    positions: book.positions.length,
    open: book.positions.filter((position) => position.status === "open").length,
    closed: book.positions.filter((position) => position.status === "closed").length,
    pnlUsd: pools.reduce((sum, pool) => sum + pool.pnlUsd, 0),
    pools,
  };
}

export function summarizeForward(book: TournamentForwardBook): string {
  const status = forwardStatus(book);
  const lines = [
    `Forward paper book: ${status.positions} virtual positions (${status.open} open, ${status.closed} closed).`,
    `Marked PnL versus deposit: $${status.pnlUsd.toFixed(2)}. This book ignores the 3-position cap and does not send transactions.`,
  ];
  for (const pool of status.pools) {
    lines.push(
      `${pool.coinType} ${pool.name}: ${pool.open} open, ${pool.closed} closed, PnL $${pool.pnlUsd.toFixed(2)}${pool.closeReasons ? ` (${pool.closeReasons})` : ""}.`,
    );
  }
  return lines.join("\n");
}

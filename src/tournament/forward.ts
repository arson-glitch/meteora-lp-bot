import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
    if (openPositionCount(params.book) + params.strategies.length > FORWARD_POSITION_CAP) break;
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

export function openPositionCount(book: TournamentForwardBook): number {
  return book.positions.filter((position) => position.status === "open").length;
}

export function gridArchiveDir(forwardPath: string): string {
  return join(dirname(forwardPath), "archive");
}

export interface GridClosedArchive {
  version: 1;
  kind: "grid-closed-archive";
  day: string;
  archivedAt: string;
  positions: PaperPosition[];
  pools: TournamentForwardBook["pools"];
}

/**
 * Moves closed 108-cell positions out of the active book into
 * data/archive/grid-closed-YYYY-MM-DD.json. Pool rows stay so the same coin
 * is not opened again. Reports add the files back with `gridHistory`.
 */
export function archiveClosedGridPositions(
  book: TournamentForwardBook,
  archiveDir: string,
  nowMs: number,
): { book: TournamentForwardBook; archived: number; path: string | null } {
  const closed = book.positions.filter((position) => position.status === "closed");
  if (closed.length === 0) return { book, archived: 0, path: null };
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const path = join(archiveDir, `grid-closed-${day}.json`);
  const existing = readGridArchive(path);
  const seen = new Set(existing.positions.map((position) => position.id));
  const fresh = closed.filter((position) => !seen.has(position.id));
  const closedAddresses = new Set(closed.map((position) => position.poolAddress));
  const file: GridClosedArchive = {
    version: 1,
    kind: "grid-closed-archive",
    day,
    archivedAt: new Date(nowMs).toISOString(),
    positions: [...existing.positions, ...fresh],
    pools: mergePools(existing.pools, book.pools.filter((pool) => closedAddresses.has(pool.address))),
  };
  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(path, JSON.stringify(file));
  book.positions = book.positions.filter((position) => position.status !== "closed");
  book.updatedAt = new Date(nowMs).toISOString();
  return { book, archived: fresh.length, path };
}

export function loadArchivedGridPositions(archiveDir: string): { positions: PaperPosition[]; pools: TournamentForwardBook["pools"] } {
  if (!existsSync(archiveDir)) return { positions: [], pools: [] };
  const names = readdirSync(archiveDir).filter((name) => /^grid-closed-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
  const byId = new Map<string, PaperPosition>();
  let pools: TournamentForwardBook["pools"] = [];
  for (const name of names) {
    const file = readGridArchive(join(archiveDir, name));
    for (const position of file.positions) byId.set(position.id, position);
    pools = mergePools(pools, file.pools);
  }
  return { positions: [...byId.values()], pools };
}

/** Active book plus every closed archive. Active rows win when an id is in both. */
export function gridHistory(book: TournamentForwardBook, archiveDir: string): TournamentForwardBook {
  const archived = loadArchivedGridPositions(archiveDir);
  const activeIds = new Set(book.positions.map((position) => position.id));
  return {
    ...book,
    pools: mergePools(archived.pools, book.pools),
    positions: [...archived.positions.filter((position) => !activeIds.has(position.id)), ...book.positions],
  };
}

function readGridArchive(path: string): GridClosedArchive {
  if (!existsSync(path)) return { version: 1, kind: "grid-closed-archive", day: "", archivedAt: "", positions: [], pools: [] };
  const raw = JSON.parse(readFileSync(path, "utf8")) as GridClosedArchive;
  if (raw.kind !== "grid-closed-archive" || !Array.isArray(raw.positions)) {
    throw new Error(`${path} is not a grid closed archive`);
  }
  return {
    version: 1,
    kind: "grid-closed-archive",
    day: raw.day ?? "",
    archivedAt: raw.archivedAt ?? "",
    positions: raw.positions,
    pools: Array.isArray(raw.pools) ? raw.pools : [],
  };
}

function mergePools(
  base: TournamentForwardBook["pools"],
  extra: TournamentForwardBook["pools"],
): TournamentForwardBook["pools"] {
  const byAddress = new Map(base.map((pool) => [pool.address, pool]));
  for (const pool of extra) byAddress.set(pool.address, pool);
  return [...byAddress.values()];
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

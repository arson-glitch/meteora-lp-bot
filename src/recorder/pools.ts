import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CoinType, DiscoveredPool } from "../types.js";
import { fetchDlmmPools } from "../scanner/meteora.js";
import { discoverTournamentPools, selectTournamentBuckets, TARGET_COINS_PER_BUCKET } from "../tournament/discover.js";

export interface TrackedPool {
  address: string;
  name: string;
  coinType: CoinType | "unclassified";
  binStep: number;
  mintX: string;
  mintY: string;
  symbolX: string;
  symbolY: string;
  decimalsX: number;
  decimalsY: number;
  priceUsdX: number;
  priceUsdY: number;
  tvlUsd: number;
  baseFeePct: number | null;
  dynamicFeePct: number | null;
  protocolFeePct: number | null;
  currentPrice: number;
  addedAtMs: number;
}

export function trackedFromPool(pool: DiscoveredPool, coinType: CoinType | "unclassified", addedAtMs: number): TrackedPool | null {
  if (!pool.address || pool.binStep === null) return null;
  return {
    address: pool.address,
    name: pool.name,
    coinType,
    binStep: pool.binStep,
    mintX: pool.tokenX.address,
    mintY: pool.tokenY.address,
    symbolX: pool.tokenX.symbol,
    symbolY: pool.tokenY.symbol,
    decimalsX: pool.tokenX.decimals,
    decimalsY: pool.tokenY.decimals,
    priceUsdX: pool.tokenX.priceUsd,
    priceUsdY: pool.tokenY.priceUsd,
    tvlUsd: pool.tvlUsd,
    baseFeePct: pool.baseFeePct,
    dynamicFeePct: pool.dynamicFeePct,
    protocolFeePct: pool.protocolFeePct,
    currentPrice: pool.currentPrice,
    addedAtMs,
  };
}

export function readPoolFile(path: string): TrackedPool[] {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { pools?: TrackedPool[] };
    return Array.isArray(parsed.pools) ? parsed.pools.filter((pool) => pool.address && pool.binStep) : [];
  } catch {
    return [];
  }
}

export function writePoolFile(path: string, pools: TrackedPool[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ pools }, null, 2)}\n`);
}

/**
 * The same exclusive buckets the tournament tracks. The file is reused across
 * restarts so the tape does not jump to a new set of pools every boot.
 */
export async function loadTrackedPools(params: {
  path: string;
  refresh: boolean;
  limit: number;
  nowMs: number;
  log: (line: string) => void;
}): Promise<TrackedPool[]> {
  if (!params.refresh) {
    const existing = readPoolFile(params.path);
    if (existing.length > 0) {
      params.log(`pools loaded ${existing.length} from ${params.path}`);
      return existing.slice(0, params.limit);
    }
  }
  params.log("discovering tournament pools");
  const universe = await discoverTournamentPools(params.nowMs);
  const buckets = selectTournamentBuckets(universe, params.nowMs, TARGET_COINS_PER_BUCKET);
  const pools: TrackedPool[] = [];
  const seen = new Set<string>();
  for (const bucket of buckets) {
    for (const pool of bucket.pools) {
      if (seen.has(pool.address)) continue;
      const tracked = trackedFromPool(pool, bucket.type, params.nowMs);
      if (!tracked) continue;
      seen.add(pool.address);
      pools.push(tracked);
      if (pools.length >= params.limit) break;
    }
    if (pools.length >= params.limit) break;
  }
  writePoolFile(params.path, pools);
  params.log(`pools discovered ${pools.length} written ${params.path}`);
  return pools;
}

/** A short public-RPC smoke uses the first liquid volume leaders, not the full universe. */
export async function loadSmokePools(limit: number, nowMs: number): Promise<TrackedPool[]> {
  const rows = await fetchDlmmPools({
    page: 1,
    pageSize: 30,
    sortBy: "volume_24h:desc",
    filterBy: "is_blacklisted=false && tvl>=10000",
    listSource: "volume",
  });
  const pools: TrackedPool[] = [];
  for (const pool of rows) {
    const tracked = trackedFromPool(pool, "unclassified", nowMs);
    if (!tracked) continue;
    pools.push(tracked);
    if (pools.length >= limit) break;
  }
  return pools;
}

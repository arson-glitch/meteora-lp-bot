import { sleep } from "../http.js";
import { riskTokens } from "../markets.js";
import { fetchTokenPairs, marketFromPair, pickDexPair } from "../scanner/dexscreener.js";
import { fetchDlmmPools } from "../scanner/meteora.js";
import type { CoinType, DiscoveredPool } from "../types.js";
import { COIN_TYPES, classifyPool } from "./classify.js";

export const MAX_POOLS_PER_BUCKET = 4;
export const CANDIDATES_PER_BUCKET = 8;
const MIN_TVL_USD = 3_000;

export interface BucketAssignment {
  type: CoinType;
  pools: DiscoveredPool[];
}

/**
 * Volume leaders, newly created pools, and USDC/USDT searches, so a bucket
 * is not missing just because it is absent from the volume top page.
 * DexScreener price change is attached to the shortlist so the high-vol
 * rule can see a 24h move when the pool payload does not carry one.
 */
export async function discoverTournamentPools(nowMs: number): Promise<DiscoveredPool[]> {
  const jobs: Array<Promise<DiscoveredPool[]>> = [
    fetchDlmmPools({
      pageSize: 50,
      sortBy: "volume_24h:desc",
      filterBy: "is_blacklisted=false && tvl>=3000 && volume_24h>=1000",
      listSource: "volume",
    }),
    fetchDlmmPools({
      pageSize: 40,
      sortBy: "pool_created_at:desc",
      filterBy: "is_blacklisted=false && tvl>=1500",
      listSource: "new",
    }),
    fetchDlmmPools({
      pageSize: 15,
      sortBy: "volume_24h:desc",
      query: "USDC-USDT",
      listSource: "volume",
    }),
    fetchDlmmPools({
      pageSize: 15,
      sortBy: "volume_24h:desc",
      query: "USDT",
      listSource: "volume",
    }),
    fetchDlmmPools({
      pageSize: 10,
      sortBy: "volume_24h:desc",
      query: "SOL-USDC",
      listSource: "volume",
    }),
  ];
  const settled = await Promise.allSettled(jobs);
  const rows: DiscoveredPool[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") rows.push(...result.value);
  }
  const universe = dedupe(rows).filter(tradable);
  if (universe.length === 0) {
    throw new Error("Meteora returned no DLMM pools for the tournament. Check network access to dlmm.datapi.meteora.ag.");
  }
  const shortlist = assignBuckets(universe, nowMs, CANDIDATES_PER_BUCKET).flatMap((bucket) => bucket.pools);
  await enrichPriceChange(shortlist);
  return universe;
}

export function assignBuckets(pools: DiscoveredPool[], nowMs: number, perBucket: number): BucketAssignment[] {
  const buckets = new Map<CoinType, DiscoveredPool[]>(COIN_TYPES.map((type) => [type, []]));
  const sorted = [...pools].sort((a, b) => (b.volume["24h"] ?? 0) - (a.volume["24h"] ?? 0));
  for (const pool of sorted) {
    const type = classifyPool(pool, nowMs).type;
    const list = buckets.get(type);
    if (!list || list.length >= perBucket) continue;
    list.push(pool);
  }
  return COIN_TYPES.map((type) => ({ type, pools: buckets.get(type) ?? [] }));
}

function tradable(pool: DiscoveredPool): boolean {
  return pool.product === "dlmm" && pool.binStep !== null && pool.binStep > 0 && pool.currentPrice > 0 && pool.tvlUsd >= MIN_TVL_USD && !pool.isBlacklisted;
}

function dedupe(pools: DiscoveredPool[]): DiscoveredPool[] {
  const byAddress = new Map<string, DiscoveredPool>();
  for (const pool of pools) {
    if (!pool.address || byAddress.has(pool.address)) continue;
    byAddress.set(pool.address, pool);
  }
  return [...byAddress.values()];
}

async function enrichPriceChange(pools: DiscoveredPool[]): Promise<void> {
  const cache = new Map<string, DiscoveredPool["market"]>();
  for (const pool of pools) {
    if (pool.market.priceChangeH24Pct !== null) continue;
    const token = riskTokens(pool)[0] ?? pool.tokenX;
    if (!token.address) continue;
    const cached = cache.get(token.address);
    if (cached) {
      pool.market = cached;
      continue;
    }
    try {
      const pairs = await fetchTokenPairs(token.address);
      const other = token.address === pool.tokenX.address ? pool.tokenY.address : pool.tokenX.address;
      pool.market = marketFromPair(pickDexPair(pairs, token.address, other));
    } catch {
      // Price change stays null. High-vol can still match on volume/TVL.
    }
    cache.set(token.address, pool.market);
    await sleep(150);
  }
}

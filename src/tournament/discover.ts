import { sleep } from "../http.js";
import { riskTokens } from "../markets.js";
import { fetchTokenPairs, marketFromPair, pickDexPair } from "../scanner/dexscreener.js";
import { fetchDlmmPools } from "../scanner/meteora.js";
import type { CoinType, DiscoveredPool } from "../types.js";
import { COIN_TYPES, classifyPool, sampleKey } from "./classify.js";

/** Coins replayed per bucket. Extra pools of the same coin are added when a second bin step exists. */
export const TARGET_COINS_PER_BUCKET = 18;
export const CANDIDATE_COINS_PER_BUCKET = 24;
export const MAX_POOLS_PER_BUCKET = 40;
const MIN_TVL_USD = 1_500;

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
  const rows: DiscoveredPool[] = [];
  const volumePages = await Promise.allSettled(
    [1, 2, 3, 4, 5, 6, 7, 8].map((page) =>
      fetchDlmmPools({
        page,
        pageSize: 100,
        sortBy: "volume_24h:desc",
        filterBy: "is_blacklisted=false && tvl>=1500 && volume_24h>=500",
        listSource: "volume",
      }),
    ),
  );
  const newPages = await Promise.allSettled(
    [1, 2, 3, 4].map((page) =>
      fetchDlmmPools({
        page,
        pageSize: 100,
        sortBy: "pool_created_at:desc",
        filterBy: "is_blacklisted=false && tvl>=1500",
        listSource: "new",
      }),
    ),
  );
  const queries = await Promise.allSettled(
    ["USDC-USDT", "USDT", "SOL-USDC", "PYUSD", "EURC", "USD1", "USDS", "JUP", "cbBTC", "mSOL", "JitoSOL", "WBTC", "WETH", "BONK", "WIF", "JTO", "PYTH", "RAY"].map(
      (query) =>
        fetchDlmmPools({
          pageSize: 20,
          sortBy: "volume_24h:desc",
          query,
          listSource: "volume",
        }),
    ),
  );
  for (const result of [...volumePages, ...newPages, ...queries]) {
    if (result.status === "fulfilled") rows.push(...result.value);
  }
  const universe = dedupe(rows).filter((pool) => tradable(pool));
  if (universe.length === 0) {
    throw new Error("Meteora returned no DLMM pools for the tournament. Check network access to dlmm.datapi.meteora.ag.");
  }
  void nowMs;
  return universe;
}

/**
 * One primary pool per coin, then extra pools with a different bin step.
 * Buckets that already have 15 coins keep a single extra pool. Smaller
 * buckets keep up to two extra pools so the trial count is not stuck on a
 * handful of coins.
 */
export function selectTournamentBuckets(
  pools: DiscoveredPool[],
  nowMs: number,
  coinsPerBucket: number,
): BucketAssignment[] {
  const primary = assignBuckets(pools, nowMs, coinsPerBucket);
  return primary.map((bucket) => {
    const extraSlots = extraPoolsPerCoin(bucket.pools.length);
    if (extraSlots === 0) return bucket;
    const wanted = new Map(bucket.pools.map((pool) => [sampleKey(pool), pool.binStep]));
    const have = new Set(bucket.pools.map((pool) => pool.address));
    const added: DiscoveredPool[] = [];
    const addedPerKey = new Map<string, number>();
    const rest = [...pools].sort((a, b) => (b.volume["24h"] ?? 0) - (a.volume["24h"] ?? 0));
    for (const pool of rest) {
      if (added.length + bucket.pools.length >= MAX_POOLS_PER_BUCKET) break;
      const key = sampleKey(pool);
      const primaryStep = wanted.get(key);
      if (primaryStep === undefined || have.has(pool.address)) continue;
      if (pool.binStep === primaryStep) continue;
      const used = addedPerKey.get(key) ?? 0;
      if (used >= extraSlots) continue;
      have.add(pool.address);
      addedPerKey.set(key, used + 1);
      added.push(pool);
    }
    return { type: bucket.type, pools: [...bucket.pools, ...added] };
  });
}

export function extraPoolsPerCoin(coinCount: number): number {
  if (coinCount >= 15) return 1;
  if (coinCount >= 1) return 2;
  return 0;
}

export function assignBuckets(pools: DiscoveredPool[], nowMs: number, perBucket: number): BucketAssignment[] {
  const buckets = new Map<CoinType, DiscoveredPool[]>(COIN_TYPES.map((type) => [type, []]));
  const seen = new Set<string>();
  const sorted = [...pools].sort((a, b) => (b.volume["24h"] ?? 0) - (a.volume["24h"] ?? 0));
  for (const pool of sorted) {
    const key = sampleKey(pool);
    if (seen.has(key)) continue;
    seen.add(key);
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

export async function enrichPriceChange(pools: DiscoveredPool[]): Promise<void> {
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

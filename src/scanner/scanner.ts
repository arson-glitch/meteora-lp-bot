import { sleep } from "../http.js";
import { riskTokens } from "../markets.js";
import type { Logger } from "../logger.js";
import type { DiscoveredPool } from "../types.js";
import { fetchBirdeyePriceChange } from "./birdeye.js";
import { fetchTokenPairs, marketFromPair, pickDexPair } from "./dexscreener.js";
import { fetchDammV2Pools, fetchDlmmPools } from "./meteora.js";
import { rankPools } from "./rank.js";

export interface ScanOptions {
  scanLimit: number;
  includeDamm: boolean;
  enrichLimit: number;
  birdeyeApiKey?: string;
  nowMs: number;
  log?: Logger;
}

export async function scanPools(options: ScanOptions): Promise<DiscoveredPool[]> {
  const pageSize = Math.min(Math.max(options.scanLimit, 1), 100);
  const log = options.log;
  const [volumeResult, freshResult] = await Promise.allSettled([
    fetchDlmmPools({
      pageSize,
      sortBy: "volume_24h:desc",
      filterBy: "is_blacklisted=false && tvl>=5000 && volume_24h>=10000",
      listSource: "volume",
    }),
    fetchDlmmPools({
      pageSize: Math.min(pageSize, 30),
      sortBy: "pool_created_at:desc",
      filterBy: "is_blacklisted=false && tvl>=1500 && volume_1h>=100",
      listSource: "new",
    }),
  ]);

  const volume = settled(volumeResult, "volume list", log);
  const fresh = settled(freshResult, "new-pool list", log);
  if (volume.length === 0 && fresh.length === 0) {
    throw new Error("Meteora DLMM pool list returned no rows. Check network access to dlmm.datapi.meteora.ag.");
  }

  const merged = dedupe(volume, fresh);
  let damm: DiscoveredPool[] = [];
  if (options.includeDamm) {
    try {
      damm = await fetchDammV2Pools(Math.min(pageSize, 20));
    } catch (error) {
      log?.warn(`DAMM v2 discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const combined = [...merged, ...damm];
  const preliminary = rankPools(combined, options.nowMs);
  const enrichAddresses = new Set(
    preliminary
      .filter((pool) => pool.product === "dlmm")
      .slice(0, options.enrichLimit)
      .map((pool) => pool.address),
  );
  await enrichMarkets(
    combined.filter((pool) => enrichAddresses.has(pool.address)),
    options,
  );
  return rankPools(combined, options.nowMs);
}

function settled(result: PromiseSettledResult<DiscoveredPool[]>, label: string, log?: Logger): DiscoveredPool[] {
  if (result.status === "fulfilled") return result.value;
  log?.warn(`DLMM ${label} failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  return [];
}

function dedupe(volume: DiscoveredPool[], fresh: DiscoveredPool[]): DiscoveredPool[] {
  const byAddress = new Map<string, DiscoveredPool>();
  for (const pool of volume) byAddress.set(pool.address, pool);
  for (const pool of fresh) {
    const existing = byAddress.get(pool.address);
    if (!existing) {
      byAddress.set(pool.address, pool);
      continue;
    }
    existing.listSource = existing.listSource === "volume" ? "both" : existing.listSource;
  }
  return [...byAddress.values()];
}

async function enrichMarkets(pools: DiscoveredPool[], options: ScanOptions): Promise<void> {
  const cache = new Map<string, DiscoveredPool["market"]>();
  for (const pool of pools) {
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
    } catch (error) {
      options.log?.warn(
        `DexScreener lookup failed for ${token.symbol}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (pool.market.priceChangeH24Pct === null && options.birdeyeApiKey) {
      try {
        const change = await fetchBirdeyePriceChange(token.address, options.birdeyeApiKey);
        if (change !== null) {
          pool.market = {
            ...pool.market,
            source: "birdeye",
            priceChangeH24Pct: change,
          };
        }
      } catch (error) {
        options.log?.warn(
          `Birdeye lookup failed for ${token.symbol}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    cache.set(token.address, pool.market);
    await sleep(150);
  }
}

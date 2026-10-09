import { ageHours } from "../markets.js";
import type { DiscoveredPool } from "../types.js";

/**
 * Rank candidate pools by volume, fee yield, a volatility hump, and age.
 * Newer pools (about 30 minutes to 3 days) get an age boost so "new" listings
 * can surface next to raw volume leaders. Very fresh pools are discounted.
 */
export function rankPools(pools: DiscoveredPool[], nowMs: number): DiscoveredPool[] {
  if (pools.length === 0) return [];
  const maxVolume = Math.max(...pools.map((pool) => pool.volume["24h"] ?? 0), 1);
  return pools
    .map((pool) => {
      const volume = pool.volume["24h"] ?? 0;
      const fees = pool.fees["24h"] ?? 0;
      const feeYield = pool.tvlUsd > 0 ? fees / pool.tvlUsd : 0;
      const volumeScore = Math.log10(volume + 1) / Math.log10(maxVolume + 1);
      const feeScore = clamp(feeYield / 0.02, 0, 1);
      const volatility = volatilityInput(pool);
      const volatilityScore = Math.exp(-((volatility - 0.15) ** 2) / (2 * 0.2 ** 2));
      const ageScore = scoreAge(ageHours(pool.createdAtMs, nowMs));
      const breakdown = {
        volume: round(volumeScore * 100),
        feeYield: round(feeScore * 100),
        volatility: round(volatilityScore * 100),
        age: round(ageScore * 100),
      };
      const score = round(
        100 * (0.45 * volumeScore + 0.25 * feeScore + 0.15 * volatilityScore + 0.15 * ageScore),
      );
      return { ...pool, score, scoreBreakdown: breakdown };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.volume["24h"] ?? 0) - (a.volume["24h"] ?? 0));
}

function volatilityInput(pool: DiscoveredPool): number {
  if (pool.market.priceChangeH24Pct !== null) return Math.abs(pool.market.priceChangeH24Pct) / 100;
  const turnover = pool.tvlUsd > 0 ? (pool.volume["24h"] ?? 0) / pool.tvlUsd : 0;
  return clamp(turnover / 20, 0, 2);
}

function scoreAge(hours: number): number {
  if (!Number.isFinite(hours)) return 0.4;
  if (hours < 0.5) return 0.25;
  if (hours <= 72) return 1;
  if (hours <= 24 * 14) return 0.6;
  return 0.4;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function selectCandidates(ranked: DiscoveredPool[], count: number, riskMint: (pool: DiscoveredPool) => boolean): DiscoveredPool[] {
  const top = ranked.slice(0, count);
  if (top.some(riskMint)) return top;
  const extra = ranked.find(riskMint);
  if (!extra) return top;
  if (top.length === 0) return [extra];
  return [...top.slice(0, Math.max(0, count - 1)), extra];
}

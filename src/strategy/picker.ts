import { absPriceChangeH24Pct, ageHours, isStablePair } from "../markets.js";
import { classifyPool } from "../tournament/classify.js";
import type { DiscoveredPool } from "../types.js";
import type { EntryClause, StrategyConfig } from "./schema.js";

export interface PickResult {
  strategy: StrategyConfig | null;
  reason: string;
  considered: string[];
}

export function pickStrategy(
  pool: DiscoveredPool,
  strategies: StrategyConfig[],
  options: { nowMs: number; strategyId?: string; force?: boolean },
): PickResult {
  if (pool.product !== "dlmm" || pool.binStep === null) {
    return {
      strategy: null,
      reason: "strategy execution is DLMM-only in this build",
      considered: [],
    };
  }
  if (options.strategyId) {
    const requested = strategies.find((strategy) => strategy.id === options.strategyId);
    if (!requested) {
      return { strategy: null, reason: `unknown strategy ${options.strategyId}`, considered: [] };
    }
    if (options.force || strategyMatches(pool, requested, options.nowMs)) {
      return {
        strategy: requested,
        reason: options.force ? "forced by --force-strategy" : "matched the requested strategy",
        considered: [requested.id],
      };
    }
    return {
      strategy: null,
      reason: `${requested.id} entry rules did not match this pool`,
      considered: [requested.id],
    };
  }

  const matches = strategies.filter(
    (strategy) => !strategy.manualOnly && strategyMatches(pool, strategy, options.nowMs),
  );
  if (matches.length === 0) {
    return { strategy: null, reason: "no strategy entry rules matched", considered: [] };
  }
  matches.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return {
    strategy: matches[0] ?? null,
    reason: `matched ${matches.map((strategy) => strategy.id).join(", ")}; chose highest priority`,
    considered: matches.map((strategy) => strategy.id),
  };
}

export function strategyMatches(pool: DiscoveredPool, strategy: StrategyConfig, nowMs: number): boolean {
  if (strategy.product !== "dlmm" || pool.product !== "dlmm" || pool.binStep === null) return false;
  if (strategy.coinType && classifyPool(pool, nowMs).type !== strategy.coinType) return false;
  if (!clauseMatches(pool, strategy.requires, nowMs)) return false;
  if (strategy.when.length === 0) return true;
  return strategy.when.some((clause) => clauseMatches(pool, clause, nowMs));
}

function clauseMatches(pool: DiscoveredPool, clause: EntryClause, nowMs: number): boolean {
  const binStep = pool.binStep ?? 0;
  if (clause.minBinStep !== undefined && binStep < clause.minBinStep) return false;
  if (clause.maxBinStep !== undefined && binStep > clause.maxBinStep) return false;
  if (clause.minTvlUsd !== undefined && pool.tvlUsd < clause.minTvlUsd) return false;
  if (clause.maxTvlUsd !== undefined && pool.tvlUsd > clause.maxTvlUsd) return false;
  const volume = pool.volume["24h"] ?? 0;
  if (clause.minVolume24hUsd !== undefined && volume < clause.minVolume24hUsd) return false;
  if (clause.stablePairOnly && !isStablePair(pool)) return false;
  if (clause.excludeStablePair && isStablePair(pool)) return false;
  const change = absPriceChangeH24Pct(pool);
  if (clause.minAbsPriceChangeH24Pct !== undefined) {
    if (change === null || change < clause.minAbsPriceChangeH24Pct) return false;
  }
  if (clause.maxAbsPriceChangeH24Pct !== undefined && change !== null && change > clause.maxAbsPriceChangeH24Pct) {
    return false;
  }
  const age = ageHours(pool.createdAtMs, nowMs);
  if (clause.minAgeHours !== undefined && age < clause.minAgeHours) return false;
  if (clause.maxAgeHours !== undefined && age > clause.maxAgeHours) return false;
  return true;
}

import type { Candle } from "./candles.js";
import { quantile } from "./stats.js";
import { feeYieldPerDay, realizedSigmaDaily } from "../math/lvr.js";

/** Pre-registered walk. Two-day steps, two weeks of history, one week forward. */
export const H12_STEP_DAYS = 2;
export const H12_LOOKBACK_DAYS = 14;
export const H12_HORIZON_DAYS = 7;
export const H12_MIN_DAY_SAMPLE = 10;

export interface WalkWindow {
  entryTs: number;
  day: number;
  feature: Candle[];
  forward: Candle[];
}

export interface WalkSpec {
  stepDays: number;
  lookbackDays: number;
  horizonDays: number;
}

/**
 * Entries every `stepDays`. The feature window ends before the entry bar.
 * The forward window starts at the entry bar. Both are known only after the
 * fact for the forward side; features never include it.
 */
export function rollingWindows(candles: Candle[], candleHours: number, spec: WalkSpec = {
  stepDays: H12_STEP_DAYS,
  lookbackDays: H12_LOOKBACK_DAYS,
  horizonDays: H12_HORIZON_DAYS,
}): WalkWindow[] {
  if (!(candleHours > 0) || candles.length < 4) return [];
  const step = Math.max(1, Math.round((spec.stepDays * 24) / candleHours));
  const lookback = Math.max(2, Math.round((spec.lookbackDays * 24) / candleHours));
  const horizon = Math.max(2, Math.round((spec.horizonDays * 24) / candleHours));
  const out: WalkWindow[] = [];
  for (let index = lookback; index + horizon <= candles.length; index += step) {
    const entry = candles[index];
    if (!entry) continue;
    const feature = candles.slice(index - lookback, index);
    const forward = candles.slice(index, index + horizon);
    if (feature.length < lookback || forward.length < horizon) continue;
    if (feature.some((candle) => candle.timestamp >= entry.timestamp)) continue;
    if (forward[0]?.timestamp !== entry.timestamp) continue;
    out.push({
      entryTs: entry.timestamp,
      day: Math.floor(entry.timestamp / 86_400),
      feature,
      forward,
    });
  }
  return out;
}

export function featureIsCausal(feature: Candle[], entryTs: number): boolean {
  return feature.length >= 2 && feature.every((candle) => candle.timestamp < entryTs);
}

export interface EntryFeatures {
  sigma: number;
  feeYield: number;
  absChange: number;
  /** LP fees divided by volume. Both are inside the feature window. */
  feePerVolume: number;
}

/**
 * Fee dollars, volume, and the price path are the feature window.
 * `tvlUsd` is whatever the caller passes. The DLMM volume history has no
 * TVL field, so a scan-time TVL is not known at entry.
 */
export function entryFeatures(candles: Candle[], candleHours: number, tvlUsd: number): EntryFeatures | null {
  if (candles.length < 2) return null;
  const closes = candles.map((candle) => candle.close);
  const sigma = realizedSigmaDaily(closes, candleHours);
  if (sigma === null) return null;
  const days = (candles.length * candleHours) / 24;
  const fees = candles.reduce((sum, candle) => sum + candle.lpFeesUsd, 0);
  const volume = candles.reduce((sum, candle) => sum + candle.volumeUsd, 0);
  const first = candles[0]?.open ?? 0;
  const last = candles[candles.length - 1]?.close ?? 0;
  return {
    sigma,
    feeYield: feeYieldPerDay(fees, tvlUsd, days),
    absChange: first > 0 && last > 0 ? Math.abs(last / first - 1) : 0,
    feePerVolume: volume > 0 ? fees / volume : 0,
  };
}

export function h2Score(feeYield: number, absChange: number): number {
  return feeYield / Math.max(absChange, 0.01);
}

export interface RankRow {
  id: string;
  day: number;
  score: number;
  holdout: boolean;
}

/**
 * Top fraction of each day's train-coin scores. Holdout coins do not move
 * the cutoff. Days with fewer than `minTrain` train scores are skipped.
 */
export function passingIds(rows: RankRow[], topFraction: number, minTrain = H12_MIN_DAY_SAMPLE): Set<string> {
  const pass = new Set<string>();
  const fraction = Math.min(1, Math.max(0, topFraction));
  const byDay = new Map<number, RankRow[]>();
  for (const row of rows) {
    const list = byDay.get(row.day) ?? [];
    list.push(row);
    byDay.set(row.day, list);
  }
  for (const group of byDay.values()) {
    const train = group.filter((row) => !row.holdout);
    if (train.length < minTrain) continue;
    const sorted = train.map((row) => row.score).sort((a, b) => a - b);
    const cut = quantile(sorted, 1 - fraction);
    for (const row of group) {
      if (row.score >= cut) pass.add(row.id);
    }
  }
  return pass;
}

/** Train days at or before this day are train. Later days are test or holdout. */
export function calendarCut(days: number[]): number | null {
  const unique = [...new Set(days)].sort((a, b) => a - b);
  if (unique.length < 2) return unique[0] ?? null;
  return unique[Math.floor(0.7 * (unique.length - 1))] ?? null;
}

export function liquidityBinsFromMove(binStep: number, absChange: number): number {
  const step = binStep > 0 ? binStep : 100;
  const move = Math.max(absChange, 0.1);
  const binsOneSide = Math.log(1 + move) / Math.log(1 + step / 10_000);
  const bins = Math.round(binsOneSide * 2);
  if (!Number.isFinite(bins)) return 20;
  return Math.min(400, Math.max(20, bins));
}

export function binStepBand(step: number): string {
  if (step <= 20) return "1-20";
  if (step <= 80) return "21-80";
  if (step <= 125) return "81-125";
  return "126+";
}

export interface CoinMean {
  mean: number | null;
  coins: number;
  trials: number;
}

/** Equal weight per coin, then the mean of those coin means. */
export function coinEqualMean(rows: Array<{ key: string; net: number }>): CoinMean {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const list = groups.get(row.key) ?? [];
    list.push(row.net);
    groups.set(row.key, list);
  }
  const means: number[] = [];
  let trials = 0;
  for (const list of groups.values()) {
    trials += list.length;
    means.push(list.reduce((sum, value) => sum + value, 0) / list.length);
  }
  return {
    mean: means.length === 0 ? null : means.reduce((sum, value) => sum + value, 0) / means.length,
    coins: means.length,
    trials,
  };
}

export function trialMean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Resample coins, average each coin's trials, then average coins.
 * Overlapping entries on one coin stay inside that coin.
 */
export function clusterBootstrapCoinMean(
  groups: number[][],
  reps: number,
  seed: number,
): { mean: number; low: number; high: number } | null {
  const usable = groups.filter((group) => group.length > 0);
  if (usable.length === 0 || reps < 20) return null;
  const coinMeans = usable.map((group) => group.reduce((sum, value) => sum + value, 0) / group.length);
  const point = coinMeans.reduce((sum, value) => sum + value, 0) / coinMeans.length;
  const random = mulberry32(seed);
  const samples: number[] = [];
  for (let rep = 0; rep < reps; rep += 1) {
    let sum = 0;
    for (let i = 0; i < coinMeans.length; i += 1) {
      const pick = Math.floor(random() * coinMeans.length);
      sum += coinMeans[pick] ?? 0;
    }
    samples.push(sum / coinMeans.length);
  }
  samples.sort((a, b) => a - b);
  return {
    mean: point,
    low: quantile(samples, 0.025),
    high: quantile(samples, 0.975),
  };
}

export function withoutTopCoins(
  rows: Array<{ key: string; net: number }>,
  drop: number,
): { mean: number | null; coins: number; trials: number; dropped: string[] } {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.key, (totals.get(row.key) ?? 0) + row.net);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const dropped = ranked.slice(0, Math.max(0, drop)).map(([key]) => key);
  const ban = new Set(dropped);
  const kept = rows.filter((row) => !ban.has(row.key));
  const summary = coinEqualMean(kept);
  return { mean: summary.mean, coins: summary.coins, trials: summary.trials, dropped };
}

export function perCoinNets(rows: Array<{ key: string; net: number }>): number[] {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const list = groups.get(row.key) ?? [];
    list.push(row.net);
    groups.set(row.key, list);
  }
  return [...groups.values()].map((list) => list.reduce((sum, value) => sum + value, 0) / list.length);
}

/**
 * USD in the active bin divided by pool TVL. Snapshot amounts are raw integers.
 * Returns null when the active bin is missing or TVL is not positive.
 */
export function activeBinTvlShare(params: {
  activeBin: number;
  bins: Array<[number, string, string]>;
  decimalsX: number;
  decimalsY: number;
  priceX: number;
  priceY: number;
  tvlUsd: number;
}): number | null {
  if (!(params.tvlUsd > 0)) return null;
  const row = params.bins.find((bin) => bin[0] === params.activeBin);
  if (!row) return null;
  const x = Number(row[1]) / 10 ** params.decimalsX;
  const y = Number(row[2]) / 10 ** params.decimalsY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const usd = x * params.priceX + y * params.priceY;
  if (!(usd >= 0)) return null;
  return usd / params.tvlUsd;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

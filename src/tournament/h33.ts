import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { GECKOTERMINAL_API_BASE } from "../constants.js";
import { getJson } from "../http.js";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { advancePosition, openPaperPosition } from "../executor/paper.js";
import { displayPnlUsd } from "../executor/pnl.js";
import { assumedLiquidityBins } from "../math/activeBin.js";
import { ageHours, isQuoteToken } from "../markets.js";
import type { RugCheckOptions } from "../rugcheck/checker.js";
import { fetchTokenPairs, type DexPair } from "../scanner/dexscreener.js";
import { fetchDlmmPool } from "../scanner/meteora.js";
import type { StrategyConfig } from "../strategy/schema.js";
import type { CoinType, DiscoveredPool, PaperPosition } from "../types.js";
import { replayStrategy } from "./backtest.js";
import { fetchCandleWindow, type Candle, type CandleSeries } from "./candles.js";
import { classifyPool, sampleKey } from "./classify.js";
import { withCosts } from "./edge.js";
import {
  appendForwardPools,
  archiveClosedGridPositions,
  gridArchiveDir,
  gridHistory,
  loadForwardBookIfPresent,
  saveForwardBook,
  type TournamentForwardBook,
} from "./forward.js";
import { CANDIDATE_COINS_PER_BUCKET, discoverTournamentPools, enrichPriceChange, selectTournamentBuckets, TARGET_COINS_PER_BUCKET } from "./discover.js";
import { costOf, solPriceUsd } from "./frozenBook.js";
import { classicGridCells, gridStrategies } from "./grid.js";
import { renderH12Matched, syncH12MatchedBooks } from "./h12matched.js";
import { splitCoinKeys } from "./holdout.js";
import { entryFeatures, h2Score } from "./h12walk.js";
import {
  emptyH12Book,
  h12MarkRow,
  H12_TRIAL_FILE,
  H12_TRIAL_OPEN_CAP,
  loadH12DailySeries,
  loadH12Trial,
  markH12Book,
  rankH12Candidates,
  saveH12Book,
  strategyForWidth,
  type H12TrialBook,
  type H12TrialFile,
  type H12TrialRow,
} from "./h12trial.js";
import { quantile } from "./stats.js";
import { rugGatePools, type RugHit } from "./rugGate.js";

export const H33_MIN_AGE_HOURS = 12;
export const H33_LATE_START_HOURS = 2;
export const H33_SOL_DUMP_PCT = -5;
export const H33_FRESH_MAX_AGE_DAYS = 14;
export const H33_POOL_CAP = 24;
export const H33_READY_HOURS = 18;
export const H33_SIZE_USD = 250;
export const CLEAN_GAP_MS = 30 * 60 * 1000;
export const RECORDER_GAP_START_ISO = "2026-10-13T17:08:00.000Z";
export const RECORDER_RESTART_ISO = "2026-10-14T07:28:00.000Z";
export const FEE_CHECK_OCT17_ISO = "2026-10-17T07:32:00.000Z";
export const FEE_CHECK_OCT20_ISO = "2026-10-20T07:32:00.000Z";
export const FEE_CHECK_OCT17_MIDNIGHT_ISO = "2026-10-17T00:00:00.000Z";
export const FEE_CHECK_OCT20_MIDNIGHT_ISO = "2026-10-20T00:00:00.000Z";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const SOL_USDC_POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
const STABLE_MINTS = new Set([USDC_MINT, USDT_MINT]);

export const H33_REPRESENTATIVE = [
  "grid-curve-narrow-quote-rebalance",
  "grid-spot-narrow-quote-oor",
  "grid-spot-medium-two-stay-array",
  "grid-curve-narrow-token-stay-array",
  "grid-curve-narrow-quote-patient-array",
  "grid-curve-narrow-two-patient-array",
] as const;

export type H33Arm = "birth" | "age12" | "age12-soldump";
export type H33Window = "train70" | "full";
export type H33Cohort = "train" | "holdout";
export type H33FeeModel = "crossed-bins" | "active-bin";

/** Unknown or non-positive creation time does not pass. Age is hours since pool creation. */
export function passesAge12(createdAtMs: number, nowMs: number, minHours = H33_MIN_AGE_HOURS): boolean {
  if (!(createdAtMs > 0) || !Number.isFinite(createdAtMs)) return false;
  const age = ageHours(createdAtMs, nowMs);
  if (!Number.isFinite(age)) return false;
  return age >= minHours;
}

export function seriesStartsTooLate(candles: Candle[], createdAtMs: number, maxLateHours = H33_LATE_START_HOURS): boolean {
  if (!(createdAtMs > 0) || candles.length === 0) return true;
  const first = candles[0]?.timestamp ?? 0;
  return first > createdAtMs / 1000 + maxLateHours * 3600;
}

export function birthEntryIndex(candles: Candle[], createdAtMs: number): number | null {
  if (seriesStartsTooLate(candles, createdAtMs)) return null;
  const index = candles.findIndex((candle) => candle.timestamp >= createdAtMs / 1000);
  return index < 0 ? null : index;
}

/** First bar at or after creation + 12h. Needs two earlier bars. A late tape returns null. */
export function age12EntryIndex(candles: Candle[], createdAtMs: number, minHours = H33_MIN_AGE_HOURS): number | null {
  if (seriesStartsTooLate(candles, createdAtMs)) return null;
  const target = createdAtMs / 1000 + minHours * 3600;
  const index = candles.findIndex((candle) => candle.timestamp >= target);
  if (index < 2) return null;
  return index;
}

/** Score uses bars strictly before entryIndex. A fee on the entry bar is not included. */
export function preEntryScore(candles: Candle[], entryIndex: number, candleHours: number, tvlUsd: number): number | null {
  if (entryIndex < 2 || entryIndex >= candles.length) return null;
  const entry = candles[entryIndex];
  if (!entry) return null;
  const feature = candles.slice(0, entryIndex);
  if (feature.some((candle) => candle.timestamp >= entry.timestamp)) return null;
  const feat = entryFeatures(feature, candleHours, tvlUsd);
  if (!feat) return null;
  return h2Score(feat.feeYield, feat.absChange);
}

/** 80th percentile. Ties at the cutoff pass. Holdout scores must not be passed in. */
export function trainScoreCutoff(scores: number[], topFraction = 0.2): number | null {
  const finite = scores.filter((score) => Number.isFinite(score));
  if (finite.length < 4) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  return quantile(sorted, 1 - topFraction);
}

/** Null fails closed. A change of exactly -5 does not skip. */
export function solDumpSkips(changePct: number | null, threshold = H33_SOL_DUMP_PCT): boolean {
  if (changePct === null || !Number.isFinite(changePct)) return true;
  return changePct < threshold;
}

export function trailingReturnPct(candles: Candle[], atSec: number, lookbackSec = 86_400): number | null {
  if (candles.length < 2) return null;
  const now = lastAtOrBefore(candles, atSec);
  const then = lastAtOrBefore(candles, atSec - lookbackSec);
  if (!now || !then || then.timestamp >= now.timestamp) return null;
  if (!(then.close > 0) || !(now.close > 0)) return null;
  return (now.close / then.close - 1) * 100;
}

/** DexScreener h24 where SOL is the base and the quote is USDC or USDT. Percent points. */
export function solChangeFromPairs(pairs: DexPair[]): number | null {
  const ranked = pairs.filter((pair) => pair.baseToken?.address === SOL_MINT && STABLE_MINTS.has(pair.quoteToken?.address ?? ""));
  ranked.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const change = ranked[0]?.priceChange?.h24;
  return typeof change === "number" && Number.isFinite(change) ? change : null;
}

export function age12Strategies(): StrategyConfig[] {
  return gridStrategies().map((strategy) => ({
    ...strategy,
    id: `${strategy.id}-age12`,
    name: `${strategy.name} age12`,
    notes: "Paper variant. Skip a pool younger than 12 hours. Enter later only if the pre-entry signal still passes.",
    requires: { ...strategy.requires, minAgeHours: H33_MIN_AGE_HOURS },
  }));
}

export function h33ReplayStrategies(): { representative: StrategyConfig[]; classic: StrategyConfig[] } {
  const all = gridStrategies();
  const classicIds = new Set(classicGridCells().map((cell) => cell.id));
  const classic = all.filter((strategy) => classicIds.has(strategy.id));
  const representative = H33_REPRESENTATIVE.map((id) => {
    const found = all.find((strategy) => strategy.id === id);
    if (!found) throw new Error(`Missing grid cell ${id}`);
    return found;
  });
  return { representative, classic };
}

/**
 * Pools that were fresh memecoins one hour after creation, are at most 14 days
 * old, and already have 18 hours of age so the 12-hour delay can be scored.
 * One pool per coin. Newest first.
 */
export function selectH33Pools(universe: DiscoveredPool[], nowMs: number, cap = H33_POOL_CAP): DiscoveredPool[] {
  const eligible = universe.filter((pool) => freshAtBirth(pool, nowMs) && ageHours(pool.createdAtMs, nowMs) >= H33_READY_HOURS);
  return dedupeNewest(eligible).slice(0, cap);
}

export function countYoungFresh(universe: DiscoveredPool[], nowMs: number): number {
  return dedupeNewest(universe.filter((pool) => freshAtBirth(pool, nowMs) && ageHours(pool.createdAtMs, nowMs) < H33_MIN_AGE_HOURS)).length;
}

export function cleanSnapshotHours(takenAt: number[], maxGapMs = CLEAN_GAP_MS): {
  hours: number;
  points: number;
  cleanGaps: number;
  brokenGaps: number;
  maxBrokenHours: number;
} {
  const ms = takenAt
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => (value < 1e12 ? value * 1000 : value))
    .sort((a, b) => a - b);
  let cleanMs = 0;
  let cleanGaps = 0;
  let brokenGaps = 0;
  let maxBroken = 0;
  for (let index = 1; index < ms.length; index += 1) {
    const gap = (ms[index] ?? 0) - (ms[index - 1] ?? 0);
    if (gap > 0 && gap <= maxGapMs) {
      cleanMs += gap;
      cleanGaps += 1;
    } else if (gap > maxGapMs) {
      brokenGaps += 1;
      if (gap > maxBroken) maxBroken = gap;
    }
  }
  return {
    hours: cleanMs / 3_600_000,
    points: ms.length,
    cleanGaps,
    brokenGaps,
    maxBrokenHours: maxBroken / 3_600_000,
  };
}

export function projectedTapeHours(restartMs: number, atMs: number): number {
  if (!(atMs > restartMs)) return 0;
  return (atMs - restartMs) / 3_600_000;
}

export function recorderDelayNote(): string {
  const restart = Date.parse(RECORDER_RESTART_ISO);
  const h17 = projectedTapeHours(restart, Date.parse(FEE_CHECK_OCT17_ISO));
  const h20 = projectedTapeHours(restart, Date.parse(FEE_CHECK_OCT20_ISO));
  const m17 = projectedTapeHours(restart, Date.parse(FEE_CHECK_OCT17_MIDNIGHT_ISO));
  const m20 = projectedTapeHours(restart, Date.parse(FEE_CHECK_OCT20_MIDNIGHT_ISO));
  return `Fee-model check was aimed at 2026-10-17. Recorder gap ${RECORDER_GAP_START_ISO} to ${RECORDER_RESTART_ISO}. If the box stays up from the restart, post-gap tape is ${h17.toFixed(2)}h by 2026-10-17 07:32 UTC (${m17.toFixed(2)}h by midnight) and ${h20.toFixed(2)}h by 2026-10-20 07:32 UTC (${m20.toFixed(2)}h by midnight). Sqlite hours on this page are an earlier file and are not added.`;
}

export interface ArmStats {
  arm: H33Arm;
  feeModel: H33FeeModel;
  window: H33Window;
  cohort: H33Cohort;
  cell: string;
  entries: number;
  stops: number;
  meanNet: number | null;
  medianNet: number | null;
  meanVsHold: number | null;
  meanBars: number | null;
}

export interface PoolPlanRow {
  name: string;
  address: string;
  holdout: boolean;
  late: boolean;
  birthIndex: number | null;
  ageIndex: number | null;
  score: number | null;
  solPct: number | null;
  ageEnters: boolean;
  dumpSkips: boolean;
}

export interface H33Series {
  pool: DiscoveredPool;
  candles: Candle[];
  candleHours: number;
}

export interface H33Study {
  solPriceUsd: number;
  cutoff: number | null;
  trainScores: number;
  considered: number;
  excludedLate: number;
  noTape: number;
  scannedYoung: number;
  trainPools: number;
  holdoutPools: number;
  birthPools: number;
  agePools: number;
  dumpPools: number;
  signalSkips: number;
  notYet: number;
  plans: PoolPlanRow[];
  stats: ArmStats[];
  solCandles: number;
  solTapeNote: string;
}

interface Acc {
  nets: number[];
  holds: number[];
  bars: number[];
  stops: number;
}

export function scoreH33(params: {
  rows: H33Series[];
  solCandles: Candle[];
  solInvert: boolean;
  solPriceUsd: number;
  scannedYoung: number;
  noTape: number;
  /** Tests pass a short list. The study uses the classic grid and the representative cells. */
  replayStrategies?: StrategyConfig[];
  solTapeNote?: string;
  onProgress?: (message: string) => void;
}): H33Study {
  const log = params.onProgress ?? (() => {});
  const usable: H33Series[] = [];
  let excludedLate = 0;
  for (const row of params.rows) {
    const candles = [...row.candles].sort((a, b) => a.timestamp - b.timestamp);
    if (seriesStartsTooLate(candles, row.pool.createdAtMs)) {
      excludedLate += 1;
      continue;
    }
    usable.push({ ...row, candles });
  }
  const split = splitCoinKeys(usable.map((row) => sampleKey(row.pool)));
  const holdoutKeys = new Set(split.holdoutKeys);
  const sol = [...params.solCandles].sort((a, b) => a.timestamp - b.timestamp);
  const draft = usable.map((row) => {
    const ageIndex = age12EntryIndex(row.candles, row.pool.createdAtMs);
    const score = ageIndex === null ? null : preEntryScore(row.candles, ageIndex, row.candleHours, row.pool.tvlUsd);
    return { row, holdout: holdoutKeys.has(sampleKey(row.pool)), ageIndex, score };
  });
  const trainScores = draft.filter((item) => !item.holdout && item.score !== null).map((item) => item.score as number);
  const cutoff = trainScoreCutoff(trainScores);
  const plans: PoolPlanRow[] = [];
  const buckets = new Map<string, Acc>();
  const loadedStrategies = params.replayStrategies ?? null;
  const { representative, classic } = loadedStrategies ? { representative: [] as StrategyConfig[], classic: loadedStrategies } : h33ReplayStrategies();
  const classicIds = new Set((loadedStrategies ? classicGridCells().map((cell) => cell.id) : classic.map((strategy) => strategy.id)));
  const strategies = new Map<string, StrategyConfig>();
  for (const strategy of loadedStrategies ?? [...classic, ...representative]) strategies.set(strategy.id, strategy);
  let birthPools = 0;
  let agePools = 0;
  let dumpPools = 0;
  let signalSkips = 0;
  let notYet = 0;
  const feeModels: H33FeeModel[] = ["crossed-bins", "active-bin"];
  for (let index = 0; index < draft.length; index += 1) {
    const item = draft[index];
    if (!item) continue;
    const candles = item.row.candles;
    const birthIndex = birthEntryIndex(candles, item.row.pool.createdAtMs);
    const ageEnters = item.ageIndex !== null && item.score !== null && cutoff !== null && item.score >= cutoff;
    const entryCandle = item.ageIndex === null ? null : candles[item.ageIndex];
    const rawSol = entryCandle ? trailingReturnPct(sol, entryCandle.timestamp) : null;
    const solPct = rawSol === null ? null : params.solInvert ? invertPct(rawSol) : rawSol;
    const dumpSkips = solDumpSkips(solPct);
    if (birthIndex !== null) birthPools += 1;
    if (item.ageIndex === null) notYet += 1;
    else if (!ageEnters) signalSkips += 1;
    if (ageEnters) agePools += 1;
    if (ageEnters && !dumpSkips) dumpPools += 1;
    plans.push({
      name: item.row.pool.name,
      address: item.row.pool.address,
      holdout: item.holdout,
      late: false,
      birthIndex,
      ageIndex: item.ageIndex,
      score: item.score,
      solPct,
      ageEnters,
      dumpSkips,
    });
    const cohort: H33Cohort = item.holdout ? "holdout" : "train";
    const cut = Math.max(1, Math.floor(candles.length * 0.7));
    const arms: Array<{ arm: H33Arm; entry: number | null; also?: H33Arm }> = [
      { arm: "birth", entry: birthIndex },
      { arm: "age12", entry: ageEnters ? item.ageIndex : null, also: ageEnters && !dumpSkips ? "age12-soldump" : undefined },
    ];
    log(`H33 replay ${index + 1}/${draft.length} ${item.row.pool.name}`);
    for (const strategy of strategies.values()) {
      const cells = classicIds.has(strategy.id) ? ["classic-108", strategy.id] : [strategy.id];
      const keepCells = cells.filter((cell) => cell === "classic-108" || (H33_REPRESENTATIVE as readonly string[]).includes(cell));
      if (keepCells.length === 0) continue;
      for (const feeModel of feeModels) {
        for (const arm of arms) {
          if (arm.entry === null) continue;
          const windows: Array<{ window: H33Window; end: number }> = [];
          if (arm.entry < cut) windows.push({ window: "train70", end: cut });
          windows.push({ window: "full", end: candles.length });
          for (const window of windows) {
            const trial = play(item.row, strategy, arm.entry, window.end, feeModel, params.solPriceUsd);
            if (!trial) continue;
            const result = {
              net: trial.netPnlUsd,
              hold: trial.vsHodlUsd,
              bars: window.end - arm.entry,
              stop: trial.closeReason === "stop-loss",
            };
            for (const cell of keepCells) {
              addAcc(buckets, keyOf(arm.arm, feeModel, window.window, cohort, cell), result);
              if (arm.also) addAcc(buckets, keyOf(arm.also, feeModel, window.window, cohort, cell), result);
            }
          }
        }
      }
    }
  }
  return {
    solPriceUsd: params.solPriceUsd,
    cutoff,
    trainScores: trainScores.length,
    considered: params.rows.length,
    excludedLate,
    noTape: params.noTape,
    scannedYoung: params.scannedYoung,
    trainPools: plans.filter((plan) => !plan.holdout).length,
    holdoutPools: plans.filter((plan) => plan.holdout).length,
    birthPools,
    agePools,
    dumpPools,
    signalSkips,
    notYet,
    plans,
    stats: [...buckets.entries()].map(([key, acc]) => finishAcc(key, acc)),
    solCandles: sol.length,
    solTapeNote: params.solTapeNote ?? "",
  };
}

function play(
  row: H33Series,
  strategy: StrategyConfig,
  entryIndex: number,
  endIndex: number,
  feeModel: H33FeeModel,
  solPriceUsd: number,
) {
  const trial = replayStrategy({
    pool: row.pool,
    strategy,
    candles: row.candles,
    sizeUsd: H33_SIZE_USD,
    candleHours: row.candleHours,
    coinType: "fresh-memecoin",
    split: "train",
    feeModel,
    liquidityBins: assumedLiquidityBins(row.pool),
    path: "wick",
    solPriceUsd,
    entryIndex,
    endIndex,
  });
  if (!trial) return null;
  return withCosts(trial, row.pool, solPriceUsd, assumedLiquidityBins(row.pool));
}

export function findStat(stats: ArmStats[], query: Pick<ArmStats, "arm" | "feeModel" | "window" | "cohort" | "cell">): ArmStats | undefined {
  return stats.find((stat) => (
    stat.arm === query.arm
    && stat.feeModel === query.feeModel
    && stat.window === query.window
    && stat.cohort === query.cohort
    && stat.cell === query.cell
  ));
}

export function renderH33Study(study: H33Study): string {
  const lines: string[] = [];
  lines.push("## H33 backtest");
  lines.push("");
  lines.push("Paper and backtest only. The question is whether waiting until a fresh memecoin pool is 12 hours old, and then entering only if the fee-to-move score still passes, reduces stop-outs and improves net versus cash and versus holding. The SOL arm also skips when the trailing 24-hour SOL return at that later entry is under -5%. Promotion gates are not involved.");
  lines.push("");
  lines.push(`SOL marked at $${study.solPriceUsd.toFixed(2)} for rent and transaction fees. Deposit $${H33_SIZE_USD}. Cost model subtracts exit slippage, transaction fees, and non-refundable bin-array rent. Both fee models are scored. Active-bin is not added on top of crossed-bin.`);
  lines.push("");
  lines.push(`Pools sent in: ${study.considered}. No usable tape: ${study.noTape}. Tape starts more than ${H33_LATE_START_HOURS}h after creation, excluded: ${study.excludedLate}. Scored pools: ${study.trainPools + study.holdoutPools} (${study.trainPools} train coins, ${study.holdoutPools} holdout coins). Current fresh pools still under 12h, counted but not scored: ${study.scannedYoung}.`);
  lines.push("");
  lines.push(`Train-only scores: ${study.trainScores}. Cutoff (80th percentile of those scores): ${study.cutoff === null ? "not set, so the age filter entered nothing" : study.cutoff.toFixed(4)}. Birth entries ${study.birthPools}. Age-12 entries ${study.agePools}. Signal skips ${study.signalSkips}. Not yet 12h inside the tape ${study.notYet}. SOL-dump entries ${study.dumpPools}. SOL hourly bars ${study.solCandles}. ${study.solTapeNote}`);
  lines.push("");
  lines.push("The H12 paper book needs 14 daily bars, so this hourly study is the fresh-pool test. It is not a replay of the 14-day H12 rule. Scan-time TVL is used in the score because the candle file has no historical TVL. Bars after the entry are not in the score.");
  lines.push("");
  lines.push("### Classic 108, cost-adjusted");
  lines.push("");
  lines.push("Mean and median are across cell-pool trials. Stops per pool is the number of stop exits divided by pools in that cohort, including pools the filter skipped. A skip is not a stop. On the classic 108 that number can be more than 1 because each pool is tried on every cell.");
  lines.push("");
  lines.push(statTable(study, "classic-108"));
  lines.push("");
  for (const id of H33_REPRESENTATIVE) {
    lines.push(`### ${id}`);
    lines.push("");
    lines.push(statTable(study, id));
    lines.push("");
  }
  lines.push("### Plain reading");
  lines.push("");
  for (const line of plainReading(study)) lines.push(`- ${line}`);
  lines.push("");
  lines.push("### Pools");
  lines.push("");
  lines.push("| Pool | Cohort | Score | SOL 24h at +12h | Age enters | Dump skips |");
  lines.push("| --- | --- | ---: | ---: | --- | --- |");
  for (const plan of study.plans) {
    lines.push(`| ${plan.name} | ${plan.holdout ? "holdout" : "train"} | ${plan.score === null ? "—" : plan.score.toFixed(3)} | ${plan.solPct === null ? "—" : plan.solPct.toFixed(2)} | ${plan.ageEnters ? "yes" : "no"} | ${plan.dumpSkips ? "yes" : "no"} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function h12AgeBookPath(id: "age12" | "soldump", root = process.cwd()): string {
  return join(root, "data", id === "age12" ? "h12-age12-forward.json" : "h12-age12-soldump-forward.json");
}

export function age12GridPath(dump: boolean, root = process.cwd()): string {
  return join(root, "data", "age12", dump ? "grid-soldump-forward.json" : "grid-forward.json");
}

export interface H12AgeSync {
  id: "age12" | "soldump";
  book: H12TrialBook;
  rows: H12TrialRow[];
  added: string[];
  deferredYoung: number;
  unknownAge: number;
  skippedDump: boolean;
}

export interface GridAgeSync {
  id: "age12" | "soldump";
  added: string[];
  positions: number;
  open: number;
  closed: number;
  netPnlUsd: number;
  vsHoldUsd: number;
  skippedDump: boolean;
}

export interface H33PaperSync {
  solPct: number | null;
  solSource: string;
  h12: H12AgeSync[];
  grids: GridAgeSync[];
  rugs: RugHit[];
  scored: number;
  passed: number;
  youngPassed: number;
  note: string;
}

export async function syncH33Paper(options: {
  root?: string;
  cacheDir: string;
  universe: DiscoveredPool[];
  nowMs: number;
  solPriceUsd: number;
  rug?: RugCheckOptions;
  onProgress?: (message: string) => void;
}): Promise<H33PaperSync> {
  const log = options.onProgress ?? (() => {});
  const root = options.root ?? process.cwd();
  const trial = loadH12Trial(join(root, H12_TRIAL_FILE));
  const sol = await resolveSolDayChange();
  const dumpSkip = solDumpSkips(sol.pct);
  log(dumpSkip ? `SOL dump filter is closed (${sol.source})` : `SOL 24h ${sol.pct?.toFixed(2)}%. Dump filter does not bind.`);
  const books = (["age12", "soldump"] as const).map((id) => ({
    id,
    path: h12AgeBookPath(id, root),
    book: loadAgeBook(h12AgeBookPath(id, root), trial, id, options.nowMs, options.solPriceUsd),
  }));
  for (const row of books) {
    row.book.solPriceUsd = options.solPriceUsd;
    const open = row.book.slots.filter((slot) => slot.position.status === "open").length;
    if (open > 0) {
      log(`Marking ${open} H12 ${row.id} positions`);
      await markH12Book(row.book, options.nowMs, fetchDlmmPool);
    }
  }
  log("Scoring the H12 quintile for the age-filter books");
  const series = await loadH12DailySeries(options.universe, options.cacheDir, options.nowMs, log);
  const ranked = rankH12Candidates(series, options.nowMs, trial.rule);
  const fresh = ranked.passed.filter((row) => row.bins !== null).sort((a, b) => b.score - a.score);
  let young = 0;
  let unknown = 0;
  const oldEnough = [];
  for (const row of fresh) {
    if (!(row.pool.createdAtMs > 0)) {
      unknown += 1;
      continue;
    }
    if (!passesAge12(row.pool.createdAtMs, options.nowMs)) {
      young += 1;
      continue;
    }
    oldEnough.push(row);
  }
  const wanted = new Map<string, (typeof oldEnough)[number]>();
  for (const book of books) {
    if (book.id === "soldump" && dumpSkip) continue;
    const have = new Set(book.book.slots.map((slot) => slot.position.poolAddress));
    for (const row of oldEnough) {
      if (!have.has(row.pool.address)) wanted.set(row.pool.address, row);
    }
  }
  let allowed = new Set([...wanted.keys()]);
  let rugs: RugHit[] = [];
  const rugList = [...wanted.values()].sort((a, b) => b.score - a.score);
  if (options.rug && rugList.length > 0) {
    log(`Rug-checking ${rugList.length} H12 age-filter candidates once`);
    const gated = await rugGatePools({
      pools: rugList.map((row) => row.pool),
      coinType: "h12-age12",
      options: options.rug,
      accept: H12_TRIAL_OPEN_CAP,
    });
    allowed = new Set(gated.passed.map((pool) => pool.address));
    rugs = gated.hits;
  }
  const h12: H12AgeSync[] = [];
  for (const row of books) {
    const have = new Set(row.book.slots.map((slot) => slot.position.poolAddress));
    const added: string[] = [];
    if (!(row.id === "soldump" && dumpSkip)) {
      for (const candidate of oldEnough) {
        if (candidate.bins === null || have.has(candidate.pool.address) || !allowed.has(candidate.pool.address)) continue;
        if (added.length >= H12_TRIAL_OPEN_CAP) break;
        row.book.slots.push({
          position: openAge(trial, candidate.pool, candidate.bins, options.nowMs),
          coinType: classifyPool(candidate.pool, options.nowMs).type,
          binsEachSide: candidate.bins,
          entryScore: candidate.score,
          entrySigma: candidate.sigma,
          entryFeeYield: candidate.feeYield,
          entryTvlUsd: candidate.pool.tvlUsd,
          crossedBinFeesUsd: 0,
          activeBinFeesUsd: 0,
        });
        added.push(candidate.pool.name);
      }
    }
    row.book.updatedAt = new Date(options.nowMs).toISOString();
    row.book.sizeUsd = trial.rule.sizeUsd;
    row.book.kind = "h12-age12";
    saveH12Book(row.path, row.book);
    const poolMap = new Map(options.universe.map((pool) => [pool.address, pool]));
    h12.push({
      id: row.id,
      book: row.book,
      rows: row.book.slots.map((slot) => h12MarkRow(slot, poolMap.get(slot.position.poolAddress) ?? null, row.book.solPriceUsd)),
      added,
      deferredYoung: young,
      unknownAge: unknown,
      skippedDump: row.id === "soldump" && dumpSkip,
    });
  }
  const grids = await syncAgeGrids({
    root,
    universe: options.universe,
    nowMs: options.nowMs,
    solPriceUsd: options.solPriceUsd,
    rug: options.rug,
    dumpSkip,
    onProgress: log,
  });
  rugs.push(...grids.rugs);
  const note = young === 0 && unknown === 0
    ? "The 12-hour gate did not remove any H12 quintile name. H12 already requires 14 daily bars, so a pool that passes is older than 12 hours."
    : `H12 quintile names under 12 hours: ${young}. Unknown creation time: ${unknown}. Those stay closed until a later mark where they are at least 12 hours old and still pass the pre-entry quintile.`;
  return {
    solPct: sol.pct,
    solSource: sol.source,
    h12,
    grids: grids.books,
    rugs,
    scored: ranked.candidates.length,
    passed: ranked.passed.length,
    youngPassed: young,
    note,
  };
}

export function renderH33Paper(result: H33PaperSync): string {
  const lines: string[] = [];
  lines.push("## H33 age-filter books");
  lines.push("");
  lines.push("Separate paper books. They do not replace the H12 trial, the take-profit books, or the 108-cell grid. A pool younger than 12 hours is not opened. After 12 hours it is opened only if it still passes the same pre-entry rule. The SOL-dump book also opens nothing on a run where SOL's 24-hour change is under -5%, or when that change is missing.");
  lines.push("");
  lines.push(`SOL 24h change: ${result.solPct === null ? "missing" : `${result.solPct.toFixed(2)}%`}. ${result.solSource}`);
  lines.push("");
  lines.push(result.note);
  lines.push("");
  lines.push(`H12 scores ${result.scored}. Passed with a usable width ${result.passed}. Under 12 hours among those ${result.youngPassed}.`);
  lines.push("");
  lines.push("| Book | Hash | Positions | Open | Closed | Net | Vs hold | Opened now |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of result.h12) {
    const net = row.rows.reduce((sum, item) => sum + item.netPnlUsd, 0);
    const hold = row.rows.reduce((sum, item) => sum + item.vsHoldUsd, 0);
    const open = row.rows.filter((item) => item.status === "open").length;
    const opened = row.skippedDump ? "skipped, SOL filter" : row.added.length ? row.added.join(", ") : "none";
    lines.push(`| \`h12-${row.id}\` | \`${row.book.parameterHash.slice(0, 12)}\` | ${row.rows.length} | ${open} | ${row.rows.length - open} | $${net.toFixed(2)} | $${hold.toFixed(2)} | ${opened} |`);
  }
  lines.push("");
  lines.push("| Grid book | Positions | Open | Closed | Net | Vs hold | Opened now |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of result.grids) {
    const opened = row.skippedDump ? "skipped, SOL filter" : row.added.length ? row.added.join(", ") : "none";
    lines.push(`| \`grid-${row.id}\` | ${row.positions} | ${row.open} | ${row.closed} | $${row.netPnlUsd.toFixed(2)} | $${row.vsHoldUsd.toFixed(2)} | ${opened} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function loadH33Series(options: {
  universe: DiscoveredPool[];
  cacheDir: string;
  nowMs: number;
  solPriceUsd: number;
  onProgress?: (message: string) => void;
}): Promise<{ study: H33Study; solInvert: boolean }> {
  const log = options.onProgress ?? (() => {});
  const selected = selectH33Pools(options.universe, options.nowMs);
  const young = countYoungFresh(options.universe, options.nowMs);
  log(`H33 fresh pools with at least ${H33_READY_HOURS}h of age: ${selected.length}. Still under 12h: ${young}.`);
  mkdirSync(options.cacheDir, { recursive: true });
  const rows: H33Series[] = [];
  let noTape = 0;
  for (const pool of selected) {
    const candles = await loadHourly(pool, options.cacheDir, options.nowMs, log);
    if (candles.length < 2) {
      noTape += 1;
      continue;
    }
    rows.push({ pool, candles, candleHours: 1 });
  }
  const solPool = await fetchDlmmPool(SOL_USDC_POOL);
  const solInvert = solPool ? solPool.tokenY.address === SOL_MINT && solPool.tokenX.address !== SOL_MINT : false;
  const spanStart = selected.reduce((min, pool) => Math.min(min, pool.createdAtMs), options.nowMs) - 26 * 3_600_000;
  let solCandles = solPool ? await loadHourly(solPool, options.cacheDir, options.nowMs, log, Math.floor(spanStart / 1000)) : [];
  let solTapeNote = solCandles.length > 0 ? "SOL tape is Meteora hourly on the SOL-USDC pool." : "Meteora returned no SOL-USDC hourly bars.";
  if (solCandles.length === 0 && solPool) {
    solCandles = await geckoHourly(solPool);
    solTapeNote = solCandles.length > 0
      ? "Meteora returned no SOL-USDC hourly bars. The dump arm uses GeckoTerminal hourly prices for that pool. Those bars have no LP fee, which this arm does not need."
      : "Meteora and GeckoTerminal both returned no SOL-USDC hourly bars. A missing SOL return fails closed, so the dump arm enters nothing. That is not evidence that SOL was down 5%.";
    log(solTapeNote);
  }
  const study = scoreH33({
    rows,
    solCandles,
    solInvert,
    solPriceUsd: options.solPriceUsd,
    scannedYoung: young,
    noTape,
    solTapeNote,
    onProgress: log,
  });
  return { study, solInvert };
}

export function readSnapshotTimes(dbPath: string): number[] {
  if (!existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(`SELECT taken_at FROM snapshots`).all() as Array<{ taken_at: number }>;
    return rows.map((row) => row.taken_at);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export function renderRecorderHours(dbPath: string | undefined): string {
  const restart = Date.parse(RECORDER_RESTART_ISO);
  const h17 = projectedTapeHours(restart, Date.parse(FEE_CHECK_OCT17_ISO));
  const h20 = projectedTapeHours(restart, Date.parse(FEE_CHECK_OCT20_ISO));
  const m17 = projectedTapeHours(restart, Date.parse(FEE_CHECK_OCT17_MIDNIGHT_ISO));
  const m20 = projectedTapeHours(restart, Date.parse(FEE_CHECK_OCT20_MIDNIGHT_ISO));
  const lines: string[] = [];
  lines.push("## Recorder hours");
  lines.push("");
  lines.push("A swap is scored by the fee check only when a snapshot of that pool is at most 30 minutes older. Clean hours below are consecutive snapshot gaps that are above 0 and at most 30 minutes. Gaps larger than that are missing tape.");
  lines.push("");
  lines.push(`Known gap, from the box note: ${RECORDER_GAP_START_ISO} until ${RECORDER_RESTART_ISO}. The restart is the start of the post-gap tape. The stretch from 2026-10-11 07:26 UTC through 2026-10-13 17:08 UTC is not in the sqlite on this machine. It is not counted as clean.`);
  lines.push("");
  if (!dbPath || !existsSync(dbPath)) {
    lines.push(dbPath ? `No sqlite at ${dbPath}.` : "No recorder sqlite path was passed.");
  } else {
    const clean = cleanSnapshotHours(readSnapshotTimes(dbPath));
    lines.push(`File \`${dbPath}\`. Snapshots ${clean.points}. Clean span ${clean.hours.toFixed(2)} hours across ${clean.cleanGaps} short gaps. Broken gaps ${clean.brokenGaps}. Longest broken gap ${clean.maxBrokenHours.toFixed(2)} hours.`);
    lines.push("");
    lines.push("That file is the earlier Sunday sample. Its clean hours are not added to the post-gap projection.");
  }
  lines.push("");
  lines.push(`If the recorder stays up from ${RECORDER_RESTART_ISO}:`);
  lines.push("");
  lines.push(`- By 2026-10-17 00:00 UTC: ${m17.toFixed(2)} hours.`);
  lines.push(`- By 2026-10-17 07:32 UTC: ${h17.toFixed(2)} hours.`);
  lines.push(`- By 2026-10-20 00:00 UTC: ${m20.toFixed(2)} hours.`);
  lines.push(`- By 2026-10-20 07:32 UTC: ${h20.toFixed(2)} hours.`);
  lines.push("");
  lines.push("Those four numbers assume no new gap. This machine cannot see the box, so the assumption is unverified.");
  lines.push("");
  return lines.join("\n");
}

async function resolveSolDayChange(): Promise<{ pct: number | null; source: string }> {
  try {
    const pairs = await fetchTokenPairs(SOL_MINT);
    const pct = solChangeFromPairs(pairs);
    if (pct === null) return { pct: null, source: "DexScreener had no SOL-base USDC or USDT pair with a 24h change. The dump book opens nothing." };
    return { pct, source: "DexScreener pair with SOL as the base and USDC or USDT as the quote." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { pct: null, source: `SOL 24h change could not be read (${message}). The dump book opens nothing.` };
  }
}

async function syncAgeGrids(options: {
  root: string;
  universe: DiscoveredPool[];
  nowMs: number;
  solPriceUsd: number;
  rug?: RugCheckOptions;
  dumpSkip: boolean;
  onProgress: (message: string) => void;
}): Promise<{ books: GridAgeSync[]; rugs: RugHit[] }> {
  const strategies = age12Strategies();
  const buckets = ageBuckets(options.universe, options.nowMs);
  const rugs: RugHit[] = [];
  const books: GridAgeSync[] = [];
  for (const id of ["age12", "soldump"] as const) {
    const path = age12GridPath(id === "soldump", options.root);
    let book = loadForwardBookIfPresent(path, options.nowMs, H33_SIZE_USD);
    if (book.positions.some((position) => position.status === "open")) {
      options.onProgress(`Marking grid ${id} positions`);
      book = await markGrid(book, options.nowMs);
    }
    const archived = archiveClosedGridPositions(book, gridArchiveDir(path), options.nowMs);
    book = archived.book;
    const addedNames: string[] = [];
    if (!(id === "soldump" && options.dumpSkip)) {
      const gated = await gateAgeBuckets(buckets, book, options.rug, rugs, options.onProgress, id);
      const appended = appendForwardPools({
        book,
        buckets: gated,
        strategies,
        sizeUsd: H33_SIZE_USD,
        nowMs: options.nowMs,
        knownPools: options.universe,
      });
      book = appended.book;
      addedNames.push(...appended.added.map((pool) => `${pool.coinType} ${pool.name}`));
    }
    book.updatedAt = new Date(options.nowMs).toISOString();
    saveForwardBook(path, book);
    const history = gridHistory(book, gridArchiveDir(path));
    const poolMap = new Map(options.universe.map((pool) => [pool.address, pool]));
    let net = 0;
    let hold = 0;
    for (const position of history.positions) {
      const priced = positionNet(position, poolMap.get(position.poolAddress) ?? null, options.solPriceUsd);
      net += priced.net;
      hold += priced.vsHold;
    }
    books.push({
      id,
      added: addedNames,
      positions: history.positions.length,
      open: history.positions.filter((position) => position.status === "open").length,
      closed: history.positions.filter((position) => position.status === "closed").length,
      netPnlUsd: net,
      vsHoldUsd: hold,
      skippedDump: id === "soldump" && options.dumpSkip,
    });
  }
  return { books, rugs };
}

function ageBuckets(universe: DiscoveredPool[], nowMs: number) {
  const grouped = new Map<CoinType, DiscoveredPool[]>();
  const sorted = [...universe].sort((a, b) => (b.volume["24h"] ?? 0) - (a.volume["24h"] ?? 0));
  for (const pool of sorted) {
    if (!passesAge12(pool.createdAtMs, nowMs)) continue;
    const type = classifyPool(pool, nowMs).type;
    const list = grouped.get(type) ?? [];
    if (list.some((item) => sampleKey(item) === sampleKey(pool))) continue;
    list.push(pool);
    grouped.set(type, list);
  }
  const types: CoinType[] = ["stable", "bluechip", "fresh-memecoin", "high-vol-trending", "established-midcap", "older-memecoin"];
  return types.map((type) => ({ type, pools: grouped.get(type) ?? [] }));
}

async function gateAgeBuckets(
  buckets: Array<{ type: CoinType; pools: DiscoveredPool[] }>,
  book: TournamentForwardBook,
  rug: RugCheckOptions | undefined,
  hits: RugHit[],
  log: (message: string) => void,
  id: string,
) {
  const addresses = new Set(book.pools.map((pool) => pool.address));
  const keys = new Set(book.pools.map((pool) => pool.sampleKey).filter((key): key is string => Boolean(key)));
  const gated = [];
  for (const bucket of buckets) {
    const candidates = bucket.pools.filter((pool) => !addresses.has(pool.address) && !keys.has(sampleKey(pool)));
    if (!rug || candidates.length === 0) {
      gated.push({ type: bucket.type, pools: candidates.slice(0, 1) });
      continue;
    }
    log(`Rug-checking age12 ${id} ${bucket.type}`);
    const result = await rugGatePools({ pools: candidates, coinType: bucket.type, options: rug, accept: 1 });
    hits.push(...result.hits);
    gated.push({ type: bucket.type, pools: result.passed.slice(0, 1) });
  }
  return gated;
}

async function markGrid(book: TournamentForwardBook, nowMs: number): Promise<TournamentForwardBook> {
  const addresses = [...new Set(book.positions.filter((position) => position.status === "open").map((position) => position.poolAddress))];
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
  return book;
}

function loadAgeBook(path: string, trial: H12TrialFile, id: "age12" | "soldump", nowMs: number, solPriceUsd: number): H12TrialBook {
  if (!existsSync(path)) {
    const book = emptyH12Book(trial, nowMs, solPriceUsd);
    book.kind = "h12-age12";
    book.strategyId = id === "age12" ? "h12-age12" : "h12-age12-soldump";
    return book;
  }
  const book = JSON.parse(readFileSync(path, "utf8")) as H12TrialBook;
  if (book.kind !== "h12-age12" || !Array.isArray(book.slots)) throw new Error(`${path} is not an H12 age-filter book`);
  if (book.parameterHash !== trial.parameterHash) throw new Error(`Age book hash ${book.parameterHash} does not match ${trial.parameterHash}`);
  return book;
}

function openAge(trial: H12TrialFile, pool: DiscoveredPool, bins: number, nowMs: number): PaperPosition {
  return openPaperPosition({
    pool,
    strategy: strategyForWidth(trial.strategy, bins),
    sizeUsd: trial.rule.sizeUsd,
    nowMs,
  });
}

function positionNet(position: PaperPosition, pool: DiscoveredPool | null, solPriceUsd: number): { net: number; vsHold: number } {
  const gross = displayPnlUsd(position);
  const cost = costOf(position, pool, solPriceUsd);
  const net = gross - cost.pnlCostUsd;
  return { net, vsHold: position.depositedUsd + net - holdUsd(position) };
}

function holdUsd(position: PaperPosition): number {
  const xQuote = isQuoteToken(position.tokenX);
  const yQuote = isQuoteToken(position.tokenY);
  if (!xQuote && yQuote && position.entryPrice > 0 && position.lastPrice > 0) {
    return position.depositedUsd * (position.lastPrice / position.entryPrice);
  }
  return position.depositedUsd;
}

function freshAtBirth(pool: DiscoveredPool, nowMs: number): boolean {
  if (!(pool.createdAtMs > 0) || pool.binStep === null || !(pool.tvlUsd > 0)) return false;
  const age = ageHours(pool.createdAtMs, nowMs);
  if (!Number.isFinite(age) || age > H33_FRESH_MAX_AGE_DAYS * 24) return false;
  return classifyPool(pool, pool.createdAtMs + 3_600_000).type === "fresh-memecoin";
}

function dedupeNewest(pools: DiscoveredPool[]): DiscoveredPool[] {
  const byKey = new Map<string, DiscoveredPool>();
  const sorted = [...pools].sort((a, b) => b.createdAtMs - a.createdAtMs);
  for (const pool of sorted) {
    const key = sampleKey(pool);
    if (!byKey.has(key)) byKey.set(key, pool);
  }
  return [...byKey.values()].sort((a, b) => b.createdAtMs - a.createdAtMs);
}

async function loadHourly(pool: DiscoveredPool, cacheDir: string, nowMs: number, log: (message: string) => void, startSec?: number): Promise<Candle[]> {
  const path = join(cacheDir, `${pool.address}.json`);
  const end = Math.floor(nowMs / 1000);
  if (existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, "utf8")) as CandleSeries;
    const last = cached.candles[cached.candles.length - 1]?.timestamp ?? 0;
    if (cached.candles.length > 0 && last >= end - 3 * 3600) return cached.candles;
  }
  const start = startSec ?? Math.floor(pool.createdAtMs / 1000) - 3600;
  let candles: Candle[] = [];
  const chunk = 7 * 24 * 3600;
  for (let cursor = start; cursor < end; cursor += chunk) {
    const series = await fetchCandleWindow(pool, "1h", cursor, Math.min(end, cursor + chunk));
    candles = mergeCandles(candles, series.candles);
  }
  const file: CandleSeries = {
    poolAddress: pool.address,
    timeframe: "1h",
    candleHours: 1,
    source: "meteora",
    feeSource: "volume-history",
    candles,
  };
  writeFileSync(path, JSON.stringify(file));
  log(`H33 hourly ${pool.name}: ${candles.length} bars`);
  return candles;
}

async function geckoHourly(pool: DiscoveredPool): Promise<Candle[]> {
  const url = `${GECKOTERMINAL_API_BASE}/networks/solana/pools/${pool.address}/ohlcv/hour?aggregate=1&limit=1000`;
  try {
    const body = await getJson<unknown>(url, { timeoutMs: 25_000 });
    const data = body && typeof body === "object" ? (body as { data?: { attributes?: { ohlcv_list?: unknown } } }).data : undefined;
    const list = data?.attributes?.ohlcv_list;
    if (!Array.isArray(list)) return [];
    const candles: Candle[] = [];
    for (const row of list) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const timestamp = Number(row[0]);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      if (!(timestamp > 0) || !(open > 0) || !(close > 0)) continue;
      candles.push({
        timestamp,
        open,
        high: Math.max(high, open, close),
        low: Math.min(low > 0 ? low : open, open, close),
        close,
        volumeUsd: Number(row[5] ?? 0) || 0,
        lpFeesUsd: 0,
      });
    }
    return candles.sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

function mergeCandles(base: Candle[], extra: Candle[]): Candle[] {
  const byTs = new Map<number, Candle>();
  for (const candle of base) byTs.set(candle.timestamp, candle);
  for (const candle of extra) byTs.set(candle.timestamp, candle);
  return [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function lastAtOrBefore(candles: Candle[], sec: number): Candle | null {
  let found: Candle | null = null;
  for (const candle of candles) {
    if (candle.timestamp <= sec) found = candle;
    else break;
  }
  return found;
}

function invertPct(changePct: number): number | null {
  const factor = 1 + changePct / 100;
  if (!(factor > 0)) return null;
  return (1 / factor - 1) * 100;
}

function keyOf(arm: H33Arm, feeModel: H33FeeModel, window: H33Window, cohort: H33Cohort, cell: string): string {
  return [arm, feeModel, window, cohort, cell].join("|");
}

function addAcc(buckets: Map<string, Acc>, key: string, result: { net: number; hold: number; bars: number; stop: boolean }): void {
  const acc = buckets.get(key) ?? { nets: [], holds: [], bars: [], stops: 0 };
  acc.nets.push(result.net);
  acc.holds.push(result.hold);
  acc.bars.push(result.bars);
  if (result.stop) acc.stops += 1;
  buckets.set(key, acc);
}

function finishAcc(key: string, acc: Acc): ArmStats {
  const [arm, feeModel, window, cohort, cell] = key.split("|") as [H33Arm, H33FeeModel, H33Window, H33Cohort, string];
  const entries = acc.nets.length;
  return {
    arm,
    feeModel,
    window,
    cohort,
    cell,
    entries,
    stops: acc.stops,
    meanNet: entries ? mean(acc.nets) : null,
    medianNet: entries ? median(acc.nets) : null,
    meanVsHold: entries ? mean(acc.holds) : null,
    meanBars: entries ? mean(acc.bars) : null,
  };
}

export async function runH33Job(options: {
  reportsDir: string;
  rug?: RugCheckOptions;
  recorderDb?: string;
  onProgress?: (message: string) => void;
  nowMs?: number;
}): Promise<{ path: string; universe: DiscoveredPool[] }> {
  const log = options.onProgress ?? (() => {});
  const nowMs = options.nowMs ?? Date.now();
  const root = process.cwd();
  log("Scanning pools for matched H12 books and the H33 age filter");
  const universe = await discoverTournamentPools(nowMs);
  const price = await solPriceUsd(universe);
  const shortlist = selectTournamentBuckets(universe, nowMs, Math.max(TARGET_COINS_PER_BUCKET, CANDIDATE_COINS_PER_BUCKET));
  const primary = shortlist.flatMap((bucket) => {
    const seen = new Set<string>();
    return bucket.pools.filter((pool) => {
      const key = sampleKey(pool);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
  log(`Enriching price change for ${primary.length} coins`);
  await enrichPriceChange(primary);
  const cacheDir = join(root, "data/h12");
  const matched = await syncH12MatchedBooks({
    root,
    cacheDir,
    universe,
    nowMs,
    solPriceUsd: price,
    rug: options.rug,
    onProgress: log,
  });
  const paper = await syncH33Paper({
    root,
    cacheDir,
    universe,
    nowMs,
    solPriceUsd: price,
    rug: options.rug,
    onProgress: log,
  });
  const loaded = await loadH33Series({
    universe,
    cacheDir: join(root, "data/h33"),
    nowMs,
    solPriceUsd: price,
    onProgress: log,
  });
  const db = options.recorderDb ?? join(root, "data/recorder/recorder-2026-10-11.sqlite");
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const path = join(options.reportsDir, `h33-and-matched-${day}.md`);
  const text = [
    `# H33 age filter and matched H12 books ${new Date(nowMs).toISOString()}`,
    "",
    `Paper only. No wallet and no signed transaction. SOL $${price.toFixed(2)}. Frozen hashes and promotion gates are unchanged. The original H12 trial and its four take-profit books are not modified.`,
    "",
    "## Verified and inferred",
    "",
    "Verified: the five matched books share one rug check and one timestamp per pool; the age books are separate files; the classic grid stays 108 cells; a pool with no creation time does not pass the 12-hour gate; the score used for the hourly study is computed only on bars before the delayed entry. Inferred: scan-time TVL stands in for TVL at entry; the hourly score is not the 14-day H12 score; the post-gap recorder hours assume the box stays up, which this machine cannot see.",
    "",
    renderH12Matched(matched),
    renderH33Paper(paper),
    renderH33Study(loaded.study),
    renderRecorderHours(existsSync(db) ? db : options.recorderDb),
  ].join("\n");
  mkdirSync(options.reportsDir, { recursive: true });
  writeFileSync(path, text);
  return { path, universe };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function statTable(study: H33Study, cell: string): string {
  const lines = [
    "| Arm | Fees | Window | Cohort | Entries | Stops | Stop rate | Stops per pool | Mean net | Median net | Mean vs hold | Bars |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  const arms: H33Arm[] = ["birth", "age12", "age12-soldump"];
  const fees: H33FeeModel[] = ["crossed-bins", "active-bin"];
  const windows: H33Window[] = ["train70", "full"];
  const cohorts: H33Cohort[] = ["train", "holdout"];
  for (const arm of arms) {
    for (const feeModel of fees) {
      for (const window of windows) {
        for (const cohort of cohorts) {
          const stat = findStat(study.stats, { arm, feeModel, window, cohort, cell });
          const pools = cohort === "train" ? study.trainPools : study.holdoutPools;
          lines.push(`| ${arm} | ${feeModel} | ${window} | ${cohort} | ${stat?.entries ?? 0} | ${stat?.stops ?? 0} | ${rate(stat?.stops ?? 0, stat?.entries ?? 0)} | ${perPool(stat?.stops ?? 0, pools)} | ${money(stat?.meanNet ?? null)} | ${money(stat?.medianNet ?? null)} | ${money(stat?.meanVsHold ?? null)} | ${stat?.meanBars === null || stat?.meanBars === undefined ? "—" : stat.meanBars.toFixed(1)} |`);
        }
      }
    }
  }
  return lines.join("\n");
}

function plainReading(study: H33Study): string[] {
  const lines: string[] = [];
  const views: Array<{ label: string; window: H33Window; cohort: H33Cohort; feeModel: H33FeeModel }> = [
    { label: "Holdout, full tape, crossed-bin", window: "full", cohort: "holdout", feeModel: "crossed-bins" },
    { label: "Holdout, full tape, active-bin", window: "full", cohort: "holdout", feeModel: "active-bin" },
    { label: "Train coins, first 70% of bars, crossed-bin", window: "train70", cohort: "train", feeModel: "crossed-bins" },
    { label: "Train coins, full tape, crossed-bin", window: "full", cohort: "train", feeModel: "crossed-bins" },
  ];
  for (const view of views) {
    const pools = view.cohort === "train" ? study.trainPools : study.holdoutPools;
    const birth = findStat(study.stats, { arm: "birth", feeModel: view.feeModel, window: view.window, cohort: view.cohort, cell: "classic-108" });
    const age = findStat(study.stats, { arm: "age12", feeModel: view.feeModel, window: view.window, cohort: view.cohort, cell: "classic-108" });
    const dump = findStat(study.stats, { arm: "age12-soldump", feeModel: view.feeModel, window: view.window, cohort: view.cohort, cell: "classic-108" });
    lines.push(`${view.label}, classic 108: birth stop rate ${rate(birth?.stops ?? 0, birth?.entries ?? 0)} on ${birth?.entries ?? 0} entries, mean net ${money(birth?.meanNet ?? null)}, median ${money(birth?.medianNet ?? null)}, mean vs hold ${money(birth?.meanVsHold ?? null)}, stops per pool ${perPool(birth?.stops ?? 0, pools)}. Age-12 stop rate ${rate(age?.stops ?? 0, age?.entries ?? 0)} on ${age?.entries ?? 0} entries, mean net ${money(age?.meanNet ?? null)}, median ${money(age?.medianNet ?? null)}, mean vs hold ${money(age?.meanVsHold ?? null)}, stops per pool ${perPool(age?.stops ?? 0, pools)}. SOL-dump arm stop rate ${rate(dump?.stops ?? 0, dump?.entries ?? 0)} on ${dump?.entries ?? 0} entries, mean net ${money(dump?.meanNet ?? null)}, median ${money(dump?.medianNet ?? null)}.`);
  }
  lines.push("A lower stop rate with fewer entries can be the filter skipping losers, or it can be a shorter hold. The bars column is the average number of hourly bars inside the position. Compare stops per pool, which counts a skip as no stop.");
  return lines;
}

function rate(stops: number, total: number): string {
  if (!(total > 0)) return "—";
  return `${((100 * stops) / total).toFixed(1)}%`;
}

function perPool(stops: number, pools: number): string {
  if (!(pools > 0)) return "—";
  return (stops / pools).toFixed(1);
}

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

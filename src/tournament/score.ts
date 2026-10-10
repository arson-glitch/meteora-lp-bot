import type { CoinType } from "../types.js";
import type { GridCell } from "./grid.js";
import { COIN_TYPES } from "./classify.js";
import type { TrialResult } from "./backtest.js";

/**
 * Rank on the train window by median net return. Trials are expected to
 * already include crossed-bin LP fees and full exit costs. The time-split
 * test re-ranks the top five yield strategies. Bid-Ask is not a yield
 * strategy. Promotion also requires the cost-adjusted holdout to beat cash
 * and to beat holding the volatile token, with no single coin above half of
 * the positive PnL. Holdout coins are never used to rank.
 */

export const MIN_TRAIN_TRIALS = 8;
export const MIN_TEST_TRIALS = 5;
export const MIN_HOLDOUT_TRIALS = 4;
export const CONFIRM_TOP_K = 5;
export const MAX_COIN_POSITIVE_SHARE = 0.5;

export interface SplitStats {
  n: number;
  meanReturn: number | null;
  medianReturn: number | null;
  winRate: number | null;
  meanMaxDrawdown: number | null;
  worstMaxDrawdown: number | null;
  sharpeLike: number | null;
  meanFeesUsd: number | null;
  meanIlUsd: number | null;
  meanVsHodl: number | null;
  meanNetPnlUsd: number | null;
  meanVsToken: number | null;
  medianVsToken: number | null;
  maxPositiveCoinShare: number | null;
}

export interface RankedStrategy {
  coinType: CoinType;
  strategyId: string;
  cell: GridCell | null;
  train: SplitStats;
  test: SplitStats;
  holdout: SplitStats;
  trainRank: number | null;
  eligible: boolean;
  inConfirmationSet: boolean;
  promoted: boolean;
}

export interface BucketLeaderboard {
  coinType: CoinType;
  rows: RankedStrategy[];
  winner: RankedStrategy | null;
  promotionNote: string;
}

export function scoreTrials(trials: TrialResult[], cells: GridCell[]): BucketLeaderboard[] {
  const cellById = new Map(cells.map((cell) => [cell.id, cell]));
  return COIN_TYPES.map((coinType) => scoreBucket(coinType, trials.filter((trial) => trial.coinType === coinType), cellById));
}

function scoreBucket(
  coinType: CoinType,
  trials: TrialResult[],
  cellById: Map<string, GridCell>,
): BucketLeaderboard {
  const ids = new Set<string>([...cellById.keys(), ...trials.map((trial) => trial.strategyId)]);
  const rows: RankedStrategy[] = [...ids].map((strategyId) => {
    const mine = trials.filter((trial) => trial.strategyId === strategyId);
    const train = summarize(mine.filter((trial) => trial.split === "train"));
    const test = summarize(mine.filter((trial) => trial.split === "test"));
    const holdout = summarize(mine.filter((trial) => trial.split === "holdout"));
    return {
      coinType,
      strategyId,
      cell: cellById.get(strategyId) ?? null,
      train,
      test,
      holdout,
      trainRank: null,
      eligible: train.n >= MIN_TRAIN_TRIALS && train.medianReturn !== null,
      inConfirmationSet: false,
      promoted: false,
    };
  });

  const eligible = rows.filter((row) => row.eligible).sort(compareTrain);
  eligible.forEach((row, index) => {
    row.trainRank = index + 1;
  });
  const yieldEligible = eligible.filter((row) => row.cell?.shape !== "BidAsk");
  const confirmation = yieldEligible.slice(0, CONFIRM_TOP_K);
  for (const row of confirmation) row.inConfirmationSet = true;

  const confirmed = confirmation
    .filter((row) => row.test.n >= MIN_TEST_TRIALS && row.test.medianReturn !== null)
    .sort(compareTest);
  const best = confirmed[0] ?? null;
  let winner: RankedStrategy | null = null;
  let promotionNote: string;
  if (eligible.length > 0 && yieldEligible.length === 0) {
    promotionNote = "Every train-eligible strategy is Bid-Ask. Bid-Ask is treated as an exit tool, not a yield strategy, so nothing is promoted.";
  } else if (!best) {
    promotionNote =
      eligible.length === 0
        ? `No strategy has ${MIN_TRAIN_TRIALS} or more train trials, so nothing is promoted.`
        : `The top yield strategies do not have ${MIN_TEST_TRIALS} time-split test trials, so nothing is promoted.`;
  } else if ((best.test.medianReturn ?? 0) <= 0 || (best.test.meanReturn ?? 0) <= 0) {
    promotionNote = `${best.strategyId} led the time-split test among the top ${CONFIRM_TOP_K} yield strategies, but the test median (${fmtPct(best.test.medianReturn)}) and mean (${fmtPct(best.test.meanReturn)}) are not both positive, so it is not promoted.`;
  } else if (
    best.holdout.n < MIN_HOLDOUT_TRIALS ||
    (best.holdout.medianReturn ?? 0) <= 0 ||
    (best.holdout.meanReturn ?? 0) <= 0
  ) {
    promotionNote = `${best.strategyId} passed the time split (median ${fmtPct(best.test.medianReturn)}, mean ${fmtPct(best.test.meanReturn)}) but the cost-adjusted holdout did not beat cash (n=${best.holdout.n}, median ${fmtPct(best.holdout.medianReturn)}, mean ${fmtPct(best.holdout.meanReturn)}), so it is not promoted.`;
  } else if ((best.holdout.medianVsToken ?? 0) <= 0 || (best.holdout.meanVsToken ?? 0) <= 0) {
    promotionNote = `${best.strategyId} beat cash on the holdout but did not beat holding the token (median ${usd(best.holdout.medianVsToken)}, mean ${usd(best.holdout.meanVsToken)}), so it is not promoted.`;
  } else if (best.holdout.maxPositiveCoinShare === null || best.holdout.maxPositiveCoinShare > MAX_COIN_POSITIVE_SHARE) {
    promotionNote = `${best.strategyId} beat cash and the token on the holdout, but one coin is ${fmtPct(best.holdout.maxPositiveCoinShare)} of positive PnL, above the ${fmtPct(MAX_COIN_POSITIVE_SHARE)} cap, so it is not promoted.`;
  } else {
    best.promoted = true;
    winner = best;
    promotionNote = `${best.strategyId} is promoted: train rank ${best.trainRank}, time-split n=${best.test.n} median ${fmtPct(best.test.medianReturn)}, holdout n=${best.holdout.n} median ${fmtPct(best.holdout.medianReturn)}, holdout vs token ${usd(best.holdout.meanVsToken)}, largest coin ${fmtPct(best.holdout.maxPositiveCoinShare)} of positive PnL.`;
  }

  rows.sort(compareTrain);
  return { coinType, rows, winner, promotionNote };
}

export function summarize(trials: TrialResult[]): SplitStats {
  if (trials.length === 0) {
    return {
      n: 0,
      meanReturn: null,
      medianReturn: null,
      winRate: null,
      meanMaxDrawdown: null,
      worstMaxDrawdown: null,
      sharpeLike: null,
      meanFeesUsd: null,
      meanIlUsd: null,
      meanVsHodl: null,
      meanNetPnlUsd: null,
      meanVsToken: null,
      medianVsToken: null,
      maxPositiveCoinShare: null,
    };
  }
  const returns = trials.map((trial) => trial.returnPct);
  const drawdowns = trials.map((trial) => trial.maxDrawdownPct);
  const versusToken = trials.map((trial) => trial.vsTokenUsd).filter((value): value is number => value !== undefined);
  return {
    n: trials.length,
    meanReturn: mean(returns),
    medianReturn: median(returns),
    winRate: trials.filter((trial) => trial.netPnlUsd > 0).length / trials.length,
    meanMaxDrawdown: mean(drawdowns),
    worstMaxDrawdown: Math.max(...drawdowns),
    sharpeLike: sharpeLike(returns),
    meanFeesUsd: mean(trials.map((trial) => trial.feesUsd)),
    meanIlUsd: mean(trials.map((trial) => trial.ilUsd)),
    meanVsHodl: mean(trials.map((trial) => trial.vsHodlUsd)),
    meanNetPnlUsd: mean(trials.map((trial) => trial.netPnlUsd)),
    meanVsToken: versusToken.length > 0 ? mean(versusToken) : null,
    medianVsToken: versusToken.length > 0 ? median(versusToken) : null,
    maxPositiveCoinShare: positiveCoinShare(trials),
  };
}

function positiveCoinShare(trials: TrialResult[]): number | null {
  const coins = new Map<string, number>();
  for (const trial of trials) {
    if (trial.netPnlUsd <= 0) continue;
    const key = trial.coinKey ?? trial.poolAddress;
    coins.set(key, (coins.get(key) ?? 0) + trial.netPnlUsd);
  }
  const positive = [...coins.values()].reduce((sum, value) => sum + value, 0);
  if (positive <= 0) return null;
  return Math.max(...coins.values()) / positive;
}

function compareTrain(a: RankedStrategy, b: RankedStrategy): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  return compareDesc(a.train.medianReturn, b.train.medianReturn)
    || compareDesc(a.train.sharpeLike, b.train.sharpeLike)
    || a.strategyId.localeCompare(b.strategyId);
}

function compareTest(a: RankedStrategy, b: RankedStrategy): number {
  return compareDesc(a.test.medianReturn, b.test.medianReturn)
    || compareDesc(a.test.sharpeLike, b.test.sharpeLike)
    || a.strategyId.localeCompare(b.strategyId);
}

/** Higher numbers first. Nulls sort last. */
function compareDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function sharpeLike(values: number[]): number | null {
  if (values.length < 2) return null;
  const stdev = sampleStdev(values);
  if (stdev === 0) return null;
  return mean(values) / stdev;
}

function sampleStdev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
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

function fmtPct(value: number | null): string {
  if (value === null) return "n/a";
  return `${(value * 100).toFixed(2)}%`;
}

function usd(value: number | null): string {
  if (value === null) return "n/a";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

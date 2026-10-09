import type { CoinType } from "../types.js";
import type { GridCell } from "./grid.js";
import { COIN_TYPES } from "./classify.js";
import type { TrialResult } from "./backtest.js";

/**
 * Rank on the train window by median net return. The test window only
 * re-ranks the top five train strategies, and a winner is written only when
 * that confirmation sample has at least three trials and a positive median.
 * Test scores are not used to search the other 103 cells.
 */

export const MIN_TRAIN_TRIALS = 3;
export const MIN_TEST_TRIALS = 3;
export const CONFIRM_TOP_K = 5;

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
}

export interface RankedStrategy {
  coinType: CoinType;
  strategyId: string;
  cell: GridCell | null;
  train: SplitStats;
  test: SplitStats;
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
    return {
      coinType,
      strategyId,
      cell: cellById.get(strategyId) ?? null,
      train,
      test,
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
  const confirmation = eligible.slice(0, CONFIRM_TOP_K);
  for (const row of confirmation) row.inConfirmationSet = true;

  const confirmed = confirmation
    .filter((row) => row.test.n >= MIN_TEST_TRIALS && row.test.medianReturn !== null)
    .sort(compareTest);
  const best = confirmed[0] ?? null;
  let winner: RankedStrategy | null = null;
  let promotionNote: string;
  if (!best) {
    promotionNote =
      eligible.length === 0
        ? `No strategy has ${MIN_TRAIN_TRIALS} or more train trials, so nothing is promoted.`
        : `The top train strategies do not have ${MIN_TEST_TRIALS} test trials, so nothing is promoted.`;
  } else if ((best.test.medianReturn ?? 0) <= 0) {
    promotionNote = `${best.strategyId} led the test window among the top ${CONFIRM_TOP_K} train strategies, but its test median return is not positive, so it is not promoted.`;
  } else {
    best.promoted = true;
    winner = best;
    promotionNote = `${best.strategyId} is promoted: train rank ${best.trainRank}, test n=${best.test.n}, test median return ${fmtPct(best.test.medianReturn)}.`;
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
    };
  }
  const returns = trials.map((trial) => trial.returnPct);
  const drawdowns = trials.map((trial) => trial.maxDrawdownPct);
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
  };
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

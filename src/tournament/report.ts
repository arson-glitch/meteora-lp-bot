import type { CoinType } from "../types.js";
import type { BucketLeaderboard, RankedStrategy } from "./score.js";
import { CONFIRM_TOP_K, MIN_TEST_TRIALS, MIN_TRAIN_TRIALS } from "./score.js";

export interface PoolSample {
  coinType: CoinType;
  name: string;
  address: string;
  binStep: number | null;
  tvlUsd: number;
  volume24hUsd: number;
  candles: number;
  timeframe: string;
  source: string;
  feeSource: string;
  skippedReason?: string;
}

export function renderLeaderboardMarkdown(params: {
  generatedAt: string;
  sizeUsd: number;
  boards: BucketLeaderboard[];
  samples: PoolSample[];
}): string {
  const lines: string[] = [];
  lines.push("# Strategy tournament leaderboard");
  lines.push("");
  lines.push(`Generated ${params.generatedAt}. Paper only. Deposit size $${params.sizeUsd} per trial.`);
  lines.push("");
  lines.push("## How a winner is chosen");
  lines.push("");
  lines.push(
    `Strategies are ranked on the first 70% of each pool's candles by median net return (equity minus deposit, divided by deposit). Net return includes simulated LP fees and the inventory mark, so impermanent loss is inside it. A strategy needs at least ${MIN_TRAIN_TRIALS} train trials to be ranked. The top ${CONFIRM_TOP_K} train strategies are re-ranked on the last 30% of candles, which is a separate replay that opens a new position. A config is written to \`strategies/winners/\` only when that test sample has at least ${MIN_TEST_TRIALS} trials and a positive test median. The other cells never see the test window.`,
  );
  lines.push("");
  lines.push("## Caveats");
  lines.push("");
  lines.push("- Fee share is `candle LP fees × position mark / pool TVL`, capped at 100% of the candle's LP fees. It is not per-bin concentration. A tight range does not earn a higher fee rate while it is in range; it just falls out of range sooner. TVL is frozen at the scan snapshot, and our deposit is not added into it, so small pools overstate the share.");
  lines.push("- When Meteora volume history has an LP fee on the same timestamp, that figure is used (it is already the LP slice). Otherwise volume × `(baseFeePct + dynamicFeePct) / 100` × the pool's observed 24h LP share. `dynamicFeePct` is the current snapshot, not the historical variable fee.");
  lines.push("- The intra-candle path is open, nearer extreme, other extreme, close. A wick can stop out or exit a range that the close would have survived.");
  lines.push("- Quote-token USD is frozen. Token X is marked at `price × frozen quote USD`. There is no gas, no rebalance rent, and no extra composition fee.");
  lines.push("- After an exit the trial sits in cash. It does not re-enter. Hodl is the initial token amounts marked at the window's last close, so an early exit is compared with holding through the rest of the window.");
  lines.push("- The train/test split is temporal, on the same pools. It checks whether a rule survived the later part of this sample. It is not a new set of coins. Cross-sectional sample size is the number of pools in the bucket, which this run caps at four.");
  lines.push("- `sharpeLike` is mean trial return divided by the sample standard deviation of those trial returns. It is not annualized and it is not a bar-by-bar Sharpe.");
  lines.push("- Bin step is the pool's step. The grid does not vary it, and winners are not split into bin-step bands.");
  lines.push("");
  lines.push("## Samples");
  lines.push("");
  lines.push("| Bucket | Pool | Bin step | Candles | Source | Fees |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const sample of params.samples) {
    const detail = sample.skippedReason
      ? sample.skippedReason
      : `${sample.candles} × ${sample.timeframe}`;
    lines.push(
      `| ${sample.coinType} | ${sample.name} | ${sample.binStep ?? "—"} | ${detail} | ${sample.source} | ${sample.feeSource} |`,
    );
  }
  lines.push("");
  for (const board of params.boards) {
    lines.push(`## ${board.coinType}`);
    lines.push("");
    lines.push(board.promotionNote);
    lines.push("");
    const shown = board.rows.filter((row) => row.train.n > 0).slice(0, 10);
    if (shown.length === 0) {
      lines.push("No completed trials.");
      lines.push("");
      continue;
    }
    lines.push("| Rank | Strategy | Train n | Train median | Win rate | Max DD | Sharpe-like | Test n | Test median | Promoted |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const row of shown) {
      lines.push(
        `| ${row.trainRank ?? "—"} | \`${row.strategyId}\` | ${row.train.n} | ${pct(row.train.medianReturn)} | ${pct(row.train.winRate)} | ${pct(row.train.worstMaxDrawdown)} | ${num(row.train.sharpeLike)} | ${row.test.n} | ${pct(row.test.medianReturn)} | ${row.promoted ? "yes" : ""} |`,
      );
    }
    lines.push("");
    lines.push(metricLine(shown));
    lines.push("");
  }
  lines.push("Full rows, including strategies with no trials, are in `reports/leaderboard.csv`.");
  lines.push("");
  return lines.join("\n");
}

function metricLine(rows: RankedStrategy[]): string {
  const top = rows[0];
  if (!top) return "";
  return `Top train row mean fees $${fmt(top.train.meanFeesUsd)}, mean IL $${fmt(top.train.meanIlUsd)}, mean vs hodl $${fmt(top.train.meanVsHodl)}.`;
}

export function renderLeaderboardCsv(boards: BucketLeaderboard[]): string {
  const header = [
    "coin_type",
    "strategy_id",
    "shape",
    "width",
    "side",
    "exit",
    "train_n",
    "train_median_return",
    "train_mean_return",
    "train_win_rate",
    "train_mean_max_dd",
    "train_worst_max_dd",
    "train_sharpe_like",
    "train_mean_fees_usd",
    "train_mean_il_usd",
    "train_mean_vs_hodl_usd",
    "test_n",
    "test_median_return",
    "test_mean_return",
    "test_win_rate",
    "test_sharpe_like",
    "eligible",
    "in_confirmation_set",
    "promoted",
  ];
  const lines = [header.join(",")];
  for (const board of boards) {
    for (const row of board.rows) {
      lines.push(
        [
          row.coinType,
          row.strategyId,
          row.cell?.shape ?? "",
          row.cell?.width ?? "",
          row.cell?.side ?? "",
          row.cell?.exit ?? "",
          row.train.n,
          csvNum(row.train.medianReturn),
          csvNum(row.train.meanReturn),
          csvNum(row.train.winRate),
          csvNum(row.train.meanMaxDrawdown),
          csvNum(row.train.worstMaxDrawdown),
          csvNum(row.train.sharpeLike),
          csvNum(row.train.meanFeesUsd),
          csvNum(row.train.meanIlUsd),
          csvNum(row.train.meanVsHodl),
          row.test.n,
          csvNum(row.test.medianReturn),
          csvNum(row.test.meanReturn),
          csvNum(row.test.winRate),
          csvNum(row.test.sharpeLike),
          row.eligible,
          row.inConfirmationSet,
          row.promoted,
        ].join(","),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function pct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function num(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

function fmt(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

function csvNum(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "";
  return String(value);
}

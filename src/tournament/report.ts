import type { CoinType } from "../types.js";
import type { BucketLeaderboard, RankedStrategy } from "./score.js";
import { CONFIRM_TOP_K, MIN_HOLDOUT_TRIALS, MIN_TEST_TRIALS, MIN_TRAIN_TRIALS } from "./score.js";

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
  spanDays?: number;
  role?: "train" | "holdout";
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
    `Strategies are ranked on train coins only, using the first 70% of each pool's candles, by median net return (equity minus deposit, divided by deposit). Net return includes simulated LP fees and the inventory mark, so impermanent loss is inside it. A strategy needs at least ${MIN_TRAIN_TRIALS} train trials. The top ${CONFIRM_TOP_K} are re-ranked on the last 30% of those same coins' candles. The single best of that list is written to \`strategies/winners/\` only when that time split has at least ${MIN_TEST_TRIALS} trials with a positive median and mean, and the cross-coin holdout has at least ${MIN_HOLDOUT_TRIALS} trials with a positive median and mean. Holdout coins are absent from ranking and from the time split.`,
  );
  lines.push("");
  lines.push("## Caveats");
  lines.push("");
  lines.push("- Fee share is `candle LP fees × position mark / pool TVL`, capped at 100% of the candle's LP fees. It is not per-bin concentration. A tight range does not earn a higher fee rate while it is in range; it just falls out of range sooner. TVL is frozen at the scan snapshot, and our deposit is not added into it, so small pools overstate the share.");
  lines.push("- When Meteora volume history has an LP fee on the same timestamp, that figure is used (it is already the LP slice). Otherwise volume × `(baseFeePct + dynamicFeePct) / 100` × the pool's observed 24h LP share. `dynamicFeePct` is the current snapshot, not the historical variable fee.");
  lines.push("- The intra-candle path is open, nearer extreme, other extreme, close. A wick can stop out or exit a range that the close would have survived.");
  lines.push("- Quote-token USD is frozen. Token X is marked at `price × frozen quote USD`. There is no gas, no rebalance rent, and no extra composition fee.");
  lines.push("- After an exit the trial sits in cash. It does not re-enter. Hodl is the initial token amounts marked at the window's last close, so an early exit is compared with holding through the rest of the window.");
  lines.push("- Each bucket aims for 18 coins. A second or third pool is included when the same coin has another bin step, so some trials share a coin. Holdout is by coin: every pool of a held-out coin is replayed on its full history and is excluded from training. The split is the lexicographic tail of the coin keys, about 30%.");
  lines.push("- Older pools use daily bars over up to 90 days. Pools younger than 20 days use 4-hour bars over 16 days, and pools younger than 36 hours use 1-hour bars over 48 hours. A daily candle's wick path exits ranges that a finer bar might have survived.");
  lines.push("- `sharpeLike` is mean trial return divided by the sample standard deviation of those trial returns. It is not annualized and it is not a bar-by-bar Sharpe.");
  lines.push("- Bin step is the pool's step. The grid does not vary it, and winners are not split into bin-step bands.");
  lines.push("");
  lines.push("## Samples");
  lines.push("");
  const skipped = params.samples.filter((sample) => sample.skippedReason);
  lines.push(`Accepted pools: ${params.samples.length - skipped.length}. Skipped: ${skipped.length}.`);
  lines.push("");
  lines.push("| Bucket | Role | Pool | Bin step | History | Source | Fees |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const sample of params.samples) {
    if (sample.skippedReason) continue;
    const span = sample.spanDays !== undefined ? `${sample.spanDays.toFixed(0)}d ` : "";
    lines.push(
      `| ${sample.coinType} | ${sample.role ?? "—"} | ${sample.name} | ${sample.binStep ?? "—"} | ${span}${sample.candles} × ${sample.timeframe} | ${sample.source} | ${sample.feeSource} |`,
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
    lines.push("| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const row of shown) {
      lines.push(
        `| ${row.trainRank ?? "—"} | \`${row.strategyId}\` | ${row.train.n} | ${pct(row.train.medianReturn)} | ${pct(row.test.medianReturn)} | ${row.holdout.n} | ${pct(row.holdout.medianReturn)} | ${usd(row.holdout.meanVsHodl)} | ${row.promoted ? "yes" : ""} |`,
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
  return `Top train row vs holding: train $${fmt(top.train.meanVsHodl)}, time-split $${fmt(top.test.meanVsHodl)}, holdout $${fmt(top.holdout.meanVsHodl)} (mean dollars versus buying and holding the entry tokens).`;
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
    "test_mean_vs_hodl_usd",
    "holdout_n",
    "holdout_median_return",
    "holdout_mean_return",
    "holdout_win_rate",
    "holdout_sharpe_like",
    "holdout_mean_vs_hodl_usd",
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
          csvNum(row.test.meanVsHodl),
          row.holdout.n,
          csvNum(row.holdout.medianReturn),
          csvNum(row.holdout.meanReturn),
          csvNum(row.holdout.winRate),
          csvNum(row.holdout.sharpeLike),
          csvNum(row.holdout.meanVsHodl),
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

function usd(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function fmt(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

function csvNum(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "";
  return String(value);
}

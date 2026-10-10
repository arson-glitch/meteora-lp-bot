import { isQuoteToken } from "../markets.js";
import type { DiscoveredPool } from "../types.js";
import type { TrialResult } from "./backtest.js";

export interface SizeSweepRow {
  sizeUsd: number;
  n: number;
  meanNetUsd: number | null;
}

export interface HypothesisReportInput {
  generatedAt: string;
  sizeUsd: number;
  solPriceUsd: number;
  trials: TrialResult[];
  pools: DiscoveredPool[];
  sweep: SizeSweepRow[];
}

/**
 * Verdicts for the 2026-10-10 brief. Each one says what was actually measured.
 * Claims that need swap tapes or historical bin arrays stay untestable.
 */
export function renderHypotheses(input: HypothesisReportInput): string {
  const lines: string[] = [];
  lines.push(`# Hypothesis check ${input.generatedAt.slice(0, 10)}`);
  lines.push("");
  lines.push(`Paper only. Deposit baseline $${input.sizeUsd}. SOL $${input.solPriceUsd.toFixed(2)}. Trials already include crossed-bin LP fees, exit slippage, transaction fees, and non-refundable bin-array rent. Position rent is locked capital and is not in PnL.`);
  lines.push("");
  lines.push(feeModelSection());
  lines.push(h1(input));
  lines.push(h2(input));
  lines.push(h3(input));
  lines.push(h4());
  lines.push(h5(input.sweep));
  lines.push(h6());
  lines.push(h7(input));
  lines.push(h8());
  lines.push(h9(input));
  lines.push("## Bid-Ask");
  lines.push("");
  lines.push(bidAsk(input));
  lines.push("");
  return lines.join("\n");
}

function feeModelSection(): string {
  return [
    "## Fee model",
    "",
    "- **Multi-bin fees: partial.** The SDK and the program events show a swap from `start_bin_id` to `end_bin_id` paying a fee in each bin it crosses. This run splits each candle's observed LP fee across the bins the candle path walked, by our liquidity in those bins. A one-bin move matches the old active-bin model. A full `Swap2Evt` replay is untestable: the public candle API does not include per-swap bin ranges.",
    "- **Dynamic fee: partial.** Volume-history fees are the fees LPs were actually paid, so they already include the variable fee. The fallback estimator uses the pool's current `dynamicFeePct` and caps base plus variable at 10%, which is `MAX_FEE_RATE` in `@meteora-ag/dlmm`. It is not the historical volatility accumulator.",
    "- **Protocol fee: confirmed.** Meteora's volume history `fees` field is the LP slice. `protocol_fees` is separate. The fallback multiplies by the observed LP share, which is about 90% on standard pools and follows the pool when the API reports a different split. Launch pools at 20% are handled by that observed share, not by a hard-coded 10%.",
    "",
  ].join("\n");
}

function h1(input: HypothesisReportInput): string {
  const pools = new Map(input.pools.map((pool) => [pool.address, pool]));
  const rows = input.trials.filter((trial) => trial.strategyId === "grid-spot-broad-two-stay" && trial.split !== "test");
  const matched = rows.filter((trial) => {
    const pool = pools.get(trial.poolAddress);
    if (!pool) return false;
    const step = pool.binStep ?? 0;
    const fee = pool.baseFeePct ?? 0;
    const meme = trial.coinType === "fresh-memecoin" || trial.coinType === "older-memecoin" || trial.coinType === "high-vol-trending";
    return meme && step >= 80 && step <= 200 && fee >= 1 && fee <= 5;
  });
  const highShare = matched.filter((trial) => (trial.poolShare ?? 0) >= 0.3);
  const meanNet = mean(matched.map((trial) => trial.netPnlUsd));
  const meanToken = mean(matched.map((trial) => trial.vsTokenUsd).filter((value): value is number => value !== undefined));
  const verdict = matched.length < 4 ? "untestable" : meanNet !== null && meanNet > 0 && meanToken !== null && meanToken > 0 ? "confirmed" : "rejected";
  const shareNote = highShare.length < 4
    ? `Only ${highShare.length} of those trials have deposit/TVL ≥ 30%. A $250 deposit is a small share of almost every scanned pool, and historical per-bin liquidity is not in the public candle API, so the ≥30% in-range-share clause is untestable.`
    : `${highShare.length} trials have deposit/TVL ≥ 30%. That ratio is pool TVL, not in-range liquidity.`;
  return [
    "## H1 Wide high-fee Spot versus holding",
    "",
    `**${verdict}.** Two-sided Spot, 80 bins each side, 96-hour out-of-range hold, on memecoin pools with bin step 80–200 and base fee 1–5%. n=${matched.length}. Mean net ${usd(meanNet)}. Mean versus holding the token ${usd(meanToken)}.`,
    "",
    shareNote,
    "",
  ].join("\n");
}

function h2(input: HypothesisReportInput): string {
  const pools = input.pools.filter((pool) => pool.tvlUsd > 0);
  const scored = pools
    .map((pool) => {
      const feeTvl = pool.feeTvlRatio["24h"] ?? (pool.tvlUsd > 0 ? (pool.fees["24h"] ?? 0) / pool.tvlUsd : 0);
      const vol = Math.max(Math.abs(pool.market.priceChangeH24Pct ?? 0) / 100, 0.01);
      return { address: pool.address, ratio: feeTvl / vol };
    })
    .filter((row) => Number.isFinite(row.ratio))
    .sort((a, b) => b.ratio - a.ratio);
  const cut = Math.max(1, Math.floor(scored.length * 0.2));
  const top = new Set(scored.slice(0, cut).map((row) => row.address));
  const rows = input.trials.filter((trial) => trial.strategyId === "grid-spot-broad-two-stay" && trial.split === "train");
  const topNet = mean(rows.filter((trial) => top.has(trial.poolAddress)).map((trial) => trial.netPnlUsd));
  const restNet = mean(rows.filter((trial) => !top.has(trial.poolAddress)).map((trial) => trial.netPnlUsd));
  const topN = rows.filter((trial) => top.has(trial.poolAddress)).length;
  const restN = rows.filter((trial) => !top.has(trial.poolAddress)).length;
  const verdict = topN < 4 || restN < 4 || topNet === null || restNet === null ? "untestable" : topNet > restNet ? "confirmed" : "rejected";
  return [
    "## H2 Fee/TVL over realized volatility",
    "",
    `**${verdict}.** Rank is 24h fee/TVL divided by absolute 24h price change (floor 1%). Top quintile train mean net ${usd(topNet)} (n=${topN}) versus the rest ${usd(restNet)} (n=${restN}), on the broad Spot stay cell. This is the same backtest window, not a separate forward 24h entry test. In-range TVL is not available, so the ratio uses pool TVL.`,
    "",
  ].join("\n");
}

function h3(input: HypothesisReportInput): string {
  const immediate = stats(input, "grid-spot-wide-two-rebalance");
  const delayed = stats(input, "grid-spot-wide-two-rebalance6");
  const never = stats(input, "grid-spot-wide-two-patient-array");
  const verdict = immediate.n < 4 || delayed.n < 4 || never.n < 4 ? "untestable" : delayed.mean !== null && never.mean !== null && immediate.mean !== null && Math.max(delayed.mean, never.mean) > immediate.mean ? "confirmed" : "rejected";
  return [
    "## H3 Rebalance timing",
    "",
    `**${verdict}.** Spot wide two-sided. Immediate rebalance mean net ${usd(immediate.mean)} (n=${immediate.n}). Rebalance after 6 hours out of range ${usd(delayed.mean)} (n=${delayed.n}). No rebalance, 48-hour close, single bin array ${usd(never.mean)} (n=${never.n}). The brief's extra gate, rebalance only when expected fees exceed the cost, is untestable without a fee forecast. Meteora's ` + "`rebalance_liquidity`" + ` instruction may be cheaper than close plus reopen; that cost was not measured on devnet.`,
    "",
  ].join("\n");
}

function h4(): string {
  return [
    "## H4 Bin-array rent only when the array is new",
    "",
    "**Partial.** `@meteora-ag/dlmm` sets `MAX_BIN_PER_ARRAY` to 70, `BIN_ARRAY_FEE` to 0.07143744 SOL, and charges that rent only for accounts that do not yet exist (`uninitializedBinArrayCount`). Position rent is 0.05740608 SOL. The brief's 0.075 and 0.059 figures are rounded. This backtest charges every array except the one holding the active bin, and it does not read `getBinArrays`. Historical account existence is untestable from candles. Single-array grid cells are clipped so they cover no second array.",
    "",
  ].join("\n");
}

function h5(sweep: SizeSweepRow[]): string {
  if (sweep.length === 0) {
    return ["## H5 Position size", "", "**Untestable.** No broad Spot series was available for the size sweep.", ""].join("\n");
  }
  const ordered = [...sweep].sort((a, b) => a.sizeUsd - b.sizeUsd);
  const small = ordered[0];
  const large = ordered[ordered.length - 1];
  const verdict = small && large && small.meanNetUsd !== null && large.meanNetUsd !== null && small.n >= 3
    ? small.meanNetUsd < 0 && large.meanNetUsd > small.meanNetUsd
      ? "confirmed"
      : "rejected"
    : "untestable";
  const rows = ordered.map((row) => `- $${row.sizeUsd}: mean net ${usd(row.meanNetUsd)} over ${row.n} pools`).join("\n");
  return [
    "## H5 Minimum size",
    "",
    `**${verdict}.** The same broad Spot stay cell replayed at several deposits. Fixed rent and fees hurt the small deposit more if the verdict is confirmed. This is one cell and one pool per bucket, not the whole grid.`,
    "",
    rows,
    "",
  ].join("\n");
}

function h6(): string {
  return [
    "## H6 Position rent is locked capital",
    "",
    "**Confirmed.** `pnlCostUsd` includes transaction fees, non-refundable bin-array rent, and exit slippage. Refundable position-account rent is reported separately and is not subtracted from PnL. The SDK's `POSITION_FEE` is 0.05740608 SOL per position account.",
    "",
  ].join("\n");
}

function h7(input: HypothesisReportInput): string {
  const pools = new Map(input.pools.map((pool) => [pool.address, pool]));
  const flagged = new Set<string>();
  for (const pool of input.pools) {
    const risky = [pool.tokenX, pool.tokenY].filter((token) => !isQuoteToken(token));
    const holders = risky.reduce<number | null>((lowest, token) => {
      if (token.holders === null) return lowest;
      return lowest === null ? token.holders : Math.min(lowest, token.holders);
    }, null);
    const freeze = risky.some((token) => token.freezeAuthorityDisabled === false);
    const thin = pool.tvlUsd < 5_000;
    if (pool.isBlacklisted || freeze || (holders !== null && holders <= 100) || thin) flagged.add(pool.address);
  }
  const rows = input.trials.filter((trial) => trial.strategyId === "grid-spot-medium-two-stay-array" && trial.split === "train");
  const bad = rows.filter((trial) => flagged.has(trial.poolAddress));
  const good = rows.filter((trial) => !flagged.has(trial.poolAddress));
  const badMean = mean(bad.map((trial) => trial.netPnlUsd));
  const goodMean = mean(good.map((trial) => trial.netPnlUsd));
  const verdict = bad.length < 3 || good.length < 3 ? "untestable" : goodMean !== null && badMean !== null && goodMean > badMean ? "confirmed" : "rejected";
  return [
    "## H7 Meteora blacklist-style filters",
    "",
    `**${verdict}.** Flagged pools are blacklisted, have freeze authority enabled, have 100 or fewer holders, or have TVL under $5,000. Train mean net on the single-array Spot stay cell: flagged ${usd(badMean)} (n=${bad.length}), others ${usd(goodMean)} (n=${good.length}). Discovery already drops Meteora's \`is_blacklisted\` pools, so that clause has almost no in-sample contrast. Top-holder percentages and "dev is the LP" are not in the pool list payload, so those two blacklist clauses are untestable here. The paper rug gate's holder floor is 100, matching the published criterion, and TVL under $5,000 still fails.`,
    "",
  ].join("\n");
}

function h8(): string {
  return [
    "## H8 Trader concentration",
    "",
    "**Untestable.** The pool list, OHLCV, and volume-history endpoints do not include swapper addresses. A top-5 trader share needs `Swap2Evt` or a paid swap tape. It is not in this run.",
    "",
  ].join("\n");
}

function h9(input: HypothesisReportInput): string {
  const plain = tail(input, "grid-spot-broad-two-stay");
  const guard = tail(input, "grid-spot-broad-two-guard");
  const verdict = plain.n < 4 || guard.n < 4 || plain.p5 === null || guard.p5 === null
    ? "untestable"
    : guard.p5 > plain.p5
      ? "confirmed"
      : "rejected";
  return [
    "## H9 Composite exit",
    "",
    `**${verdict}.** The guard closes when equity is 8% off its peak and the candle's volume is under a quarter of the prior median. It does not see TVL-drain events or a live RugCheck change; those are untestable from candles. Broad Spot stay return 5th percentile ${pct(plain.p5)} (n=${plain.n}) versus the guard ${pct(guard.p5)} (n=${guard.n}). Mean net ${usd(plain.mean)} versus ${usd(guard.mean)}.`,
    "",
  ].join("\n");
}

function bidAsk(input: HypothesisReportInput): string {
  const rows = input.trials.filter((trial) => trial.strategyId.startsWith("grid-bidask-") && trial.split === "holdout");
  const single = rows.filter((trial) => trial.strategyId.includes("-quote-") || trial.strategyId.includes("-token-"));
  const beat = single.filter((trial) => (trial.vsTokenUsd ?? 0) > 0).length;
  return `Bid-Ask is excluded from promotion. Holdout trials: ${rows.length}. Single-sided holdout trials ahead of holding the token: ${beat}/${single.length}. That comparison is the market-sell alternative at the window's end price, not a TWAP.`;
}

function stats(input: HypothesisReportInput, strategyId: string): { n: number; mean: number | null } {
  const rows = input.trials.filter((trial) => trial.strategyId === strategyId && trial.split !== "test");
  return { n: rows.length, mean: mean(rows.map((trial) => trial.netPnlUsd)) };
}

function tail(input: HypothesisReportInput, strategyId: string): { n: number; mean: number | null; p5: number | null } {
  const rows = input.trials.filter((trial) => trial.strategyId === strategyId && trial.split !== "test");
  const returns = rows.map((trial) => trial.returnPct).sort((a, b) => a - b);
  return { n: rows.length, mean: mean(rows.map((trial) => trial.netPnlUsd)), p5: returns.length === 0 ? null : quantile(returns, 0.05) };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0] ?? 0;
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const low = sorted[lo] ?? 0;
  const high = sorted[hi] ?? low;
  if (lo === hi) return low;
  return low + (high - low) * (rank - lo);
}

function usd(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "n/a";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function pct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "n/a";
  return `${(value * 100).toFixed(2)}%`;
}

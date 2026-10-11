import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getJson, sleep } from "../http.js";
import { assumedLiquidityBins } from "../math/activeBin.js";
import { COST_MODEL_VERSION, liquidationCost, liquidationCostAllNonSol, tokenLegToSol } from "../math/costs.js";
import { fetchDlmmPool } from "../scanner/meteora.js";
import type { StrategyConfig } from "../strategy/schema.js";
import type { CoinType, DiscoveredPool } from "../types.js";
import { replayStrategy, splitCandles, type TerminalState, type TrialResult } from "./backtest.js";
import { fetchCandleSeries } from "./candles.js";
import { classifyPool, sampleKey } from "./classify.js";
import { alignedAggregateDrawdown, distribution, topCoinShare, type CoinProfit, type Distribution } from "./stats.js";

const TIKTOK_POOL = "5k7rNmiq9bYbnvNmnGuz53PRVxFwL6Zy377kbPE6fJ5m";

interface SampleRow {
  coinType: CoinType;
  name: string;
  address: string;
  role?: "train" | "holdout";
  skippedReason?: string;
}

interface PricedTrial {
  trial: TrialResult;
  key: string;
  label: string;
}

export interface EdgeReport {
  markdown: string;
  tiktok: string;
}

/**
 * Replays the frozen high-vol strategy on the pools already accepted by the
 * leaderboard. Four measurements: TVL fee share or active-bin share, each
 * with and without exit costs. Costs are applied to terminal equity only.
 */
export async function runHighVolEdge(options: {
  leaderboardPath: string;
  strategy: StrategyConfig;
  nowMs: number;
  sizeUsd?: number;
  solPriceUsd: number;
  outPath: string;
  onProgress?: (message: string) => void;
}): Promise<EdgeReport> {
  const sizeUsd = options.sizeUsd ?? 250;
  const log = options.onProgress ?? (() => {});
  const raw = JSON.parse(readFileSync(options.leaderboardPath, "utf8")) as { samples?: SampleRow[] };
  const samples = (raw.samples ?? []).filter((sample) => sample.coinType === "high-vol-trending" && !sample.skippedReason && sample.role);
  const grossShare: PricedTrial[] = [];
  const grossBin: PricedTrial[] = [];
  const netShare: PricedTrial[] = [];
  const netBin: PricedTrial[] = [];
  const notes: string[] = [];

  for (const sample of samples) {
    log(`Edge ${sample.role} ${sample.name}`);
    const pool = await fetchDlmmPool(sample.address);
    await sleep(120);
    if (!pool || pool.binStep === null) {
      notes.push(`${sample.name}: pool fetch failed`);
      continue;
    }
    let series;
    try {
      series = await fetchCandleSeries(pool, options.nowMs);
    } catch (error) {
      notes.push(`${sample.name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    await sleep(120);
    if (series.candles.length < 8) {
      notes.push(`${sample.name}: only ${series.candles.length} candles`);
      continue;
    }
    const bins = assumedLiquidityBins(pool);
    const key = sampleKey(pool);
    const windows = sample.role === "holdout"
      ? [{ candles: series.candles, split: "holdout" as const }]
      : (() => {
          const split = splitCandles(series.candles);
          return [
            { candles: split.train, split: "train" as const },
            { candles: split.test, split: "test" as const },
          ];
        })();
    for (const window of windows) {
      const share = replayStrategy({
        pool,
        strategy: options.strategy,
        candles: window.candles,
        sizeUsd,
        candleHours: series.candleHours,
        coinType: "high-vol-trending",
        split: window.split,
        feeModel: "tvl-share",
        recordCurve: true,
      });
      const active = replayStrategy({
        pool,
        strategy: options.strategy,
        candles: window.candles,
        sizeUsd,
        candleHours: series.candleHours,
        coinType: "high-vol-trending",
        split: window.split,
        feeModel: "active-bin",
        liquidityBins: bins,
        recordCurve: true,
      });
      if (share) {
        grossShare.push({ trial: share, key, label: pool.name });
        netShare.push({ trial: withCosts(share, pool, options.solPriceUsd, bins), key, label: pool.name });
      }
      if (active) {
        grossBin.push({ trial: active, key, label: pool.name });
        netBin.push({ trial: withCosts(active, pool, options.solPriceUsd, bins), key, label: pool.name });
      }
    }
  }

  const tiktok = await describeTikTok(options.nowMs);
  const jupiter = await jupiterSolImpact();
  const markdown = renderEdge({
    generatedAt: new Date(options.nowMs).toISOString(),
    sizeUsd,
    solPriceUsd: options.solPriceUsd,
    strategy: options.strategy,
    samples: samples.length,
    notes,
    tiktok,
    jupiter,
    blocks: [
      { title: "TVL share, no costs", trials: grossShare },
      { title: "TVL share, with costs", trials: netShare },
      { title: "Active-bin share, no costs", trials: grossBin },
      { title: "Active-bin share, with costs", trials: netBin },
    ],
  });
  mkdirSync(dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, markdown);
  return { markdown, tiktok };
}

export function withCosts(
  trial: TrialResult,
  pool: DiscoveredPool,
  solPriceUsd: number,
  liquidityBins: number,
  costScale = 1,
  swap: "leg" | "all-non-sol" = "leg",
): TrialResult {
  const terminal = trial.terminal;
  if (!terminal) return trial;
  const cost = costForTerminal(terminal, pool, solPriceUsd, liquidityBins, swap);
  const scale = costScale > 0 ? costScale : 1;
  const pnlCostUsd = cost.sunkBinArrayUsd + (cost.exitSlippageUsd + cost.txFeeUsd) * scale;
  const equity = trial.equityUsd - pnlCostUsd;
  const net = equity - trial.depositedUsd;
  const curve = trial.equityCurve?.map((point, index, all) => (
    index === all.length - 1 ? { t: point.t, equity: point.equity - pnlCostUsd } : point
  ));
  let maxDrawdownPct = trial.maxDrawdownPct;
  if (curve && curve.length > 0) {
    let peak = 0;
    let dd = 0;
    for (const point of curve) {
      peak = Math.max(peak, point.equity);
      if (peak > 0) dd = Math.max(dd, (peak - point.equity) / peak);
    }
    maxDrawdownPct = dd;
  }
  return {
    ...trial,
    equityUsd: equity,
    netPnlUsd: net,
    returnPct: trial.depositedUsd > 0 ? net / trial.depositedUsd : 0,
    vsHodlUsd: equity - trial.hodlUsd,
    maxDrawdownPct,
    equityCurve: curve,
  };
}

function costForTerminal(
  terminal: TerminalState,
  pool: DiscoveredPool,
  solPriceUsd: number,
  liquidityBins: number,
  swap: "leg" | "all-non-sol" = "leg",
) {
  if (swap === "all-non-sol") {
    return liquidationCostAllNonSol({
      pool,
      minBinId: terminal.minBinId,
      maxBinId: terminal.maxBinId,
      activeBinId: terminal.activeBinId,
      binStep: terminal.binStep,
      rebalanceCount: terminal.rebalanceCount,
      liquidityBins,
      solPriceUsd,
      amountX: terminal.amountX + terminal.feesX,
      amountY: terminal.amountY + terminal.feesY,
      priceXUsd: terminal.priceXUsd,
      priceYUsd: terminal.priceYUsd,
    });
  }
  const leg = tokenLegToSol(terminal.tokenX, terminal.tokenY);
  const tokenAmount = leg === "x"
    ? terminal.amountX + terminal.feesX
    : leg === "y"
      ? terminal.amountY + terminal.feesY
      : 0;
  return liquidationCost({
    pool,
    minBinId: terminal.minBinId,
    maxBinId: terminal.maxBinId,
    activeBinId: terminal.activeBinId,
    binStep: terminal.binStep,
    rebalanceCount: terminal.rebalanceCount,
    liquidityBins,
    solPriceUsd,
    tokenLeg: leg,
    tokenAmount,
    tokenPriceUsd: leg === "y" ? terminal.priceYUsd : terminal.priceXUsd,
    otherPriceUsd: leg === "y" ? terminal.priceXUsd : terminal.priceYUsd,
  });
}

async function jupiterSolImpact(): Promise<string> {
  try {
    const quote = await getJson<{ priceImpactPct?: string; outAmount?: string }>(
      "https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000&slippageBps=50",
    );
    const impact = Number(quote.priceImpactPct);
    const out = Number(quote.outAmount) / 1e6;
    if (!Number.isFinite(impact) || !Number.isFinite(out)) return "A live Jupiter quote was unavailable.";
    const impactPct = Math.abs(impact) * 100;
    const impactText = impactPct < 0.0001 ? "under 0.0001%" : `${impactPct.toFixed(4)}%`;
    return `A live Jupiter quote of 1 SOL to USDC returned about $${out.toFixed(2)} with price impact ${impactText}, which is why the stablecoin-to-SOL hop uses a deep-book estimate instead of meme-pool depth.`;
  } catch {
    return "A live Jupiter quote was unavailable, so the stablecoin hop stays on the depth model.";
  }
}

async function describeTikTok(nowMs: number): Promise<string> {
  const pool = await fetchDlmmPool(TIKTOK_POOL);
  if (!pool) return `TikTok-SOL (${TIKTOK_POOL}) could not be fetched. In the forward book it was opened as fresh-memecoin.`;
  const classified = classifyPool(pool, nowMs);
  const age = classified.features.ageHours;
  return [
    `TikTok-SOL (${pool.name}, ${TIKTOK_POOL}) is classified as **${classified.type}** at ${new Date(nowMs).toISOString()}.`,
    `Pool age ${age.toFixed(1)} hours. The fresh-memecoin rule is age under 24 hours, and it wins over high-vol.`,
    classified.reasons.join(" "),
    "The original forward book opened it in the fresh-memecoin bucket on 2026-10-09, while the pool was under a day old.",
  ].join(" ");
}

function renderEdge(params: {
  generatedAt: string;
  sizeUsd: number;
  solPriceUsd: number;
  strategy: StrategyConfig;
  samples: number;
  notes: string[];
  tiktok: string;
  jupiter: string;
  blocks: Array<{ title: string; trials: PricedTrial[] }>;
}): string {
  const lines: string[] = [];
  lines.push("# High-vol winner edge");
  lines.push("");
  lines.push(`Generated ${params.generatedAt}. Paper only. Strategy \`${params.strategy.id}\`. Deposit $${params.sizeUsd}. SOL marked at $${params.solPriceUsd.toFixed(2)} for rent and priority fees. Cost model ${COST_MODEL_VERSION}. ${params.samples} leaderboard pools were requested.`);
  lines.push("");
  lines.push("The promoted cell is Bid-Ask, wide (40 bins on the quote side), close when the active bin leaves the range, 8% stop, 15% take-profit. Train is the first 70% of each train coin. Time-split is the last 30% of those same coins. Holdout coins are absent from both.");
  lines.push("");
  lines.push("## Fee share");
  lines.push("");
  lines.push("The leaderboard model gives the whole in-range position a share of the candle's LP fees equal to position value / pool TVL. It does not look at which bin is active. A wide Bid-Ask therefore earns the same fee rate as a position that sits entirely in the active bin, until it goes out of range.");
  lines.push("");
  lines.push("The active-bin model pays fees only to liquidity in the active bin. Pool TVL is spread evenly across both sides of a one-day move (at least 20 bins, using the frozen 24h price change). Our share of a candle slice is our dollars in that bin divided by the pool's dollars in that bin, capped at 100%. Bid-Ask puts its largest weight on the outer bins, so the active bin is thin and the fee estimate falls.");
  lines.push("");
  lines.push("## Costs");
  lines.push("");
  lines.push(`Exit sells the non-SOL token inventory, including unclaimed fees, back to SOL by walking pool bins. Depth is the same uniform TVL split. The pool's current base plus dynamic fee is charged on the input. A non-SOL quote is then sold to SOL against a $10M reserve at 4 bps. Position rent (0.05740608 SOL per account) is refundable on close and is not in the PnL cost. Bin arrays other than the active bin's array cost 0.07143744 SOL each and are not refunded, because the close does not call closeBinArray. Open and close each pay a 5,000-lamport base fee plus a priority fee (0.00004 SOL open, 0.00003 SOL close). Jupiter quotes are live only, so they are not applied to these historical exits. ${params.jupiter}`);
  lines.push("");
  lines.push("## Edge");
  lines.push("");
  lines.push("Dollars are the mean per trial on a $" + params.sizeUsd.toFixed(0) + " deposit. Versus hold compares terminal equity with holding the entry tokens. This strategy deposits only the quote asset, and quote USD is frozen, so holding that entry is flat in USD and versus-hold matches the strategy PnL. Costs are subtracted from the LP result only.");
  lines.push("");
  lines.push("| Measurement | Split | n | Median return | Mean return | Mean PnL | Mean vs hold |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const block of params.blocks) {
    for (const split of ["train", "test", "holdout"] as const) {
      const rows = block.trials.filter((item) => item.trial.split === split).map((item) => item.trial);
      lines.push(`| ${block.title} | ${split === "test" ? "time-split" : split} | ${rows.length} | ${pct(median(rows.map((row) => row.returnPct)))} | ${pct(mean(rows.map((row) => row.returnPct)))} | ${usd(mean(rows.map((row) => row.netPnlUsd)))} | ${usd(mean(rows.map((row) => row.vsHodlUsd)))} |`);
    }
  }
  lines.push("");
  lines.push("## Distribution");
  lines.push("");
  lines.push("Returns are per trial. Drawdown per trial is the peak-to-trough of that trial's equity. The aggregate drawdown lines every trial in the split up at bar 0, as if they were funded together, and keeps a finished trial at its final equity. Train and time-split are separate windows on the same coins, so they are not one portfolio.");
  lines.push("");
  for (const block of [params.blocks[0], params.blocks[3]]) {
    if (!block) continue;
    lines.push(`### ${block.title}`);
    lines.push("");
    lines.push("| Split | n | Mean | Median | 5th percentile | Mean max DD | Worst trial DD | Aggregate DD |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const split of ["train", "test", "holdout"] as const) {
      const rows = block.trials.filter((item) => item.trial.split === split);
      const returns = rows.map((row) => row.trial.returnPct);
      const dds = rows.map((row) => row.trial.maxDrawdownPct);
      const dist = distribution(returns);
      const dd = distribution(dds);
      const agg = alignedAggregateDrawdown(rows.map((row) => row.trial.equityCurve ?? []));
      lines.push(`| ${split === "test" ? "time-split" : split} | ${dist.n} | ${pct(dist.mean)} | ${pct(dist.median)} | ${pct(dist.p5)} | ${pct(dd.mean)} | ${pct(dd.max)} | ${pct(agg.maxDrawdownPct)} |`);
    }
    lines.push("");
    lines.push(profitLine(block.trials));
    lines.push("");
  }
  lines.push("## TikTok-SOL");
  lines.push("");
  lines.push(params.tiktok);
  lines.push("");
  if (params.notes.length > 0) {
    lines.push("## Skipped");
    lines.push("");
    for (const note of params.notes) lines.push(`- ${note}`);
    lines.push("");
  }
  return lines.join("\n");
}

function profitLine(trials: PricedTrial[]): string {
  const parts: string[] = [];
  for (const split of ["train", "test", "holdout"] as const) {
    const rows = trials.filter((item) => item.trial.split === split);
    const coins = coinProfits(rows);
    const share = topCoinShare(coins, 3);
    const names = share.top.map((coin) => `${coin.label} ${usd(coin.netPnlUsd)}`).join("; ") || "none";
    const label = split === "test" ? "time-split" : split;
    parts.push(`${label}: top 3 coins (${names}) are ${pct(share.shareOfNet)} of net PnL and ${pct(share.shareOfPositive)} of positive coin PnL.`);
  }
  return parts.join(" ");
}

function coinProfits(trials: PricedTrial[]): CoinProfit[] {
  const map = new Map<string, CoinProfit>();
  for (const item of trials) {
    const current = map.get(item.key) ?? { key: item.key, label: item.label, netPnlUsd: 0 };
    current.netPnlUsd += item.trial.netPnlUsd;
    map.set(item.key, current);
  }
  return [...map.values()];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  return distribution(values).median;
}

function pct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function usd(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export function formatDistribution(dist: Distribution): string {
  return `n=${dist.n} mean ${pct(dist.mean)} median ${pct(dist.median)} p5 ${pct(dist.p5)}`;
}

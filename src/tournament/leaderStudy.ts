import { isQuoteToken } from "../markets.js";
import { assumedLiquidityBins } from "../math/activeBin.js";
import { liquidationCost, tokenLegToSol } from "../math/costs.js";
import { strategyFromCell, type GridCell } from "./grid.js";
import { inventoryAmounts } from "../executor/pnl.js";
import type { CoinType, DiscoveredPool, PaperPosition } from "../types.js";
import { replayStrategy, type TrialResult } from "./backtest.js";
import type { Candle } from "./candles.js";
import { sampleKey } from "./classify.js";
import type { BucketLeaderboard } from "./score.js";
import { distribution, topCoinShare, type Distribution } from "./stats.js";
import { withCosts } from "./edge.js";

export interface StudyWindow {
  coinType: CoinType;
  pool: DiscoveredPool;
  candles: Candle[];
  candleHours: number;
  split: "train" | "test" | "holdout";
  key: string;
  label: string;
}

export interface CostSplit {
  n: number;
  coins: number;
  meanPnlUsd: number | null;
  medianPnlUsd: number | null;
  meanIlUsd: number | null;
  meanSlippageUsd: number | null;
  meanTxRentUsd: number | null;
  meanVsCashUsd: number | null;
  meanVsTokenUsd: number | null;
  beatCash: number;
  beatToken: number;
  volatileTokenTrials: number;
  drawdown: Distribution;
  returns: Distribution;
  topCoinText: string;
  shareOfNet: number | null;
  shareOfPositive: number | null;
}

export interface LeaderStudy {
  coinType: CoinType;
  strategyId: string;
  promoted: boolean;
  sentence: string;
  gross: { train: CostSplit; test: CostSplit; holdout: CostSplit };
  net: { train: CostSplit; test: CostSplit; holdout: CostSplit };
  caution: string;
}

export function describeCell(cell: GridCell): string {
  const exit =
    cell.exit === "oor"
      ? "close as soon as price leaves the range, 12% stop"
      : cell.exit === "timeout"
        ? "close after 12 hours outside the range, 12% stop"
        : cell.exit === "rebalance"
          ? "rebalance when price leaves the range, 18% stop"
          : "close outside the range, 8% stop, 15% take-profit";
  const side = cell.side === "two-sided" ? "two-sided deposit" : cell.side === "quote" ? "quote-only deposit" : "token-only deposit";
  return `${cell.shape}, ${cell.width} range (${cell.binsBelow} bins below the active bin, ${cell.binsAbove} above), ${side}, ${exit}`;
}

/**
 * Replay the leading cell once more so the daily report can subtract exit
 * slippage, sunk bin-array rent, and transaction fees, and can compare with
 * cash and with buying the volatile token.
 */
export function studyLeaders(params: {
  boards: BucketLeaderboard[];
  windows: StudyWindow[];
  solPriceUsd: number;
  sizeUsd: number;
}): LeaderStudy[] {
  const studies: LeaderStudy[] = [];
  for (const board of params.boards) {
    const row = board.winner ?? board.rows.find((item) => item.trainRank === 1) ?? [...board.rows].sort((a, b) => (b.train.n ?? 0) - (a.train.n ?? 0)).find((item) => item.train.n > 0);
    const cell = row?.cell;
    if (!row || !cell) continue;
    const strategy = strategyFromCell(cell);
    const mine = params.windows.filter((window) => window.coinType === board.coinType);
    const grossTrials: Array<{ trial: TrialResult; key: string; label: string; tokenHold: number; volatile: boolean; cost: { slippage: number; txRent: number } }> = [];
    const netTrials: typeof grossTrials = [];
    for (const window of mine) {
      const bins = assumedLiquidityBins(window.pool);
      const played = replayStrategy({
        pool: window.pool,
        strategy,
        candles: window.candles,
        sizeUsd: params.sizeUsd,
        candleHours: window.candleHours,
        coinType: board.coinType,
        split: window.split,
        feeModel: "tvl-share",
        recordCurve: true,
      });
      if (!played) continue;
      const hold = tokenHoldUsd(window.pool, window.candles, params.sizeUsd);
      const cost = costParts(played, window.pool, params.solPriceUsd, bins);
      grossTrials.push({ trial: played, key: window.key, label: window.label, tokenHold: hold.usd, volatile: hold.volatile, cost });
      const net = withCosts(played, window.pool, params.solPriceUsd, bins);
      netTrials.push({ trial: net, key: window.key, label: window.label, tokenHold: hold.usd, volatile: hold.volatile, cost });
    }
    const gross = {
      train: summarize(grossTrials.filter((item) => item.trial.split === "train")),
      test: summarize(grossTrials.filter((item) => item.trial.split === "test")),
      holdout: summarize(grossTrials.filter((item) => item.trial.split === "holdout")),
    };
    const net = {
      train: summarize(netTrials.filter((item) => item.trial.split === "train")),
      test: summarize(netTrials.filter((item) => item.trial.split === "test")),
      holdout: summarize(netTrials.filter((item) => item.trial.split === "holdout")),
    };
    studies.push({
      coinType: board.coinType,
      strategyId: row.strategyId,
      promoted: row.promoted,
      sentence: describeCell(cell),
      gross,
      net,
      caution: cautionFor(board.coinType, row.promoted, net),
    });
  }
  return studies;
}

export function tokenHoldUsd(pool: DiscoveredPool, candles: Candle[], sizeUsd: number): { usd: number; volatile: boolean } {
  const start = candles[0]?.open ?? 0;
  const end = candles[candles.length - 1]?.close ?? 0;
  if (!(start > 0) || !(end > 0)) return { usd: sizeUsd, volatile: false };
  const xQuote = isQuoteToken(pool.tokenX);
  const yQuote = isQuoteToken(pool.tokenY);
  if (xQuote && yQuote) return { usd: sizeUsd, volatile: false };
  if (!xQuote && yQuote) return { usd: sizeUsd * (end / start), volatile: true };
  return { usd: sizeUsd, volatile: false };
}

function costParts(trial: TrialResult, pool: DiscoveredPool, solPriceUsd: number, liquidityBins: number): { slippage: number; txRent: number } {
  const terminal = trial.terminal;
  if (!terminal) return { slippage: 0, txRent: 0 };
  const leg = tokenLegToSol(terminal.tokenX, terminal.tokenY);
  const tokenAmount = leg === "x" ? terminal.amountX + terminal.feesX : leg === "y" ? terminal.amountY + terminal.feesY : 0;
  const cost = liquidationCost({
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
  return { slippage: cost.exitSlippageUsd, txRent: cost.txFeeUsd + cost.sunkBinArrayUsd };
}

function summarize(rows: Array<{ trial: TrialResult; key: string; label: string; tokenHold: number; volatile: boolean; cost: { slippage: number; txRent: number } }>): CostSplit {
  const pnls = rows.map((row) => row.trial.netPnlUsd);
  const coins = new Map<string, { key: string; label: string; netPnlUsd: number }>();
  for (const row of rows) {
    const current = coins.get(row.key) ?? { key: row.key, label: row.label, netPnlUsd: 0 };
    current.netPnlUsd += row.trial.netPnlUsd;
    coins.set(row.key, current);
  }
  const share = topCoinShare([...coins.values()], 3);
  const names = share.top.map((coin) => `${coin.label} ${coin.netPnlUsd >= 0 ? "+" : ""}$${coin.netPnlUsd.toFixed(2)}`).join("; ");
  return {
    n: rows.length,
    coins: coins.size,
    meanPnlUsd: mean(pnls),
    medianPnlUsd: median(pnls),
    meanIlUsd: mean(rows.map((row) => row.trial.ilUsd)),
    meanSlippageUsd: mean(rows.map((row) => row.cost.slippage)),
    meanTxRentUsd: mean(rows.map((row) => row.cost.txRent)),
    meanVsCashUsd: mean(pnls),
    meanVsTokenUsd: mean(rows.map((row) => row.trial.equityUsd - row.tokenHold)),
    beatCash: rows.filter((row) => row.trial.netPnlUsd > 0).length,
    beatToken: rows.filter((row) => row.trial.equityUsd > row.tokenHold).length,
    volatileTokenTrials: rows.filter((row) => row.volatile).length,
    drawdown: distribution(rows.map((row) => row.trial.maxDrawdownPct)),
    returns: distribution(rows.map((row) => row.trial.returnPct)),
    topCoinText: names || "none",
    shareOfNet: share.shareOfNet,
    shareOfPositive: share.shareOfPositive,
  };
}

function cautionFor(coinType: CoinType, promoted: boolean, net: LeaderStudy["net"]): string {
  const notes: string[] = [];
  if (!promoted) notes.push("This cell leads the train window and is not a promoted winner.");
  if (net.test.n < 5 || net.holdout.n < 4) notes.push(`Out-of-sample counts are small (time-split n=${net.test.n}, holdout n=${net.holdout.n}).`);
  if ((net.test.shareOfPositive ?? 0) >= 0.7 || (net.holdout.shareOfPositive ?? 0) >= 0.7) {
    notes.push("Most of the positive PnL sits in three coins, so a few names can dominate the mean.");
  }
  const testSign = Math.sign(net.test.meanPnlUsd ?? 0);
  const testMedian = Math.sign(net.test.medianPnlUsd ?? 0);
  if (net.test.n > 0 && testSign !== 0 && testMedian !== 0 && testSign !== testMedian) {
    notes.push("The time-split mean and median disagree in sign.");
  }
  if ((net.test.meanPnlUsd ?? 0) > 0 && (net.holdout.meanPnlUsd ?? 0) <= 0) {
    notes.push("The time-split mean is positive and the holdout mean is not.");
  }
  if (coinType === "stable" && net.train.n < 8) notes.push("Stablecoins in the public scan still do not fill an 18-coin bucket.");
  return notes.join(" ");
}

export interface ForwardStrategySnapshot {
  n: number;
  open: number;
  closed: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  slippageUsd: number;
  txRentUsd: number;
  vsCashUsd: number;
  vsTokenUsd: number;
  beatCash: number;
  beatToken: number;
  meanReturn: number | null;
  p5Return: number | null;
  worstReturn: number | null;
}

export function forwardStrategySnapshot(params: {
  positions: PaperPosition[];
  strategyId: string;
  pools: Map<string, DiscoveredPool>;
  solPriceUsd: number;
  openedAt: string;
}): ForwardStrategySnapshot {
  const positions = params.positions.filter((position) => position.strategyId === params.strategyId && position.openedAt !== params.openedAt);
  let gross = 0;
  let net = 0;
  let slippage = 0;
  let txRent = 0;
  let vsToken = 0;
  let beatCash = 0;
  let beatToken = 0;
  const returns: number[] = [];
  for (const position of positions) {
    const display = position.status === "closed" ? position.realizedPnlUsd : markGross(position);
    const pool = params.pools.get(position.poolAddress) ?? null;
    const cost = forwardCost(position, pool, params.solPriceUsd);
    const netPnl = display - cost.pnl;
    const equity = position.depositedUsd + netPnl;
    const token = forwardTokenHold(position);
    gross += display;
    net += netPnl;
    slippage += cost.slippage;
    txRent += cost.txRent;
    vsToken += equity - token;
    if (netPnl > 0) beatCash += 1;
    if (equity > token) beatToken += 1;
    if (position.depositedUsd > 0) returns.push(netPnl / position.depositedUsd);
  }
  const dist = distribution(returns);
  return {
    n: positions.length,
    open: positions.filter((position) => position.status === "open").length,
    closed: positions.filter((position) => position.status === "closed").length,
    grossPnlUsd: gross,
    netPnlUsd: net,
    slippageUsd: slippage,
    txRentUsd: txRent,
    vsCashUsd: net,
    vsTokenUsd: vsToken,
    beatCash,
    beatToken,
    meanReturn: dist.mean,
    p5Return: dist.p5,
    worstReturn: dist.min,
  };
}

function markGross(position: PaperPosition): number {
  const amounts = inventoryAmounts(position);
  const mark = amounts.amountX * position.priceXUsd + amounts.amountY * position.priceYUsd;
  return mark + position.claimedFeesUsd + position.feesUsd - position.depositedUsd;
}

function forwardCost(position: PaperPosition, pool: DiscoveredPool | null, solPriceUsd: number): { pnl: number; slippage: number; txRent: number } {
  const standIn = pool ?? {
    ...positionToPool(position),
  };
  const leg = tokenLegToSol(position.tokenX, position.tokenY);
  const amounts = inventoryAmounts(position);
  const tokenAmount = leg === "x" ? amounts.amountX + position.feesX : leg === "y" ? amounts.amountY + position.feesY : 0;
  const cost = liquidationCost({
    pool: standIn,
    minBinId: position.minBinId,
    maxBinId: position.maxBinId,
    activeBinId: position.activeBinId,
    binStep: position.binStep,
    rebalanceCount: position.rebalanceCount,
    liquidityBins: assumedLiquidityBins(standIn),
    solPriceUsd,
    tokenLeg: leg,
    tokenAmount,
    tokenPriceUsd: leg === "y" ? position.priceYUsd : position.priceXUsd,
    otherPriceUsd: leg === "y" ? position.priceXUsd : position.priceYUsd,
  });
  return { pnl: cost.pnlCostUsd, slippage: cost.exitSlippageUsd, txRent: cost.txFeeUsd + cost.sunkBinArrayUsd };
}

function forwardTokenHold(position: PaperPosition): number {
  const xQuote = isQuoteToken(position.tokenX);
  const yQuote = isQuoteToken(position.tokenY);
  if (!xQuote && yQuote && position.entryPrice > 0 && position.lastPrice > 0) {
    return position.depositedUsd * (position.lastPrice / position.entryPrice);
  }
  return position.depositedUsd;
}

function positionToPool(position: PaperPosition): DiscoveredPool {
  return {
    product: "dlmm",
    address: position.poolAddress,
    name: position.poolName,
    tokenX: {
      address: position.tokenX.address,
      symbol: position.tokenX.symbol,
      name: position.tokenX.symbol,
      decimals: position.tokenX.decimals,
      priceUsd: position.priceXUsd,
      holders: null,
      freezeAuthorityDisabled: null,
      isVerified: false,
      marketCapUsd: null,
    },
    tokenY: {
      address: position.tokenY.address,
      symbol: position.tokenY.symbol,
      name: position.tokenY.symbol,
      decimals: position.tokenY.decimals,
      priceUsd: position.priceYUsd,
      holders: null,
      freezeAuthorityDisabled: null,
      isVerified: false,
      marketCapUsd: null,
    },
    tvlUsd: 50_000,
    currentPrice: position.lastPrice,
    binStep: position.binStep,
    baseFeePct: 0.2,
    dynamicFeePct: 0,
    protocolFeePct: null,
    collectFeeMode: position.collectFeeMode,
    createdAtMs: 0,
    volume: {},
    fees: {},
    protocolFees: {},
    feeTvlRatio: {},
    isBlacklisted: false,
    launchpad: "",
    tags: [],
    listSource: "volume",
    market: {
      source: "none",
      dexId: null,
      pairAddress: null,
      priceChangeH1Pct: null,
      priceChangeH24Pct: 25,
      volumeH24Usd: null,
      liquidityUsd: null,
    },
  };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function sampleKeyOf(pool: DiscoveredPool): string {
  return sampleKey(pool);
}

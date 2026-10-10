import { advancePosition, closePaperPosition, openPaperPosition, placeInventoryOnSellSide } from "../executor/paper.js";
import { inventoryAmounts, markValueUsd } from "../executor/pnl.js";
import type { StrategyConfig } from "../strategy/schema.js";
import type { CoinType, DiscoveredPool, PaperPosition } from "../types.js";
import { ohlcPath, type TerminalState, type TrialResult } from "./backtest.js";
import type { Candle } from "./candles.js";

const UNWIND_BINS = 10;

/**
 * Same candle path as the crossed-bin replay, but an out-of-range mark on a
 * book that is at least 70% one token moves that inventory onto a single-sided
 * Bid-Ask for `unwindHours`. The reshape does not swap tokens.
 */
export function replaySkewUnwind(params: {
  pool: DiscoveredPool;
  strategy: StrategyConfig;
  candles: Candle[];
  sizeUsd: number;
  candleHours: number;
  coinType: CoinType;
  split: TrialResult["split"];
  unwindHours: number;
  liquidityBins: number;
}): (TrialResult & { armed: boolean }) | null {
  const candles = params.candles;
  if (candles.length < 2 || params.pool.binStep === null || !(params.pool.tvlUsd > 0)) return null;
  const frozenY = params.pool.tokenY.priceUsd > 0 ? params.pool.tokenY.priceUsd : 1;
  const openPrice = candles[0]?.open ?? 0;
  if (!(openPrice > 0)) return null;
  const patient: StrategyConfig = {
    ...params.strategy,
    exit: {
      ...params.strategy.exit,
      onOutOfRange: "close",
      outOfRangeTimeoutHours: 10_000,
      minHoldHours: null,
    },
  };
  let clock = (candles[0]?.timestamp ?? 0) * 1000;
  let position = openPaperPosition({
    pool: poolAt(params.pool, openPrice, frozenY, candles[0] as Candle, params.candleHours),
    strategy: patient,
    sizeUsd: params.sizeUsd,
    nowMs: clock,
  });
  const initial = inventoryAmounts(position);
  let peak = params.sizeUsd;
  let maxDrawdown = 0;
  let unwindUntil: number | null = null;
  let armed = false;
  const endPrice = candles[candles.length - 1]?.close ?? openPrice;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index] as Candle;
    const path = ohlcPath(candle);
    const points = index === 0 ? path.slice(1) : path[0] === position.lastPrice ? path.slice(1) : path;
    if (points.length === 0) continue;
    const legHours = params.candleHours / points.length;
    for (const price of points) {
      clock += legHours * 3_600_000;
      if (!(price > 0) || position.status !== "open") continue;
      const stepped = advancePosition({
        position,
        pool: poolAt(params.pool, price, frozenY, candle, params.candleHours),
        nowMs: clock,
        elapsedHours: legHours,
        feeModel: "crossed-bins",
        liquidityBins: params.liquidityBins,
      });
      position = stepped.position;
      const equity = equityOf(position, params.sizeUsd);
      peak = Math.max(peak, equity);
      if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
      if (position.status !== "open") continue;
      if (unwindUntil !== null && clock >= unwindUntil) {
        position = closePaperPosition(position, clock, "unwind-timeout");
        continue;
      }
      if (unwindUntil === null && !inRange(position)) {
        if (heavyShare(position) >= 0.7 && placeInventoryOnSellSide(position, UNWIND_BINS)) {
          armed = true;
          unwindUntil = clock + params.unwindHours * 3_600_000;
        } else {
          position = closePaperPosition(position, clock, "out-of-range");
        }
      }
    }
  }

  const markPrice = position.lastPrice > 0 ? position.lastPrice : openPrice;
  const equity = equityOf(position, params.sizeUsd);
  const hodlAtEnd = initial.amountX * endPrice * frozenY + initial.amountY * frozenY;
  const hodlAtMark = initial.amountX * markPrice * frozenY + initial.amountY * frozenY;
  const net = equity - params.sizeUsd;
  return {
    poolAddress: params.pool.address,
    poolName: params.pool.name,
    strategyId: `${params.strategy.id}-unwind-${params.unwindHours}h`,
    coinType: params.coinType,
    split: params.split,
    candles: candles.length,
    depositedUsd: params.sizeUsd,
    equityUsd: equity,
    netPnlUsd: net,
    returnPct: params.sizeUsd > 0 ? net / params.sizeUsd : 0,
    feesUsd: position.feesUsd + position.claimedFeesUsd,
    ilUsd: markValueUsd(position) - hodlAtMark,
    hodlUsd: hodlAtEnd,
    vsHodlUsd: equity - hodlAtEnd,
    maxDrawdownPct: maxDrawdown,
    closeReason: position.closeReason ?? (armed ? "unwind" : null),
    rebalanceCount: position.rebalanceCount,
    terminal: terminalState(position),
    armed,
  };
}

function equityOf(position: PaperPosition, deposited: number): number {
  if (position.status === "closed") return deposited + position.realizedPnlUsd;
  return markValueUsd(position) + position.claimedFeesUsd + position.feesUsd;
}

function inRange(position: PaperPosition): boolean {
  return position.activeBinId >= position.minBinId && position.activeBinId <= position.maxBinId;
}

function heavyShare(position: PaperPosition): number {
  const amounts = inventoryAmounts(position);
  const x = amounts.amountX * position.priceXUsd;
  const y = amounts.amountY * position.priceYUsd;
  const total = x + y;
  if (!(total > 0)) return 0;
  return Math.max(x, y) / total;
}

function terminalState(position: PaperPosition): TerminalState {
  const amounts = inventoryAmounts(position);
  return {
    amountX: amounts.amountX,
    amountY: amounts.amountY,
    feesX: position.feesX,
    feesY: position.feesY,
    priceXUsd: position.priceXUsd,
    priceYUsd: position.priceYUsd,
    activeBinId: position.activeBinId,
    minBinId: position.minBinId,
    maxBinId: position.maxBinId,
    binStep: position.binStep,
    closed: position.status === "closed",
    rebalanceCount: position.rebalanceCount,
    tokenX: { address: position.tokenX.address, symbol: position.tokenX.symbol },
    tokenY: { address: position.tokenY.address, symbol: position.tokenY.symbol },
  };
}

function poolAt(pool: DiscoveredPool, price: number, frozenY: number, candle: Candle, candleHours: number): DiscoveredPool {
  const perHour = candleHours > 0 ? candle.lpFeesUsd / candleHours : 0;
  return {
    ...pool,
    currentPrice: price,
    tokenX: { ...pool.tokenX, priceUsd: price * frozenY },
    tokenY: { ...pool.tokenY, priceUsd: frozenY },
    fees: { ...pool.fees, "1h": perHour },
  };
}

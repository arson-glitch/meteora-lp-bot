import { advancePosition, openPaperPosition } from "../executor/paper.js";
import { inventoryAmounts, markValueUsd } from "../executor/pnl.js";
import type { StrategyConfig } from "../strategy/schema.js";
import type { CoinType, DiscoveredPool, PaperPosition } from "../types.js";
import type { Candle } from "./candles.js";

/**
 * Replays one strategy on one candle window.
 *
 * Path inside a candle: open, then the extreme closer to the open, then the
 * other extreme, then the close. That wick path closes tight ranges on a
 * spike that the close alone would miss. It is a bias, not a trade tape.
 *
 * Fees use estimateLpFeesUsd: candle LP fees × position mark / pool TVL,
 * while the active bin is inside the range. TVL is frozen at the scan value.
 * Quote-token USD is frozen; token X USD moves with the Y-per-X price.
 * One entry at the first open. After an exit the position stays in cash.
 * It does not re-enter. Train and test are separate calls so state does not
 * cross the split.
 */

export const TRAIN_FRACTION = 0.7;
export const MIN_SERIES_CANDLES = 8;

export interface TrialResult {
  poolAddress: string;
  poolName: string;
  strategyId: string;
  coinType: CoinType;
  split: "train" | "test";
  candles: number;
  depositedUsd: number;
  equityUsd: number;
  netPnlUsd: number;
  returnPct: number;
  feesUsd: number;
  ilUsd: number;
  hodlUsd: number;
  vsHodlUsd: number;
  maxDrawdownPct: number;
  closeReason: string | null;
  rebalanceCount: number;
}

export function splitCandles(candles: Candle[], trainFraction = TRAIN_FRACTION): { train: Candle[]; test: Candle[] } {
  const cut = Math.max(1, Math.floor(candles.length * trainFraction));
  return { train: candles.slice(0, cut), test: candles.slice(cut) };
}

export function ohlcPath(candle: Candle): number[] {
  const nearerHigh = Math.abs(candle.high - candle.open) <= Math.abs(candle.low - candle.open);
  const first = nearerHigh ? candle.high : candle.low;
  const second = nearerHigh ? candle.low : candle.high;
  return [candle.open, first, second, candle.close];
}

export function replayStrategy(params: {
  pool: DiscoveredPool;
  strategy: StrategyConfig;
  candles: Candle[];
  sizeUsd: number;
  candleHours: number;
  coinType: CoinType;
  split: "train" | "test";
}): TrialResult | null {
  const { candles } = params;
  if (candles.length < 2) return null;
  if (params.pool.binStep === null || !(params.pool.tvlUsd > 0)) return null;
  const frozenY = params.pool.tokenY.priceUsd > 0 ? params.pool.tokenY.priceUsd : 1;
  const openPrice = candles[0]?.open ?? 0;
  if (!(openPrice > 0)) return null;

  let clock = (candles[0]?.timestamp ?? 0) * 1000;
  let position = openPaperPosition({
    pool: poolAt(params.pool, openPrice, frozenY, candles[0] as Candle, params.candleHours),
    strategy: params.strategy,
    sizeUsd: params.sizeUsd,
    nowMs: clock,
  });
  const initial = inventoryAmounts(position);
  let equity = equityUsd(position);
  let peak = equity;
  let maxDrawdown = 0;
  const endPrice = candles[candles.length - 1]?.close ?? openPrice;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index] as Candle;
    const path = ohlcPath(candle);
    const points = index === 0 ? path.slice(1) : path[0] === position.lastPrice ? path.slice(1) : path;
    if (points.length === 0) continue;
    const legHours = params.candleHours / points.length;
    for (const price of points) {
      clock += legHours * 3_600_000;
      if (!(price > 0)) continue;
      if (position.status !== "open") continue;
      const stepped = advancePosition({
        position,
        pool: poolAt(params.pool, price, frozenY, candle, params.candleHours),
        nowMs: clock,
        elapsedHours: legHours,
      });
      position = stepped.position;
      equity = equityUsd(position);
      peak = Math.max(peak, equity);
      if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    }
  }

  const markPrice = position.lastPrice > 0 ? position.lastPrice : openPrice;
  const hodlAtMark = hodlUsd(initial, markPrice, frozenY);
  const hodlAtEnd = hodlUsd(initial, endPrice, frozenY);
  const fees = position.feesUsd + position.claimedFeesUsd;
  const il = markValueUsd(position) - hodlAtMark;
  const net = equity - params.sizeUsd;
  return {
    poolAddress: params.pool.address,
    poolName: params.pool.name,
    strategyId: params.strategy.id,
    coinType: params.coinType,
    split: params.split,
    candles: candles.length,
    depositedUsd: params.sizeUsd,
    equityUsd: equity,
    netPnlUsd: net,
    returnPct: params.sizeUsd > 0 ? net / params.sizeUsd : 0,
    feesUsd: fees,
    ilUsd: il,
    hodlUsd: hodlAtEnd,
    vsHodlUsd: equity - hodlAtEnd,
    maxDrawdownPct: maxDrawdown,
    closeReason: position.closeReason ?? null,
    rebalanceCount: position.rebalanceCount,
  };
}

function hodlUsd(initial: { amountX: number; amountY: number }, price: number, frozenY: number): number {
  return initial.amountX * price * frozenY + initial.amountY * frozenY;
}

function equityUsd(position: PaperPosition): number {
  if (position.status === "closed") return position.depositedUsd + position.realizedPnlUsd;
  return markValueUsd(position) + position.claimedFeesUsd + position.feesUsd;
}

function poolAt(pool: DiscoveredPool, price: number, frozenY: number, candle: Candle, candleHours: number): DiscoveredPool {
  const perHour = candleHours > 0 ? candle.lpFeesUsd / candleHours : 0;
  return {
    ...pool,
    currentPrice: price,
    tvlUsd: pool.tvlUsd,
    tokenX: { ...pool.tokenX, priceUsd: price * frozenY },
    tokenY: { ...pool.tokenY, priceUsd: frozenY },
    fees: { ...pool.fees, "1h": perHour },
  };
}

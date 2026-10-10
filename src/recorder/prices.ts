import { priceFromBinId } from "../math/bins.js";
import { isStableSymbol } from "../markets.js";
import type { Candle } from "../tournament/candles.js";
import type { TrackedPool } from "./pools.js";

/** Human price of token X in token Y. Raw bin price is in smallest units. */
export function humanPrice(binId: number, binStep: number, decimalsX: number, decimalsY: number): number {
  return priceFromBinId(binId, binStep) * 10 ** (decimalsX - decimalsY);
}

export function uiAmount(raw: string, decimals: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  return value / 10 ** decimals;
}

export interface PricedSwap {
  timeSec: number;
  startBin: number;
  endBin: number;
  swapForY: boolean;
  amountIn: string;
  fee: string;
  feeToken: "x" | "y";
}

/**
 * Fold recorded swaps into the candle shape `replayStrategy` already reads.
 * OHLC is the human pool price. Volume and LP fees are USD at the frozen
 * token prices captured when the pool was added to the tape.
 */
export function swapsToCandles(swaps: PricedSwap[], pool: TrackedPool, candleSeconds = 3600): Candle[] {
  const ordered = [...swaps].sort((a, b) => a.timeSec - b.timeSec);
  const buckets = new Map<number, PricedSwap[]>();
  for (const swap of ordered) {
    const bucket = Math.floor(swap.timeSec / candleSeconds) * candleSeconds;
    const list = buckets.get(bucket);
    if (list) list.push(swap);
    else buckets.set(bucket, [swap]);
  }
  const candles: Candle[] = [];
  for (const [timestamp, group] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last) continue;
    let high = -Infinity;
    let low = Infinity;
    let volumeUsd = 0;
    let lpFeesUsd = 0;
    for (const swap of group) {
      const start = humanPrice(swap.startBin, pool.binStep, pool.decimalsX, pool.decimalsY);
      const end = humanPrice(swap.endBin, pool.binStep, pool.decimalsX, pool.decimalsY);
      high = Math.max(high, start, end);
      low = Math.min(low, start, end);
      const marks = marksFor(pool, end);
      const inputToken = swap.swapForY ? "x" : "y";
      const inputDecimals = inputToken === "x" ? pool.decimalsX : pool.decimalsY;
      const inputPrice = inputToken === "x" ? marks.x : marks.y;
      volumeUsd += uiAmount(swap.amountIn, inputDecimals) * inputPrice;
      const feeDecimals = swap.feeToken === "x" ? pool.decimalsX : pool.decimalsY;
      const feePrice = swap.feeToken === "x" ? marks.x : marks.y;
      lpFeesUsd += uiAmount(swap.fee, feeDecimals) * feePrice;
    }
    const open = humanPrice(first.startBin, pool.binStep, pool.decimalsX, pool.decimalsY);
    const close = humanPrice(last.endBin, pool.binStep, pool.decimalsX, pool.decimalsY);
    candles.push({
      timestamp,
      open,
      high,
      low,
      close,
      volumeUsd,
      lpFeesUsd,
    });
  }
  return candles;
}

function marksFor(pool: TrackedPool, human: number): { x: number; y: number } {
  let x = pool.priceUsdX;
  let y = pool.priceUsdY;
  if (!(y > 0) && isStableSymbol(pool.symbolY)) y = 1;
  if (!(x > 0) && isStableSymbol(pool.symbolX)) x = 1;
  if (!(x > 0) && y > 0 && human > 0) x = human * y;
  if (!(y > 0) && x > 0 && human > 0) y = x / human;
  return { x: x > 0 ? x : 0, y: y > 0 ? y : 0 };
}

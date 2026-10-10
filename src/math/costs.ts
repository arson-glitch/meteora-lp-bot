import { priceFromBinId } from "./bins.js";
import { isQuoteToken } from "../markets.js";
import type { DiscoveredPool } from "../types.js";

/**
 * Paper execution costs for a DLMM round trip, in addition to impermanent loss.
 *
 * Rent figures are the SDK constants POSITION_FEE and BIN_ARRAY_FEE from
 * @meteora-ag/dlmm (0.05740608 SOL and 0.07143744 SOL). Position-account rent
 * comes back when the position is closed. Bin-array rent comes back only if
 * that array is closed while empty. This model does not close bin arrays, and
 * it assumes the array that holds the active bin already exists on a live
 * pool. Any other array the range covers is a sunk cost.
 *
 * Transaction fees are one signature of base fee (5_000 lamports) plus a
 * priority fee of 100_000 microlamports. Open is budgeted at 400_000 CU
 * (0.00004 SOL) and close at 300_000 CU (0.00003 SOL). A claim is bundled
 * into the close. Each rebalance adds one more open-sized transaction.
 *
 * The exit swap sells the non-SOL token inventory, including unclaimed fees
 * in that token, back to SOL. Historical candles have no Jupiter quote, so
 * the sale walks this pool's own bins. Pool TVL is spread evenly across the
 * same bin count the active-bin fee model uses. Each bin is filled before
 * the next. Input pays the pool's current base plus dynamic fee, capped at
 * 10%. Inventory the modelled depth cannot absorb is sold at half the last
 * bin price. If the pool's other leg is not SOL, that quote is then sold to
 * SOL against a $10M SOL reserve at a 4 bps fee. Jupiter's live quote API is
 * point-in-time, so it is a cross-check for today's book, not the backtest.
 */

export const COST_MODEL_VERSION = "2026-10-09";

export const POSITION_RENT_SOL = 0.05740608;
export const BIN_ARRAY_RENT_SOL = 0.07143744;
export const BINS_PER_BIN_ARRAY = 70;

export const BASE_SIGNATURE_SOL = 0.000005;
export const OPEN_PRIORITY_SOL = 0.00004;
export const CLOSE_PRIORITY_SOL = 0.00003;
export const OPEN_TX_SOL = BASE_SIGNATURE_SOL + OPEN_PRIORITY_SOL;
export const CLOSE_TX_SOL = BASE_SIGNATURE_SOL + CLOSE_PRIORITY_SOL;

export const SOL_STABLE_RESERVE_USD = 10_000_000;
export const SOL_STABLE_FEE_FRACTION = 0.0004;
export const SOL_MINT = "So11111111111111111111111111111111111111112";

export interface ExitCost {
  /** Charged in PnL: tx fees, sunk bin-array rent, and exit slippage. */
  pnlCostUsd: number;
  txFeeUsd: number;
  sunkBinArrayUsd: number;
  /** Returned on close, so it is not part of pnlCostUsd. */
  refundableRentUsd: number;
  exitSwapUsd: number;
  exitSlippageUsd: number;
  binArraysCreated: number;
  positionAccounts: number;
}

export function binArrayIndex(binId: number): number {
  const div = Math.trunc(binId / BINS_PER_BIN_ARRAY);
  const mod = binId % BINS_PER_BIN_ARRAY;
  if (binId < 0 && mod !== 0) return div - 1;
  return div;
}

/**
 * Shrink a requested range so every bin stays in the active bin's array.
 * The active array is treated as already existing, so the clipped range pays
 * no extra bin-array rent.
 */
export function clipRangeToBinArray(
  activeBinId: number,
  binsBelow: number,
  binsAbove: number,
): { binsBelow: number; binsAbove: number } {
  const start = binArrayIndex(activeBinId) * BINS_PER_BIN_ARRAY;
  const end = start + BINS_PER_BIN_ARRAY - 1;
  return {
    binsBelow: Math.max(0, Math.min(binsBelow, activeBinId - start)),
    binsAbove: Math.max(0, Math.min(binsAbove, end - activeBinId)),
  };
}

/** Arrays the position covers, excluding the active bin's array. */
export function sunkBinArrayCount(minBinId: number, maxBinId: number, activeBinId: number): number {
  const indexes = new Set<number>();
  const from = Math.min(minBinId, maxBinId);
  const to = Math.max(minBinId, maxBinId);
  for (let id = from; id <= to; id += 1) indexes.add(binArrayIndex(id));
  indexes.delete(binArrayIndex(activeBinId));
  return indexes.size;
}

export function positionAccountCount(minBinId: number, maxBinId: number): number {
  const width = Math.abs(maxBinId - minBinId) + 1;
  return Math.max(1, Math.ceil(width / BINS_PER_BIN_ARRAY));
}

export function poolSwapFeeFraction(pool: Pick<DiscoveredPool, "baseFeePct" | "dynamicFeePct">): number {
  const pct = Math.max(0, (pool.baseFeePct ?? 0) + (pool.dynamicFeePct ?? 0));
  return Math.min(pct / 100, 0.1);
}

/**
 * SDK `computeCompositionFee`: when a deposit removes more X than it adds, the
 * surplus Y is swapped and pays totalFee * (1 + totalFee). Strategy shapes put
 * only one token in each bin, so this is 0 on those deposits. It is not a
 * model of swapping against other LPs' existing reserves.
 */
export function compositionFeeAmount(params: {
  feeRate: number;
  inAmountX: number;
  outAmountX: number;
  inAmountY: number;
  outAmountY: number;
}): number {
  if (!(params.outAmountX > params.inAmountX)) return 0;
  const delta = params.inAmountY - params.outAmountY;
  if (!(delta > 0)) return 0;
  const rate = Math.min(Math.max(params.feeRate, 0), 0.1);
  return delta * rate * (1 + rate);
}

export function isSolToken(token: { address: string; symbol: string }): boolean {
  if (token.address === SOL_MINT) return true;
  const symbol = token.symbol.toUpperCase();
  return symbol === "SOL" || symbol === "WSOL";
}

/**
 * Round-trip cost of a position that is opened and then liquidated.
 * `tokenAmount` is the non-SOL inventory (bins plus unclaimed fees) at exit.
 */
export function liquidationCost(params: {
  pool: DiscoveredPool;
  minBinId: number;
  maxBinId: number;
  activeBinId: number;
  binStep: number;
  rebalanceCount: number;
  liquidityBins: number;
  solPriceUsd: number;
  tokenLeg: "x" | "y" | null;
  tokenAmount: number;
  tokenPriceUsd: number;
  otherPriceUsd: number;
}): ExitCost {
  const sol = params.solPriceUsd > 0 ? params.solPriceUsd : 0;
  const arrays = sunkBinArrayCount(params.minBinId, params.maxBinId, params.activeBinId);
  const accounts = positionAccountCount(params.minBinId, params.maxBinId);
  const txSol = OPEN_TX_SOL + CLOSE_TX_SOL + Math.max(0, params.rebalanceCount) * OPEN_TX_SOL;
  const txFeeUsd = txSol * sol;
  const sunkBinArrayUsd = arrays * BIN_ARRAY_RENT_SOL * sol;
  const refundableRentUsd = accounts * POSITION_RENT_SOL * sol;
  const swap = swapTokenToSol({
    pool: params.pool,
    binStep: params.binStep,
    activeBinId: params.activeBinId,
    liquidityBins: params.liquidityBins,
    tokenLeg: params.tokenLeg,
    tokenAmount: params.tokenAmount,
    tokenPriceUsd: params.tokenPriceUsd,
    otherPriceUsd: params.otherPriceUsd,
  });
  return {
    pnlCostUsd: txFeeUsd + sunkBinArrayUsd + swap.slippageUsd,
    txFeeUsd,
    sunkBinArrayUsd,
    refundableRentUsd,
    exitSwapUsd: swap.proceedsUsd,
    exitSlippageUsd: swap.slippageUsd,
    binArraysCreated: arrays,
    positionAccounts: accounts,
  };
}

export function tokenLegToSol(tokenX: { address: string; symbol: string }, tokenY: { address: string; symbol: string }): "x" | "y" | null {
  const xSol = isSolToken(tokenX);
  const ySol = isSolToken(tokenY);
  if (ySol && !xSol) return "x";
  if (xSol && !ySol) return "y";
  if (!isQuoteToken(tokenX) && isQuoteToken(tokenY)) return "x";
  if (isQuoteToken(tokenX) && !isQuoteToken(tokenY)) return "y";
  return null;
}

export function swapTokenToSol(params: {
  pool: Pick<DiscoveredPool, "baseFeePct" | "dynamicFeePct" | "tokenX" | "tokenY" | "tvlUsd">;
  binStep: number;
  activeBinId: number;
  liquidityBins: number;
  tokenLeg: "x" | "y" | null;
  tokenAmount: number;
  tokenPriceUsd: number;
  otherPriceUsd: number;
}): { proceedsUsd: number; slippageUsd: number } {
  if (!params.tokenLeg || params.tokenAmount <= 0 || params.tokenPriceUsd <= 0) {
    return { proceedsUsd: 0, slippageUsd: 0 };
  }
  const markUsd = params.tokenAmount * params.tokenPriceUsd;
  const fee = poolSwapFeeFraction(params.pool);
  const other = params.tokenLeg === "x"
    ? sellXForY({
        amountX: params.tokenAmount,
        activeBinId: params.activeBinId,
        binStep: params.binStep,
        priceYUsd: params.otherPriceUsd,
        poolTvlUsd: params.pool.tvlUsd,
        liquidityBins: params.liquidityBins,
        feeFraction: fee,
      })
    : sellYForX({
        amountY: params.tokenAmount,
        activeBinId: params.activeBinId,
        binStep: params.binStep,
        priceXUsd: params.otherPriceUsd,
        poolTvlUsd: params.pool.tvlUsd,
        liquidityBins: params.liquidityBins,
        feeFraction: fee,
      });
  let proceedsUsd = other.proceedsUsd;
  const otherIsSol = params.tokenLeg === "x"
    ? isSolToken(params.pool.tokenY)
    : isSolToken(params.pool.tokenX);
  if (!otherIsSol) proceedsUsd = stableToSolProceeds(proceedsUsd);
  const slippageUsd = Math.max(0, markUsd - proceedsUsd);
  return { proceedsUsd, slippageUsd };
}

export function sellXForY(params: {
  amountX: number;
  activeBinId: number;
  binStep: number;
  priceYUsd: number;
  poolTvlUsd: number;
  liquidityBins: number;
  feeFraction: number;
}): { proceedsY: number; proceedsUsd: number } {
  return walk({
    amount: params.amountX,
    activeBinId: params.activeBinId,
    binStep: params.binStep,
    direction: -1,
    reserveUsd: params.priceYUsd,
    poolTvlUsd: params.poolTvlUsd,
    liquidityBins: params.liquidityBins,
    feeFraction: params.feeFraction,
    priceOf: (bin, step) => priceFromBinId(bin, step),
  });
}

export function sellYForX(params: {
  amountY: number;
  activeBinId: number;
  binStep: number;
  priceXUsd: number;
  poolTvlUsd: number;
  liquidityBins: number;
  feeFraction: number;
}): { proceedsY: number; proceedsUsd: number } {
  return walk({
    amount: params.amountY,
    activeBinId: params.activeBinId,
    binStep: params.binStep,
    direction: 1,
    reserveUsd: params.priceXUsd,
    poolTvlUsd: params.poolTvlUsd,
    liquidityBins: params.liquidityBins,
    feeFraction: params.feeFraction,
    priceOf: (bin, step) => {
      const price = priceFromBinId(bin, step);
      return price > 0 ? 1 / price : 0;
    },
  });
}

function walk(params: {
  amount: number;
  activeBinId: number;
  binStep: number;
  direction: -1 | 1;
  reserveUsd: number;
  poolTvlUsd: number;
  liquidityBins: number;
  feeFraction: number;
  priceOf: (binId: number, binStep: number) => number;
}): { proceedsY: number; proceedsUsd: number } {
  const bins = Math.max(1, Math.floor(params.liquidityBins));
  const poolUsdPerBin = params.poolTvlUsd > 0 ? params.poolTvlUsd / bins : 0;
  const reserve = params.reserveUsd > 0 ? poolUsdPerBin / params.reserveUsd : 0;
  let remaining = params.amount;
  let proceeds = 0;
  let bin = params.activeBinId;
  const fee = Math.min(Math.max(params.feeFraction, 0), 0.1);
  for (let step = 0; step < bins && remaining > 0; step += 1) {
    const price = params.priceOf(bin, params.binStep);
    const capacity = price > 0 ? reserve / price : 0;
    if (capacity <= 0) break;
    const sold = Math.min(remaining, capacity);
    proceeds += sold * price * (1 - fee);
    remaining -= sold;
    if (remaining <= 1e-12) break;
    bin += params.direction;
  }
  if (remaining > 0) {
    const price = params.priceOf(bin, params.binStep);
    proceeds += remaining * price * (1 - fee) * 0.5;
  }
  const proceedsUsd = proceeds * (params.reserveUsd > 0 ? params.reserveUsd : 0);
  return { proceedsY: proceeds, proceedsUsd };
}

export function stableToSolProceeds(usd: number): number {
  if (usd <= 0) return 0;
  const impact = Math.min(usd / SOL_STABLE_RESERVE_USD, 0.5);
  return usd * (1 - SOL_STABLE_FEE_FRACTION) * (1 - impact);
}

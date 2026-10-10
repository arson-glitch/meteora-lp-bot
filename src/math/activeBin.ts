import type { DiscoveredPool, SimBin } from "../types.js";

/**
 * Active-bin fee share.
 *
 * On DLMM, swap fees accrue only to liquidity in the active bin, in proportion
 * to that bin's liquidity. The paper book does not have a historical bin-array
 * snapshot, so pool TVL is spread evenly across an assumed Spot range: both
 * sides of a one-day move, and at least 20 bins. The move is the larger of 10%
 * and the pool's frozen 24h price change. Our deposit is not inside TVL.
 * https://docs.meteora.ag/core-products/dlmm/what-is-dlmm
 */
export function assumedLiquidityBins(pool: Pick<DiscoveredPool, "binStep" | "market">): number {
  const step = pool.binStep && pool.binStep > 0 ? pool.binStep : 100;
  const changePct = Math.abs(pool.market.priceChangeH24Pct ?? 0) / 100;
  const move = Math.max(changePct, 0.1);
  const binsOneSide = Math.log(1 + move) / Math.log(1 + step / 10_000);
  const bins = Math.round(binsOneSide * 2);
  if (!Number.isFinite(bins)) return 20;
  return Math.min(400, Math.max(20, bins));
}

export function activeBinFeeUsd(params: {
  poolLpFeesPerHour: number;
  hours: number;
  poolTvlUsd: number;
  liquidityBins: number;
  bin: SimBin | null;
  priceXUsd: number;
  priceYUsd: number;
}): number {
  if (params.hours <= 0 || params.poolLpFeesPerHour <= 0 || params.poolTvlUsd <= 0) return 0;
  if (!params.bin || params.liquidityBins <= 0) return 0;
  const ourUsd = params.bin.amountX * params.priceXUsd + params.bin.amountY * params.priceYUsd;
  if (ourUsd <= 0) return 0;
  const poolBinUsd = params.poolTvlUsd / params.liquidityBins;
  if (poolBinUsd <= 0) return 0;
  const share = Math.min(ourUsd / poolBinUsd, 1);
  return params.poolLpFeesPerHour * params.hours * share;
}

/**
 * A swap that walks from one bin to another pays a fee in each bin it crosses.
 * The candle's observed LP fee (already net of the protocol share) is split
 * evenly across those bins, then by our liquidity versus the assumed pool
 * liquidity in that bin. A move that stays in one bin matches the active-bin
 * model. This is not a Swap2Evt replay; we do not have historical swap tapes.
 */
export function crossedBinFeeUsd(params: {
  poolLpFeesPerHour: number;
  hours: number;
  poolTvlUsd: number;
  liquidityBins: number;
  bins: SimBin[];
  fromBinId: number;
  toBinId: number;
  priceXUsd: number;
  priceYUsd: number;
}): number {
  if (params.hours <= 0 || params.poolLpFeesPerHour <= 0 || params.poolTvlUsd <= 0) return 0;
  if (params.liquidityBins <= 0) return 0;
  const lo = Math.min(params.fromBinId, params.toBinId);
  const hi = Math.max(params.fromBinId, params.toBinId);
  const crossed = params.bins.filter((bin) => bin.binId >= lo && bin.binId <= hi);
  if (crossed.length === 0) return 0;
  const poolBinUsd = params.poolTvlUsd / params.liquidityBins;
  if (poolBinUsd <= 0) return 0;
  const slice = (params.poolLpFeesPerHour * params.hours) / crossed.length;
  let fee = 0;
  for (const bin of crossed) {
    const ourUsd = bin.amountX * params.priceXUsd + bin.amountY * params.priceYUsd;
    if (ourUsd <= 0) continue;
    fee += slice * Math.min(ourUsd / poolBinUsd, 1);
  }
  return fee;
}

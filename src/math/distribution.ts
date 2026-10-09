import type { Sidedness, StrategyShape } from "../types.js";

/**
 * Liquidity shapes from
 * https://docs.meteora.ag/core-products/dlmm/strategies-and-use-cases
 *
 * The weights follow @meteora-ag/dlmm `toAmountsBothSideByStrategy`:
 * - Spot: flat weight on each side
 * - Curve: weight rises toward the active bin (more size near the market)
 * - BidAsk: weight rises toward the outer bins (inverse of Curve)
 *
 * Two-sided deposits put token Y on [min, active] and token X on
 * [active + 1, max]. Single-sided X puts token X on [active, max], matching
 * the SDK's amountY == 0 path. Single-sided Y puts token Y on [min, active].
 *
 * https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/examples
 */

export interface BinWeight {
  binId: number;
  side: "bid" | "ask";
  weight: number;
}

export function strategyBinWeights(params: {
  shape: StrategyShape;
  minBinId: number;
  maxBinId: number;
  activeBinId: number;
  sidedness: Sidedness;
}): BinWeight[] {
  const { shape, minBinId, maxBinId, activeBinId, sidedness } = params;
  if (minBinId > maxBinId) return [];
  const weights: BinWeight[] = [];

  if (sidedness === "single-sided-x") {
    if (activeBinId <= maxBinId) {
      const from = Math.max(minBinId, activeBinId);
      weights.push(...sideWeights(shape, from, maxBinId, "ask"));
    }
    return weights;
  }

  if (sidedness !== "single-sided-y" && minBinId <= activeBinId) {
    weights.push(...sideWeights(shape, minBinId, activeBinId, "bid"));
  } else if (sidedness === "single-sided-y" && minBinId <= activeBinId) {
    weights.push(...sideWeights(shape, minBinId, Math.min(activeBinId, maxBinId), "bid"));
  }

  if (sidedness === "two-sided" && activeBinId < maxBinId) {
    weights.push(...sideWeights(shape, activeBinId + 1, maxBinId, "ask"));
  }

  return weights;
}

function sideWeights(
  shape: StrategyShape,
  from: number,
  to: number,
  side: "bid" | "ask",
): BinWeight[] {
  if (from > to) return [];
  const ids: number[] = [];
  for (let id = from; id <= to; id += 1) ids.push(id);
  const count = ids.length;
  return ids.map((binId, index) => ({
    binId,
    side,
    weight: weightAt(shape, side, index, count),
  }));
}

function weightAt(shape: StrategyShape, side: "bid" | "ask", index: number, count: number): number {
  if (shape === "Spot") return 1;
  if (shape === "Curve") {
    return side === "bid" ? index + 1 : count - index;
  }
  return side === "bid" ? count - index : index + 1;
}

export function allocateByWeight(total: number, bins: BinWeight[]): Map<number, number> {
  const amounts = new Map<number, number>();
  const sum = bins.reduce((acc, bin) => acc + bin.weight, 0);
  if (total <= 0 || sum <= 0) return amounts;
  for (const bin of bins) amounts.set(bin.binId, (total * bin.weight) / sum);
  return amounts;
}

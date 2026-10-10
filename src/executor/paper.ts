import { randomUUID } from "node:crypto";
import { activeBinFeeUsd, assumedLiquidityBins, crossedBinFeeUsd } from "../math/activeBin.js";
import { binIdFromPrice, priceFromBinId } from "../math/bins.js";
import { clipRangeToBinArray } from "../math/costs.js";
import { allocateByWeight, strategyBinWeights } from "../math/distribution.js";
import { estimateLpFeesUsd } from "../math/fees.js";
import { layoutForStrategy } from "../strategy/sides.js";
import type { StrategyConfig } from "../strategy/schema.js";
import type { DiscoveredPool, PaperPosition, SimBin } from "../types.js";
import { markValueUsd, unrealizedPnlUsd } from "./pnl.js";

export interface PositionPlan {
  activeBinId: number;
  minBinId: number;
  maxBinId: number;
  binCount: number;
  dynamicPosition: boolean;
}

export interface AdvanceResult {
  position: PaperPosition;
  events: Array<{ type: "mark" | "rebalance" | "close"; detail: string }>;
}

/**
 * Paper positions never touch the network. Inventory is distributed with the
 * same Spot / Curve / Bid-Ask ladders the DLMM SDK uses, then marked as the
 * active bin moves. Fees accrue only while the active bin is inside the range.
 * https://docs.meteora.ag/core-products/dlmm/what-is-dlmm
 */
export function planPosition(pool: DiscoveredPool, strategy: StrategyConfig): PositionPlan {
  if (pool.binStep === null) throw new Error("DLMM plan requires a bin step");
  if (!(pool.currentPrice > 0)) throw new Error("DLMM plan requires a positive price");
  const layout = layoutForStrategy(pool, strategy);
  const activeBinId = binIdFromPrice(pool.currentPrice, pool.binStep, "nearest");
  const clipped = strategy.stayInBinArray
    ? clipRangeToBinArray(activeBinId, layout.binsBelow, layout.binsAbove)
    : layout;
  const minBinId = activeBinId - clipped.binsBelow;
  const maxBinId = activeBinId + clipped.binsAbove;
  const binCount = maxBinId - minBinId + 1;
  return {
    activeBinId,
    minBinId,
    maxBinId,
    binCount,
    dynamicPosition: binCount > 70,
  };
}

export function openPaperPosition(params: {
  pool: DiscoveredPool;
  strategy: StrategyConfig;
  sizeUsd: number;
  nowMs: number;
}): PaperPosition {
  const plan = planPosition(params.pool, params.strategy);
  const layout = layoutForStrategy(params.pool, params.strategy);
  const prices = resolvePrices(params.pool);
  const bins = buildBins({
    binStep: params.pool.binStep as number,
    shape: params.strategy.shape,
    sidedness: layout.sidedness,
    minBinId: plan.minBinId,
    maxBinId: plan.maxBinId,
    activeBinId: plan.activeBinId,
    sizeUsd: params.sizeUsd,
    priceXUsd: prices.priceXUsd,
    priceYUsd: prices.priceYUsd,
  });
  const now = new Date(params.nowMs).toISOString();
  const position: PaperPosition = {
    id: `paper-${randomUUID()}`,
    mode: "paper",
    status: "open",
    product: "dlmm",
    poolAddress: params.pool.address,
    poolName: params.pool.name,
    strategyId: params.strategy.id,
    strategyName: params.strategy.name,
    placeholderStrategy: params.strategy.placeholder,
    shape: params.strategy.shape,
    sidedness: layout.sidedness,
    binStep: params.pool.binStep as number,
    binsBelow: layout.binsBelow,
    binsAbove: layout.binsAbove,
    minBinId: plan.minBinId,
    maxBinId: plan.maxBinId,
    activeBinId: plan.activeBinId,
    centeredActiveBinId: plan.activeBinId,
    entryActiveBinId: plan.activeBinId,
    entryPrice: params.pool.currentPrice,
    lastPrice: params.pool.currentPrice,
    priceXUsd: prices.priceXUsd,
    priceYUsd: prices.priceYUsd,
    collectFeeMode: params.pool.collectFeeMode,
    dynamicPosition: plan.dynamicPosition,
    depositedUsd: params.sizeUsd,
    bins,
    feesUsd: 0,
    feesX: 0,
    feesY: 0,
    claimedFeesUsd: 0,
    realizedPnlUsd: 0,
    openedAt: now,
    updatedAt: now,
    lastFeeMarkAt: now,
    rebalanceCount: 0,
    stopLossPct: params.strategy.exit.stopLossPct,
    takeProfitPct: params.strategy.exit.takeProfitPct,
    onOutOfRange: params.strategy.exit.onOutOfRange,
    rebalanceEdgeBins: params.strategy.exit.rebalanceEdgeBins,
    maxHoldHours: params.strategy.exit.maxHoldHours,
    outOfRangeTimeoutHours: params.strategy.exit.outOfRangeTimeoutHours ?? null,
    stayInBinArray: params.strategy.stayInBinArray === true,
    outOfRangeSince: null,
    tokenX: {
      address: params.pool.tokenX.address,
      symbol: params.pool.tokenX.symbol,
      decimals: params.pool.tokenX.decimals,
    },
    tokenY: {
      address: params.pool.tokenY.address,
      symbol: params.pool.tokenY.symbol,
      decimals: params.pool.tokenY.decimals,
    },
  };
  return position;
}

export function advancePosition(params: {
  position: PaperPosition;
  pool: DiscoveredPool;
  nowMs: number;
  elapsedHours?: number;
  /**
   * `tvl-share` is the default: in-range value / pool TVL.
   * `active-bin` pays the pool's LP fees only to the active bin, by that
   * bin's share of an assumed uniform pool distribution.
   * `crossed-bins` splits the same LP fee across every bin the price walked.
   */
  feeModel?: "tvl-share" | "active-bin" | "crossed-bins";
  liquidityBins?: number;
}): AdvanceResult {
  const position = structuredClone(params.position);
  const events: AdvanceResult["events"] = [];
  if (position.status !== "open") return { position, events };
  if (params.pool.binStep === null || !(params.pool.currentPrice > 0)) {
    return { position, events };
  }

  const previousActive = position.activeBinId;
  const prices = resolvePrices(params.pool);
  const nextActive = binIdFromPrice(params.pool.currentPrice, params.pool.binStep, "nearest");
  applyActiveBin(position.bins, nextActive);
  position.activeBinId = nextActive;
  position.lastPrice = params.pool.currentPrice;
  position.priceXUsd = prices.priceXUsd;
  position.priceYUsd = prices.priceYUsd;
  position.updatedAt = new Date(params.nowMs).toISOString();

  const elapsed =
    params.elapsedHours ??
    Math.max(0, (params.nowMs - Date.parse(position.lastFeeMarkAt)) / 3_600_000);
  const wasInRange = inRange(position, previousActive);
  const nowInRange = inRange(position, nextActive);
  const factor = wasInRange && nowInRange ? 1 : wasInRange || nowInRange ? 0.5 : 0;
  const liquidityBins = params.liquidityBins ?? assumedLiquidityBins(params.pool);
  const feeUsd = params.feeModel === "crossed-bins"
    ? crossedBinFeeUsd({
        poolLpFeesPerHour: lpFeesPerHour(params.pool),
        hours: elapsed,
        poolTvlUsd: params.pool.tvlUsd,
        liquidityBins,
        bins: position.bins,
        fromBinId: previousActive,
        toBinId: nextActive,
        priceXUsd: position.priceXUsd,
        priceYUsd: position.priceYUsd,
      })
    : params.feeModel === "active-bin"
    ? activeBinFeeUsd({
        poolLpFeesPerHour: lpFeesPerHour(params.pool),
        hours: elapsed,
        poolTvlUsd: params.pool.tvlUsd,
        liquidityBins,
        bin: position.bins.find((bin) => bin.binId === nextActive) ?? null,
        priceXUsd: position.priceXUsd,
        priceYUsd: position.priceYUsd,
      })
    : estimateLpFeesUsd({
        poolLpFeesPerHour: lpFeesPerHour(params.pool),
        poolTvlUsd: params.pool.tvlUsd,
        positionValueUsd: markValueUsd(position),
        hours: elapsed,
        inRangeFactor: factor,
      });
  creditFees(position, feeUsd);
  position.lastFeeMarkAt = position.updatedAt;
  events.push({
    type: "mark",
    detail: `marked at bin ${nextActive}; simulated ${elapsed.toFixed(2)}h fee accrual $${feeUsd.toFixed(4)}`,
  });

  const pnlPct = position.depositedUsd > 0 ? unrealizedPnlUsd(position) / position.depositedUsd : 0;
  if (pnlPct <= -position.stopLossPct) {
    closePosition(position, params.nowMs, "stop-loss");
    events.push({ type: "close", detail: `stop-loss at ${(pnlPct * 100).toFixed(2)}%` });
    return { position, events };
  }
  if (position.takeProfitPct !== null && pnlPct >= position.takeProfitPct) {
    closePosition(position, params.nowMs, "take-profit");
    events.push({ type: "close", detail: `take-profit at ${(pnlPct * 100).toFixed(2)}%` });
    return { position, events };
  }
  const heldHours = (params.nowMs - Date.parse(position.openedAt)) / 3_600_000;
  if (position.maxHoldHours !== null && heldHours >= position.maxHoldHours) {
    closePosition(position, params.nowMs, "max-hold");
    events.push({ type: "close", detail: `max hold of ${position.maxHoldHours}h reached` });
    return { position, events };
  }
  if (!nowInRange) {
    if (position.onOutOfRange === "rebalance") {
      const delay = position.outOfRangeTimeoutHours ?? 0;
      if (delay > 0 && !outOfRangeTimedOut(position, params.nowMs)) {
        events.push({
          type: "mark",
          detail: `out of range since ${position.outOfRangeSince}; rebalance waits ${delay}h`,
        });
      } else {
        position.outOfRangeSince = null;
        recenter(position, params.pool);
        events.push({ type: "rebalance", detail: delay > 0 ? `recentered after ${delay}h out of range` : "recentered after leaving the range" });
      }
    } else if (outOfRangeTimedOut(position, params.nowMs)) {
      const waited = (position.outOfRangeTimeoutHours ?? 0) > 0;
      closePosition(position, params.nowMs, waited ? "out-of-range-timeout" : "out-of-range");
      events.push({
        type: "close",
        detail: waited
          ? `out of range for ${position.outOfRangeTimeoutHours}h`
          : "active bin left the position range",
      });
    } else {
      events.push({
        type: "mark",
        detail: `out of range since ${position.outOfRangeSince}; timeout ${position.outOfRangeTimeoutHours}h`,
      });
    }
    return { position, events };
  }
  position.outOfRangeSince = null;
  const edge = Math.min(position.activeBinId - position.minBinId, position.maxBinId - position.activeBinId);
  if (
    position.onOutOfRange === "rebalance" &&
    position.activeBinId !== position.centeredActiveBinId &&
    edge <= position.rebalanceEdgeBins
  ) {
    recenter(position, params.pool);
    events.push({ type: "rebalance", detail: `recentered ${edge} bins from the range edge` });
  }
  return { position, events };
}

export function applyActiveBin(bins: SimBin[], activeBinId: number): void {
  for (const bin of bins) {
    if (bin.binId < activeBinId && bin.amountX > 0) {
      bin.amountY += bin.amountX * bin.price;
      bin.amountX = 0;
      bin.side = "bid";
    } else if (bin.binId > activeBinId && bin.amountY > 0 && bin.price > 0) {
      bin.amountX += bin.amountY / bin.price;
      bin.amountY = 0;
      bin.side = "ask";
    }
  }
}

function recenter(position: PaperPosition, pool: DiscoveredPool): void {
  position.claimedFeesUsd += position.feesUsd;
  position.feesUsd = 0;
  position.feesX = 0;
  position.feesY = 0;
  const value = markValueUsd(position);
  if (value < 1) {
    closePosition(position, Date.parse(position.updatedAt), "dust");
    return;
  }
  const activeBinId = position.activeBinId;
  const clipped = position.stayInBinArray
    ? clipRangeToBinArray(activeBinId, position.binsBelow, position.binsAbove)
    : { binsBelow: position.binsBelow, binsAbove: position.binsAbove };
  const minBinId = activeBinId - clipped.binsBelow;
  const maxBinId = activeBinId + clipped.binsAbove;
  position.bins = buildBins({
    binStep: position.binStep,
    shape: position.shape,
    sidedness: position.sidedness,
    minBinId,
    maxBinId,
    activeBinId,
    sizeUsd: value,
    priceXUsd: position.priceXUsd,
    priceYUsd: position.priceYUsd,
  });
  position.minBinId = minBinId;
  position.maxBinId = maxBinId;
  position.centeredActiveBinId = activeBinId;
  position.rebalanceCount += 1;
  position.dynamicPosition = maxBinId - minBinId + 1 > 70;
  if (pool.address !== position.poolAddress) return;
}

export function closePaperPosition(position: PaperPosition, nowMs: number, reason: string): PaperPosition {
  const next = structuredClone(position);
  closePosition(next, nowMs, reason);
  return next;
}

function closePosition(position: PaperPosition, nowMs: number, reason: string): void {
  position.realizedPnlUsd = markValueUsd(position) + position.claimedFeesUsd + position.feesUsd - position.depositedUsd;
  position.status = "closed";
  position.closeReason = reason;
  position.closedAt = new Date(nowMs).toISOString();
  position.updatedAt = position.closedAt;
}

function creditFees(position: PaperPosition, usd: number): void {
  if (usd <= 0) return;
  position.feesUsd += usd;
  if (position.collectFeeMode === 1 && position.priceYUsd > 0) {
    position.feesY += usd / position.priceYUsd;
    return;
  }
  if (position.priceXUsd > 0) position.feesX += usd / 2 / position.priceXUsd;
  if (position.priceYUsd > 0) position.feesY += usd / 2 / position.priceYUsd;
}

function inRange(position: PaperPosition, activeBinId: number): boolean {
  return activeBinId >= position.minBinId && activeBinId <= position.maxBinId;
}

/**
 * A missing or zero timeout keeps the original behaviour: close on the first
 * out-of-range mark. A positive timeout records the first mark and closes
 * only after that many hours, so a dip back into range can cancel the exit.
 */
function outOfRangeTimedOut(position: PaperPosition, nowMs: number): boolean {
  const timeout = position.outOfRangeTimeoutHours ?? null;
  if (timeout === null || timeout <= 0) return true;
  if (!position.outOfRangeSince) position.outOfRangeSince = position.updatedAt;
  const elapsedHours = (nowMs - Date.parse(position.outOfRangeSince)) / 3_600_000;
  return elapsedHours >= timeout;
}

export function lpFeesPerHour(pool: DiscoveredPool): number {
  if ((pool.fees["1h"] ?? 0) > 0) return pool.fees["1h"] ?? 0;
  return (pool.fees["24h"] ?? 0) / 24;
}

export function resolvePrices(pool: DiscoveredPool): { priceXUsd: number; priceYUsd: number } {
  let priceXUsd = pool.tokenX.priceUsd;
  let priceYUsd = pool.tokenY.priceUsd;
  if (priceXUsd <= 0 && priceYUsd > 0 && pool.currentPrice > 0) priceXUsd = pool.currentPrice * priceYUsd;
  if (priceYUsd <= 0 && priceXUsd > 0 && pool.currentPrice > 0) priceYUsd = priceXUsd / pool.currentPrice;
  return { priceXUsd, priceYUsd };
}

function buildBins(params: {
  binStep: number;
  shape: PaperPosition["shape"];
  sidedness: PaperPosition["sidedness"];
  minBinId: number;
  maxBinId: number;
  activeBinId: number;
  sizeUsd: number;
  priceXUsd: number;
  priceYUsd: number;
}): SimBin[] {
  const weights = strategyBinWeights({
    shape: params.shape,
    sidedness: params.sidedness,
    minBinId: params.minBinId,
    maxBinId: params.maxBinId,
    activeBinId: params.activeBinId,
  });
  const bid = weights.filter((weight) => weight.side === "bid");
  const ask = weights.filter((weight) => weight.side === "ask");
  let usdX = 0;
  let usdY = 0;
  if (bid.length > 0 && ask.length > 0) {
    usdX = params.sizeUsd / 2;
    usdY = params.sizeUsd / 2;
  } else if (ask.length > 0) {
    usdX = params.sizeUsd;
  } else {
    usdY = params.sizeUsd;
  }
  const amountX = params.priceXUsd > 0 ? usdX / params.priceXUsd : 0;
  const amountY = params.priceYUsd > 0 ? usdY / params.priceYUsd : 0;
  const xByBin = allocateByWeight(amountX, ask);
  const yByBin = allocateByWeight(amountY, bid);
  const bins: SimBin[] = [];
  for (let binId = params.minBinId; binId <= params.maxBinId; binId += 1) {
    const weight = weights.find((item) => item.binId === binId);
    bins.push({
      binId,
      price: priceFromBinId(binId, params.binStep),
      side: weight?.side ?? "empty",
      weight: weight?.weight ?? 0,
      amountX: xByBin.get(binId) ?? 0,
      amountY: yByBin.get(binId) ?? 0,
    });
  }
  return bins;
}

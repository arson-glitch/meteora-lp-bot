import type { PaperBook, PaperPosition, RiskLimits } from "../types.js";
import { markValueUsd, unrealizedPnlUsd } from "./pnl.js";

export interface OpenRiskDecision {
  ok: boolean;
  sizeUsd: number;
  reasons: string[];
}

export function evaluateOpenRisk(params: {
  book: PaperBook;
  limits: RiskLimits;
  requestedUsd: number;
  poolTvlUsd: number;
  poolVolume24hUsd: number;
  nowMs: number;
}): OpenRiskDecision {
  const reasons: string[] = [];
  const open = params.book.positions.filter((position) => position.status === "open");
  if (open.length >= params.limits.maxOpenPositions) {
    reasons.push(`open positions ${open.length} already at the cap of ${params.limits.maxOpenPositions}`);
  }
  const loss = lossAgainstCap(params.book, params.nowMs);
  if (loss >= params.limits.dailyLossCapUsd) {
    reasons.push(
      `loss $${loss.toFixed(2)} is at the daily cap of $${params.limits.dailyLossCapUsd.toFixed(2)}`,
    );
  }
  if (params.poolTvlUsd < params.limits.minTvlUsd) {
    reasons.push(`pool TVL $${params.poolTvlUsd.toFixed(0)} is below $${params.limits.minTvlUsd}`);
  }
  if (params.poolVolume24hUsd < params.limits.minVolume24hUsd) {
    reasons.push(
      `24h volume $${params.poolVolume24hUsd.toFixed(0)} is below $${params.limits.minVolume24hUsd}`,
    );
  }
  const sizeUsd = Math.min(params.requestedUsd, params.limits.maxPositionUsd);
  if (!(sizeUsd > 0)) reasons.push("position size must be positive");
  return { ok: reasons.length === 0, sizeUsd: sizeUsd > 0 ? sizeUsd : 0, reasons };
}

/**
 * Daily loss cap = today's realized losses + current unrealized losses
 * on open paper positions. Gains do not offset the cap.
 */
export function lossAgainstCap(book: PaperBook, nowMs: number): number {
  const dayStart = utcDayStart(nowMs);
  let loss = 0;
  for (const position of book.positions) {
    if (position.status === "closed") {
      if (position.closedAt && Date.parse(position.closedAt) >= dayStart && position.realizedPnlUsd < 0) {
        loss += -position.realizedPnlUsd;
      }
      continue;
    }
    const unrealized = unrealizedPnlUsd(position);
    if (unrealized < 0) loss += -unrealized;
  }
  return loss;
}

export function utcDayStart(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function positionEquityUsd(position: PaperPosition): number {
  return markValueUsd(position) + position.claimedFeesUsd + position.feesUsd;
}

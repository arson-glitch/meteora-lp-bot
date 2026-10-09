import {
  BPS_DENOMINATOR,
  FEE_DENOMINATOR,
  HOST_FEE_BPS,
  MAX_FEE_RATE,
  PROTOCOL_SHARE_STANDARD_BPS,
} from "../constants.js";

/**
 * Fee formulas from https://docs.meteora.ag/core-products/dlmm/formulas
 *
 * base fee rate = baseFactor * binStep * 10 * 10^baseFeePowerFactor
 * stored in 1e9 precision.
 */
export function baseFeeRate(baseFactor: number, binStep: number, baseFeePowerFactor = 0): number {
  return baseFactor * binStep * 10 * 10 ** baseFeePowerFactor;
}

/**
 * volatility accumulator = min(
 *   volatility reference + |index reference - active id| * 10_000,
 *   max volatility accumulator
 * )
 */
export function volatilityAccumulator(params: {
  volatilityReference: number;
  indexReference: number;
  activeId: number;
  maxVolatilityAccumulator: number;
}): number {
  const raw =
    params.volatilityReference + Math.abs(params.indexReference - params.activeId) * 10_000;
  return Math.min(raw, params.maxVolatilityAccumulator);
}

/**
 * Variable fee is 0 when variable fee control is 0.
 * Otherwise ceil(control * (volatilityAccumulator * binStep)^2 / 1e11).
 */
export function variableFeeRate(params: {
  variableFeeControl: number;
  volatilityAccumulator: number;
  binStep: number;
}): number {
  if (params.variableFeeControl === 0) return 0;
  const movement = params.volatilityAccumulator * params.binStep;
  return Math.ceil((params.variableFeeControl * movement * movement) / 100_000_000_000);
}

/** total fee rate = min(base + variable, MAX_FEE_RATE). MAX_FEE_RATE is 10%. */
export function totalFeeRate(baseRate: number, variableRate: number): number {
  return Math.min(baseRate + variableRate, MAX_FEE_RATE);
}

export function feeRateFromPercent(percent: number): number {
  return Math.round((percent / 100) * FEE_DENOMINATOR);
}

/**
 * Volatility reference decay:
 * - before filter_period: keep the reference
 * - between filter_period and decay_period: accumulator * reduction / 10_000
 * - at or after decay_period: 0
 */
export function nextVolatilityReference(params: {
  elapsed: number;
  filterPeriod: number;
  decayPeriod: number;
  volatilityAccumulator: number;
  volatilityReference: number;
  reductionFactor: number;
}): number {
  if (params.elapsed < params.filterPeriod) return params.volatilityReference;
  if (params.elapsed < params.decayPeriod) {
    return Math.floor((params.volatilityAccumulator * params.reductionFactor) / 10_000);
  }
  return 0;
}

/** protocol fee = floor(trading fee * protocol share bps / 10_000); LP gets the rest. */
export function splitTradingFee(
  tradingFee: number,
  protocolShareBps = PROTOCOL_SHARE_STANDARD_BPS,
): { protocolFee: number; lpFee: number } {
  const protocolFee = Math.floor((tradingFee * protocolShareBps) / BPS_DENOMINATOR);
  return { protocolFee, lpFee: tradingFee - protocolFee };
}

/** host fee = floor(protocol fee * 2_000 / 10_000) when a referral account is present. */
export function hostFeeFromProtocol(protocolFee: number): number {
  return Math.floor((protocolFee * HOST_FEE_BPS) / BPS_DENOMINATOR);
}

/**
 * The DLMM API reports `fees` as the LP slice and `protocol_fees` separately.
 * Their ratio matches the formulas-page split (about 90/10 on standard pools).
 * Fall back to the standard 90% LP share when a window is empty.
 */
export function observedLpFeeShare(lpFees: number, protocolFees: number): number {
  const total = lpFees + protocolFees;
  if (total <= 0) return (BPS_DENOMINATOR - PROTOCOL_SHARE_STANDARD_BPS) / BPS_DENOMINATOR;
  return lpFees / total;
}

/**
 * Paper fee estimate: our in-range liquidity earns a pro-rata share of the
 * pool's observed LP fees. Out-of-range positions earn nothing.
 * https://docs.meteora.ag/core-products/dlmm/what-is-dlmm
 *
 * This does not reproduce per-bin concentration. Tighter ranges show up as
 * going out of range sooner, which is the effect the monitor simulates.
 */
export function estimateLpFeesUsd(params: {
  poolLpFeesPerHour: number;
  poolTvlUsd: number;
  positionValueUsd: number;
  hours: number;
  inRangeFactor: number;
}): number {
  if (params.hours <= 0 || params.inRangeFactor <= 0 || params.poolTvlUsd <= 0) return 0;
  if (params.poolLpFeesPerHour <= 0 || params.positionValueUsd <= 0) return 0;
  const share = Math.min(params.positionValueUsd / params.poolTvlUsd, 1);
  return params.poolLpFeesPerHour * params.hours * share * params.inRangeFactor;
}

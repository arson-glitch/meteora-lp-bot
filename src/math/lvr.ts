import { priceFromBinId } from "./bins.js";
import { strategyBinWeights } from "./distribution.js";

/**
 * Milionis, Moallemi, Roughgarden, Zhang (arXiv:2208.06046): a constant-product
 * pool loses σ²/8 of its value per unit time to arbitrage, before fees.
 * σ is the volatility of log price over that same unit of time.
 * 5% daily vol → 3.125 bp/day. 20% daily vol → 50 bp/day.
 */
export function fullRangeLvrFraction(sigma: number): number {
  if (!(sigma > 0)) return 0;
  return (sigma * sigma) / 8;
}

/**
 * Brief's concentration factor for a range [pLow, pHigh].
 * L = 1 / (1 − √(pLow/pHigh)). A range that reaches 0 has L = 1, matching
 * full-range σ²/8. This is not borrowed leverage.
 *
 * Cartea, Drissi, Monga (arXiv:2309.08431) eq. (3.1) give a different scaling:
 * predictable loss is σ²/(2δ) of wealth, and full range is their δ = 4, so
 * leverage vs full range is 4/δ with δ ≈ (pHigh − pLow) / p. That is about
 * twice this formula for a narrow range. Both are reported. The backtest gate
 * uses the discrete-bin gamma below when it is finite.
 */
export function continuousRangeLeverage(pLow: number, pHigh: number): number {
  if (!(pHigh > pLow) || !(pLow > 0)) return 1;
  const root = Math.sqrt(pLow / pHigh);
  const denominator = 1 - root;
  if (denominator <= 1e-12) return Number.POSITIVE_INFINITY;
  return 1 / denominator;
}

/** Cartea full-range-relative leverage. δ is (pHigh − pLow) / pMid. */
export function carteaLeverage(delta: number): number {
  if (!(delta > 0)) return Number.POSITIVE_INFINITY;
  return 4 / delta;
}

export function rangePrices(binStep: number, binsBelow: number, binsAbove: number): { pLow: number; pHigh: number; delta: number } {
  const pLow = priceFromBinId(-binsBelow, binStep);
  const pHigh = priceFromBinId(binsAbove, binStep);
  const mid = priceFromBinId(0, binStep);
  const delta = mid > 0 ? (pHigh - pLow) / mid : 0;
  return { pLow, pHigh, delta };
}

/**
 * Log-price gamma of a two-sided Spot position on the DLMM bin grid.
 * Inside one bin the price is constant, so curvature exists only when the
 * active bin moves. Leverage is that gamma divided by the full-range σ²/8
 * coefficient: −4 V_xx / V, with x = log price.
 * Returns null when the three marks are not strictly concave.
 */
export function discreteBinLeverage(binStep: number, binsBelow: number, binsAbove: number): number | null {
  const values = [-1, 0, 1].map((shift) => spotValueAt(binStep, binsBelow, binsAbove, shift));
  const mid = values[1];
  if (mid === null || values[0] === null || values[2] === null || !(mid > 0)) return null;
  const dx = Math.log(1 + binStep / 10_000);
  if (!(dx > 0)) return null;
  const vxx = (values[2] - 2 * mid + values[0]) / (dx * dx);
  if (!(vxx < 0)) return null;
  return (-4 * vxx) / mid;
}

function spotValueAt(binStep: number, binsBelow: number, binsAbove: number, activeShift: number): number | null {
  const minBinId = -binsBelow;
  const maxBinId = binsAbove;
  const weights = strategyBinWeights({
    shape: "Spot",
    sidedness: "two-sided",
    minBinId,
    maxBinId,
    activeBinId: 0,
  });
  if (weights.length === 0) return null;
  const bids = weights.filter((weight) => weight.side === "bid");
  const asks = weights.filter((weight) => weight.side === "ask");
  const bidWeight = bids.reduce((sum, weight) => sum + weight.weight, 0);
  const askWeight = asks.reduce((sum, weight) => sum + weight.weight, 0);
  let amountX = 0;
  let amountY = 0;
  for (const weight of bids) {
    const y = bidWeight > 0 ? (0.5 * weight.weight) / bidWeight : 0;
    amountY += y;
  }
  for (const weight of asks) {
    const x = askWeight > 0 ? (0.5 * weight.weight) / askWeight : 0;
    amountX += x / priceFromBinId(weight.binId, binStep);
  }
  // Move the active bin by converting crossed inventory at each bin's price.
  if (activeShift > 0) {
    for (let binId = 1; binId <= activeShift; binId += 1) {
      const price = priceFromBinId(binId, binStep);
      // X that lived in this bin converts to Y at this bin's price.
      const held = xInBin(weights, askWeight, binId, binStep);
      amountX -= held;
      amountY += held * price;
    }
  } else if (activeShift < 0) {
    for (let binId = 0; binId > activeShift; binId -= 1) {
      const price = priceFromBinId(binId, binStep);
      const held = yInBin(weights, bidWeight, binId);
      amountY -= held;
      if (price > 0) amountX += held / price;
    }
  }
  const mark = priceFromBinId(activeShift, binStep);
  return amountX * mark + amountY;
}

function xInBin(weights: ReturnType<typeof strategyBinWeights>, askWeight: number, binId: number, binStep: number): number {
  const weight = weights.find((item) => item.binId === binId && item.side === "ask");
  if (!weight || askWeight <= 0) return 0;
  const xUsd = (0.5 * weight.weight) / askWeight;
  return xUsd / priceFromBinId(binId, binStep);
}

function yInBin(weights: ReturnType<typeof strategyBinWeights>, bidWeight: number, binId: number): number {
  const weight = weights.find((item) => item.binId === binId && item.side === "bid");
  if (!weight || bidWeight <= 0) return 0;
  return (0.5 * weight.weight) / bidWeight;
}

/**
 * Theorem 1 of Cartea, Drissi, Monga, μ = 0 reduction (their eq. 34):
 * δ* = 4γ / (8π − σ²). π and σ² are per day. δ* > 4, or a non-positive
 * denominator, means the pool does not clear predictable loss and the LP withdraws.
 * γ = 5e-7 is the value in their ETH/USDC performance study. γ = 1e-3 is the
 * scale of their figures, where width actually moves.
 */
export const CARTEA_GAMMA_PAPER = 5e-7;
export const CARTEA_GAMMA_FIGURE = 1e-3;

export function carteaSpread(params: { feeYieldPerDay: number; sigmaDaily: number; gamma: number; mu?: number }): number | null {
  const mu = params.mu ?? 0;
  const sigma2 = params.sigmaDaily * params.sigmaDaily;
  const numerator = 2 * params.gamma + mu * mu * sigma2;
  const denominator = 4 * params.feeYieldPerDay - sigma2 / 2 + mu * (mu - sigma2 / 2);
  if (!(numerator > 0) || !(denominator > 0)) return null;
  const delta = numerator / denominator;
  if (!(delta > 0) || delta > 4) return null;
  return delta;
}

/** Each side of a symmetric spread. δ is the full (pHigh − pLow) / p width. */
export function binsForSpread(delta: number, binStep: number): number {
  if (!(delta > 0) || !(binStep > 0)) return 1;
  const step = Math.log(1 + binStep / 10_000);
  if (!(step > 0)) return 1;
  const side = Math.log(1 + delta / 2) / step;
  if (!Number.isFinite(side)) return 1;
  return Math.max(1, Math.min(80, Math.round(side)));
}

/** Lo-MacKinlay variance ratio. q = 12 is 5-minute bars rolled to one hour. VR < 1 is mean-reverting. */
export function varianceRatio(closes: number[], q: number): number | null {
  if (q < 2 || closes.length < q + 3) return null;
  const one = logReturns(closes, 1);
  const slow = logReturns(closes, q);
  const v1 = sampleVariance(one);
  const vq = sampleVariance(slow);
  if (!(v1 > 0) || slow.length < 2) return null;
  return vq / (q * v1);
}

export function realizedSigmaDaily(closes: number[], candleHours: number): number | null {
  const rets = logReturns(closes, 1);
  if (rets.length < 2 || !(candleHours > 0)) return null;
  const variance = sampleVariance(rets);
  if (!(variance > 0)) return null;
  return Math.sqrt(variance * (24 / candleHours));
}

export function feeYieldPerDay(feesUsd: number, tvlUsd: number, days: number): number {
  if (!(feesUsd > 0) || !(tvlUsd > 0) || !(days > 0)) return 0;
  return feesUsd / tvlUsd / days;
}

export function lvrGate(params: { feeYieldPerDay: number; sigmaDaily: number; leverage: number; k: number }): boolean {
  if (!(params.leverage > 0) || !Number.isFinite(params.leverage)) return false;
  const hurdle = params.k * fullRangeLvrFraction(params.sigmaDaily) * params.leverage;
  return params.feeYieldPerDay > hurdle;
}

/** E[fees over T] > 3% + E[LVR over T], as a fraction of position value. */
export function feeClearsHold(params: {
  feeYieldPerDay: number;
  sigmaDaily: number;
  leverage: number;
  holdHours: number;
  costFraction?: number;
}): boolean {
  const days = params.holdHours / 24;
  if (!(days > 0)) return false;
  const fees = params.feeYieldPerDay * days;
  const lvr = fullRangeLvrFraction(params.sigmaDaily) * params.leverage * days;
  return fees > (params.costFraction ?? 0.03) + lvr;
}

function logReturns(closes: number[], stride: number): number[] {
  const out: number[] = [];
  for (let i = stride; i < closes.length; i += 1) {
    const previous = closes[i - stride] ?? 0;
    const next = closes[i] ?? 0;
    if (previous > 0 && next > 0) out.push(Math.log(next / previous));
  }
  return out;
}

function sampleVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

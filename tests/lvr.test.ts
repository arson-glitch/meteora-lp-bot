import { describe, expect, it } from "vitest";
import {
  binsForSpread,
  carteaLeverage,
  carteaSpread,
  CARTEA_GAMMA_FIGURE,
  continuousRangeLeverage,
  discreteBinLeverage,
  feeClearsHold,
  fullRangeLvrFraction,
  lvrGate,
  rangePrices,
  realizedSigmaDaily,
  varianceRatio,
} from "../src/math/lvr.js";

describe("LVR formulas", () => {
  it("matches the constant-product σ²/8 rates in the brief", () => {
    expect(fullRangeLvrFraction(0.05)).toBeCloseTo(0.0003125, 8);
    expect(fullRangeLvrFraction(0.2)).toBeCloseTo(0.005, 8);
  });

  it("uses Cartea's μ=0 spread and a wider bin count when volatility rises", () => {
    const calm = carteaSpread({ feeYieldPerDay: 0.02, sigmaDaily: 0.02, gamma: CARTEA_GAMMA_FIGURE });
    const wider = carteaSpread({ feeYieldPerDay: 0.02, sigmaDaily: 0.15, gamma: CARTEA_GAMMA_FIGURE });
    const withdraw = carteaSpread({ feeYieldPerDay: 0.02, sigmaDaily: 0.5, gamma: CARTEA_GAMMA_FIGURE });
    expect(calm).toBeCloseTo(0.004 / (0.16 - 0.0004), 6);
    expect(wider ?? 0).toBeGreaterThan(calm ?? 0);
    expect(withdraw).toBeNull();
    expect(binsForSpread(calm ?? 0, 20)).toBeGreaterThan(0);
    expect(carteaLeverage(0.04)).toBeCloseTo(100, 6);
  });

  it("reports discrete-bin leverage below the continuous narrow-range factor", () => {
    const prices = rangePrices(100, 2, 2);
    const continuous = continuousRangeLeverage(prices.pLow, prices.pHigh);
    const discrete = discreteBinLeverage(100, 2, 2);
    expect(continuous).toBeGreaterThan(1);
    expect(discrete).not.toBeNull();
    // One-bin finite difference is steeper than the brief's range-wide factor
    // on a 5-bin, 1% grid, and both fall as the range gets wider.
    expect(discrete ?? 0).toBeGreaterThan(continuous);
    expect((discrete ?? 0) / continuous).toBeLessThan(2);
    const widerLev = discreteBinLeverage(100, 30, 30);
    expect(widerLev ?? 0).toBeLessThan(discrete ?? 0);
    expect(widerLev ?? 0).toBeGreaterThan(0);
  });

  it("treats a variance ratio under 1 as chop and gates fee yield against k·LVR", () => {
    const chopped = [1, 1.01, 1, 1.01, 1, 1.01, 1, 1.01, 1, 1.01, 1, 1.01, 1, 1.01, 1];
    expect(varianceRatio(chopped, 2) ?? 1).toBeLessThan(1);
    const sigma = realizedSigmaDaily([100, 110, 90, 105, 95], 24);
    expect(sigma).not.toBeNull();
    expect(lvrGate({ feeYieldPerDay: 0.05, sigmaDaily: 0.1, leverage: 2, k: 1 })).toBe(true);
    expect(lvrGate({ feeYieldPerDay: 0.0001, sigmaDaily: 0.2, leverage: 10, k: 4 })).toBe(false);
    expect(feeClearsHold({ feeYieldPerDay: 0.2, sigmaDaily: 0.05, leverage: 2, holdHours: 72 })).toBe(true);
    expect(feeClearsHold({ feeYieldPerDay: 0.01, sigmaDaily: 0.3, leverage: 8, holdHours: 24 })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  baseFeeRate,
  estimateLpFeesUsd,
  hostFeeFromProtocol,
  nextVolatilityReference,
  observedLpFeeShare,
  splitTradingFee,
  totalFeeRate,
  variableFeeRate,
  volatilityAccumulator,
} from "../src/math/fees.js";
import { PROTOCOL_SHARE_LAUNCH_BPS, PROTOCOL_SHARE_STANDARD_BPS } from "../src/constants.js";

describe("DLMM fee formulas", () => {
  it("computes the base fee in 1e9 precision", () => {
    expect(baseFeeRate(10_000, 10, 0)).toBe(1_000_000);
  });

  it("computes the volatility accumulator and its decay", () => {
    expect(
      volatilityAccumulator({
        volatilityReference: 1_000,
        indexReference: 5,
        activeId: 8,
        maxVolatilityAccumulator: 1_000_000,
      }),
    ).toBe(31_000);
    expect(
      nextVolatilityReference({
        elapsed: 1,
        filterPeriod: 5,
        decayPeriod: 30,
        volatilityAccumulator: 20_000,
        volatilityReference: 1_000,
        reductionFactor: 5_000,
      }),
    ).toBe(1_000);
    expect(
      nextVolatilityReference({
        elapsed: 10,
        filterPeriod: 5,
        decayPeriod: 30,
        volatilityAccumulator: 20_000,
        volatilityReference: 1_000,
        reductionFactor: 5_000,
      }),
    ).toBe(10_000);
    expect(
      nextVolatilityReference({
        elapsed: 30,
        filterPeriod: 5,
        decayPeriod: 30,
        volatilityAccumulator: 20_000,
        volatilityReference: 1_000,
        reductionFactor: 5_000,
      }),
    ).toBe(0);
  });

  it("caps the total fee at 10% and zeroes the variable fee when control is 0", () => {
    expect(
      variableFeeRate({ variableFeeControl: 0, volatilityAccumulator: 50_000, binStep: 25 }),
    ).toBe(0);
    expect(
      variableFeeRate({ variableFeeControl: 5_000, volatilityAccumulator: 10_000, binStep: 10 }),
    ).toBe(500);
    expect(totalFeeRate(90_000_000, 20_000_000)).toBe(100_000_000);
  });

  it("splits protocol and LP fees, including the referral host share", () => {
    expect(splitTradingFee(1_000, PROTOCOL_SHARE_STANDARD_BPS)).toEqual({ protocolFee: 100, lpFee: 900 });
    expect(splitTradingFee(1_000, PROTOCOL_SHARE_LAUNCH_BPS)).toEqual({ protocolFee: 200, lpFee: 800 });
    expect(hostFeeFromProtocol(100)).toBe(20);
    expect(observedLpFeeShare(900, 100)).toBeCloseTo(0.9);
    expect(observedLpFeeShare(0, 0)).toBeCloseTo(0.9);
  });

  it("pays a pro-rata LP fee only while the position is in range", () => {
    expect(
      estimateLpFeesUsd({
        poolLpFeesPerHour: 1_000,
        poolTvlUsd: 100_000,
        positionValueUsd: 1_000,
        hours: 1,
        inRangeFactor: 1,
      }),
    ).toBeCloseTo(10);
    expect(
      estimateLpFeesUsd({
        poolLpFeesPerHour: 1_000,
        poolTvlUsd: 100_000,
        positionValueUsd: 1_000,
        hours: 1,
        inRangeFactor: 0,
      }),
    ).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { feeClassOf, playSlice, signalIndexes, cellPasses, solSideLayout, twoSidedLayout, type PumpEvent } from "../src/tournament/h30.js";
import { token, pool, SOL, USDC, USDT } from "./fixtures.js";
import type { Candle } from "../src/tournament/candles.js";

const MEME = "meme111111111111111111111111111111111111111";

function ratios(count: number, value: number): number[] {
  return Array.from({ length: count }, () => value);
}

function candle(timestamp: number, price: number, volumeUsd: number): Candle {
  return {
    timestamp,
    open: price,
    high: price,
    low: price,
    close: price,
    volumeUsd,
    lpFeesUsd: volumeUsd * 0.01,
  };
}

describe("H30 pump flip", () => {
  it("keeps the fee classes on 1% and at least 2%", () => {
    expect(feeClassOf(1)).toBe("1pct");
    expect(feeClassOf(1.2)).toBe("1pct");
    expect(feeClassOf(1.5)).toBeNull();
    expect(feeClassOf(2)).toBe("ge2");
    expect(feeClassOf(5)).toBe("ge2");
    expect(feeClassOf(0.25)).toBeNull();
  });

  it("builds the signal from earlier bars only", () => {
    const quiet = ratios(40, 0.01);
    const withFutureSpike = [...quiet, 5];
    const signals = signalIndexes(withFutureSpike);
    expect(signals).toEqual([40]);
    expect(signalIndexes(ratios(50, 0.01))).toEqual([]);
  });

  it("places one-sided SOL on the SOL leg and uses 20 or 69 bins", () => {
    const memeSol = pool({
      name: "MEME-SOL",
      tokenX: token("MEME", MEME, 1),
      tokenY: token("SOL", SOL, 100),
      binStep: 100,
      currentPrice: 0.01,
    });
    expect(solSideLayout(memeSol, 20)).toEqual({ sidedness: "single-sided-y", binsBelow: 19, binsAbove: 0 });
    expect(solSideLayout(memeSol, 69)).toEqual({ sidedness: "single-sided-y", binsBelow: 68, binsAbove: 0 });
    expect(twoSidedLayout(20)).toEqual({ sidedness: "two-sided", binsBelow: 10, binsAbove: 9 });
    expect(twoSidedLayout(69)).toEqual({ sidedness: "two-sided", binsBelow: 34, binsAbove: 34 });
    const stable = pool({
      name: "USDC-USDT",
      tokenX: token("USDC", USDC, 1),
      tokenY: token("USDT", USDT, 1),
      binStep: 100,
      currentPrice: 1,
    });
    expect(solSideLayout(stable, 20)).toBeNull();
  });

  it("exits a flat hour on the timeout and a spike on the upside", () => {
    const market = pool({
      name: "MEME-SOL",
      tokenX: token("MEME", MEME, 1),
      tokenY: token("SOL", SOL, 100),
      binStep: 100,
      currentPrice: 0.01,
      tvlUsd: 500_000,
      baseFeePct: 1,
    });
    const flat = Array.from({ length: 12 }, (_, index) => candle(1_700_000_000 + index * 300, 0.01, 1_000));
    const timed = playSlice({
      pool: market,
      candles: flat,
      candleHours: 5 / 60,
      layout: twoSidedLayout(20),
      feeModel: "crossed-bins",
      solPriceUsd: 100,
      strategyId: "h30-test-timeout",
    });
    expect(timed?.exitKind).toBe("timeout");
    expect(timed?.barsHeld).toBe(12);
    expect(timed?.costUsd).toBeGreaterThan(0);

    const spike = [
      candle(1_700_000_000, 0.01, 1_000),
      { ...candle(1_700_000_300, 0.01, 1_000), high: 0.02, close: 0.015 },
    ];
    const up = playSlice({
      pool: market,
      candles: spike,
      candleHours: 5 / 60,
      layout: twoSidedLayout(20),
      feeModel: "active-bin",
      solPriceUsd: 100,
      strategyId: "h30-test-up",
    });
    expect(up?.exitKind).toBe("upside");
    expect(up?.barsHeld).toBe(2);
  });

  it("refuses a pass when one coin is most of the profit or the out-of-sample mean is negative", () => {
    const row = (over: Partial<PumpEvent>): PumpEvent => ({
      poolAddress: "p",
      poolName: "P",
      coinKey: "coin-a",
      feeClass: "1pct",
      side: "two-sided",
      span: 20,
      feeModel: "crossed-bins",
      split: "test",
      exitKind: "timeout",
      barsHeld: 12,
      netPnlUsd: 1,
      returnPct: 0.004,
      vsHoldUsd: 1,
      holdDefined: true,
      maxDrawdownPct: 0.01,
      feesUsd: 2,
      costUsd: 1,
      costPct: 0.004,
      binArrayRentUsd: 0,
      beatCash: true,
      beatHold: true,
      ...over,
    });
    const concentrated = [
      ...Array.from({ length: 8 }, () => row({ coinKey: "winner", netPnlUsd: 20, split: "test" })),
      ...Array.from({ length: 4 }, (_, index) => row({ coinKey: `h${index}`, netPnlUsd: 1, split: "holdout" })),
    ];
    expect(cellPasses(concentrated).pass).toBe(false);
    const negative = [
      ...Array.from({ length: 8 }, (_, index) => row({ coinKey: `t${index}`, netPnlUsd: -5, vsHoldUsd: -4, beatCash: false, beatHold: false, split: "test" })),
      ...Array.from({ length: 4 }, (_, index) => row({ coinKey: `h${index}`, netPnlUsd: -2, vsHoldUsd: -1, beatCash: false, beatHold: false, split: "holdout" })),
    ];
    expect(cellPasses(negative).pass).toBe(false);
  });
});

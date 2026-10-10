import { describe, expect, it } from "vitest";
import { replayStrategy } from "../src/tournament/backtest.js";
import type { Candle } from "../src/tournament/candles.js";
import { withCosts } from "../src/tournament/edge.js";
import {
  activeBinTvlShare,
  calendarCut,
  clusterBootstrapCoinMean,
  entryFeatures,
  featureIsCausal,
  passingIds,
  rollingWindows,
  withoutTopCoins,
} from "../src/tournament/h12walk.js";
import type { StrategyConfig } from "../src/strategy/schema.js";
import { pool } from "./fixtures.js";

function bar(timestamp: number, price: number, high = price, low = price): Candle {
  return {
    timestamp,
    open: price,
    high,
    low,
    close: price,
    volumeUsd: 1_000,
    lpFeesUsd: 10,
  };
}

const strategy: StrategyConfig = {
  id: "tight",
  name: "tight",
  description: "tight spot",
  placeholder: true,
  placeholderNote: "",
  docs: [],
  notes: "",
  product: "dlmm",
  shape: "Spot",
  binsBelow: 2,
  binsAbove: 2,
  sidedness: "two-sided",
  priority: 0,
  manualOnly: false,
  requires: {},
  when: [],
  exit: {
    onOutOfRange: "close",
    rebalanceEdgeBins: 0,
    stopLossPct: 0.9,
    takeProfitPct: null,
    maxHoldHours: null,
    outOfRangeTimeoutHours: null,
  },
};

describe("H12 walk-forward", () => {
  it("keeps the feature window strictly before the entry bar", () => {
    const candles = Array.from({ length: 30 }, (_, index) => bar(1_700_000_000 + index * 86_400, 100 + index));
    const windows = rollingWindows(candles, 24);
    expect(windows.length).toBeGreaterThan(0);
    for (const window of windows) {
      expect(featureIsCausal(window.feature, window.entryTs)).toBe(true);
      expect(window.forward[0]?.timestamp).toBe(window.entryTs);
      expect(window.feature.every((candle) => candle.timestamp < window.entryTs)).toBe(true);
    }
  });

  it("does not let a holdout coin move the quintile cutoff", () => {
    const rows = [
      { id: "a", day: 1, score: 1, holdout: false },
      { id: "b", day: 1, score: 2, holdout: false },
      { id: "c", day: 1, score: 3, holdout: false },
      { id: "d", day: 1, score: 4, holdout: false },
      { id: "e", day: 1, score: 5, holdout: false },
      { id: "f", day: 1, score: 6, holdout: false },
      { id: "g", day: 1, score: 7, holdout: false },
      { id: "h", day: 1, score: 8, holdout: false },
      { id: "i", day: 1, score: 9, holdout: false },
      { id: "j", day: 1, score: 10, holdout: false },
      { id: "z", day: 1, score: 100, holdout: true },
    ];
    const withHoldout = passingIds(rows, 0.2, 10);
    const without = passingIds(rows.filter((row) => row.id !== "z"), 0.2, 10);
    expect(withHoldout.has("z")).toBe(true);
    expect([...withHoldout].filter((id) => id !== "z").sort()).toEqual([...without].sort());
  });

  it("puts the calendar cut on the train side of the day list", () => {
    expect(calendarCut([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(7);
  });

  it("drops the coins with the highest total PnL", () => {
    const rows = [
      { key: "a", net: 50 },
      { key: "a", net: 50 },
      { key: "b", net: 5 },
      { key: "c", net: -1 },
    ];
    const dropped = withoutTopCoins(rows, 1);
    expect(dropped.dropped).toEqual(["a"]);
    expect(dropped.coins).toBe(2);
    expect(dropped.mean).toBe(2);
  });

  it("keeps a constant sample inside its own bootstrap interval", () => {
    const interval = clusterBootstrapCoinMean([[1], [1], [1], [1], [1], [1], [1], [1]], 200, 7);
    expect(interval).not.toBeNull();
    expect(interval?.mean).toBe(1);
    expect(interval?.low).toBe(1);
    expect(interval?.high).toBe(1);
  });

  it("uses only the feature window for sigma and fees", () => {
    const feature = [bar(1, 100), bar(2, 110), bar(3, 105)];
    const future = [bar(4, 50, 50, 50)];
    future[0]!.lpFeesUsd = 10_000;
    const fromFeature = entryFeatures(feature, 24, 10_000);
    const contaminated = entryFeatures([...feature, ...future], 24, 10_000);
    expect(fromFeature).not.toBeNull();
    expect(contaminated).not.toBeNull();
    expect(contaminated!.feeYield).toBeGreaterThan(fromFeature!.feeYield);
  });

  it("closes a tight range on a wick and stays open on the close path", () => {
    const market = pool({
      name: "SOL-USDC",
      binStep: 100,
      currentPrice: 100,
      tvlUsd: 1_000_000,
      fees: { "1h": 1, "24h": 24 },
    });
    const calm = bar(1_700_000_000, 100);
    const wick = bar(1_700_003_600, 100, 180, 100);
    const candles = [calm, wick];
    const spiked = replayStrategy({
      pool: market,
      strategy,
      candles,
      sizeUsd: 250,
      candleHours: 1,
      coinType: "bluechip",
      split: "test",
      feeModel: "crossed-bins",
      liquidityBins: 20,
      path: "wick",
    });
    const closed = replayStrategy({
      pool: market,
      strategy,
      candles,
      sizeUsd: 250,
      candleHours: 1,
      coinType: "bluechip",
      split: "test",
      feeModel: "crossed-bins",
      liquidityBins: 20,
      path: "close",
    });
    expect(spiked?.closeReason).toBe("out-of-range");
    expect(closed?.closeReason).toBeNull();
  });

  it("scales slippage and transaction fees and leaves the 1× cost unchanged in shape", () => {
    const market = pool({
      name: "SOL-USDC",
      binStep: 100,
      currentPrice: 100,
      tvlUsd: 50_000,
      fees: { "1h": 10, "24h": 240 },
    });
    const candles = [bar(1_700_000_000, 100), bar(1_700_086_400, 130, 130, 100)];
    const gross = replayStrategy({
      pool: market,
      strategy: { ...strategy, binsBelow: 8, binsAbove: 8 },
      candles,
      sizeUsd: 250,
      candleHours: 24,
      coinType: "bluechip",
      split: "test",
      feeModel: "crossed-bins",
      liquidityBins: 20,
    });
    expect(gross).not.toBeNull();
    const once = withCosts(gross!, market, 100, 20, 1);
    const twice = withCosts(gross!, market, 100, 20, 2);
    expect(twice.equityUsd).toBeLessThanOrEqual(once.equityUsd);
  });

  it("measures the active bin against pool TVL", () => {
    const share = activeBinTvlShare({
      activeBin: 5,
      bins: [[5, "1000000", "0"], [6, "1000000", "0"]],
      decimalsX: 6,
      decimalsY: 6,
      priceX: 2,
      priceY: 1,
      tvlUsd: 4,
    });
    expect(share).toBeCloseTo(0.5, 6);
  });
});

import { describe, expect, it } from "vitest";
import { strategyBinWeights } from "../src/math/distribution.js";
import { openPaperPosition } from "../src/executor/paper.js";
import { markValueUsd } from "../src/executor/pnl.js";
import type { StrategyConfig } from "../src/strategy/schema.js";
import { pool } from "./fixtures.js";

describe("strategy weights", () => {
  it("matches the SDK ladders: flat, peak at the active bin, peak at the edges", () => {
    const spot = strategyBinWeights({
      shape: "Spot",
      minBinId: 0,
      maxBinId: 4,
      activeBinId: 2,
      sidedness: "two-sided",
    });
    expect(spot.map((bin) => bin.weight)).toEqual([1, 1, 1, 1, 1]);
    expect(spot.map((bin) => bin.side)).toEqual(["bid", "bid", "bid", "ask", "ask"]);

    const curve = strategyBinWeights({
      shape: "Curve",
      minBinId: 0,
      maxBinId: 4,
      activeBinId: 2,
      sidedness: "two-sided",
    });
    expect(curve.map((bin) => bin.weight)).toEqual([1, 2, 3, 2, 1]);

    const bidAsk = strategyBinWeights({
      shape: "BidAsk",
      minBinId: 0,
      maxBinId: 4,
      activeBinId: 2,
      sidedness: "two-sided",
    });
    expect(bidAsk.map((bin) => bin.weight)).toEqual([3, 2, 1, 1, 2]);
  });

  it("puts single-sided Y only on the bid and single-sided X on the ask including the active bin", () => {
    const bid = strategyBinWeights({
      shape: "BidAsk",
      minBinId: 0,
      maxBinId: 4,
      activeBinId: 4,
      sidedness: "single-sided-y",
    });
    expect(bid.every((bin) => bin.side === "bid")).toBe(true);
    expect(bid.at(-1)?.weight).toBeLessThan(bid[0]?.weight ?? 0);

    const ask = strategyBinWeights({
      shape: "BidAsk",
      minBinId: 4,
      maxBinId: 8,
      activeBinId: 4,
      sidedness: "single-sided-x",
    });
    expect(ask[0]?.binId).toBe(4);
    expect(ask.every((bin) => bin.side === "ask")).toBe(true);
    expect(ask.at(-1)?.weight).toBeGreaterThan(ask[0]?.weight ?? 0);
  });

  it("conserves deposited USD at entry", () => {
    const strategy = stubStrategy();
    const position = openPaperPosition({
      pool: pool({ name: "SOL-USDC", currentPrice: 100, binStep: 25 }),
      strategy,
      sizeUsd: 1_000,
      nowMs: Date.UTC(2026, 9, 9),
    });
    expect(markValueUsd(position)).toBeCloseTo(1_000, 6);
    const amountX = position.bins.reduce((sum, bin) => sum + bin.amountX, 0);
    const amountY = position.bins.reduce((sum, bin) => sum + bin.amountY, 0);
    expect(amountX).toBeGreaterThan(0);
    expect(amountY).toBeGreaterThan(0);
  });
});

function stubStrategy(): StrategyConfig {
  return {
    id: "stub",
    name: "Stub",
    description: "",
    placeholder: true,
    placeholderNote: "test",
    docs: ["https://docs.meteora.ag/core-products/dlmm/formulas"],
    notes: "",
    product: "dlmm",
    shape: "Spot",
    binsBelow: 4,
    binsAbove: 4,
    sidedness: "two-sided",
    priority: 1,
    manualOnly: false,
    requires: {},
    when: [],
    exit: {
      onOutOfRange: "close",
      rebalanceEdgeBins: 0,
      stopLossPct: 0.5,
      takeProfitPct: null,
      maxHoldHours: null,
    },
  };
}

import { describe, expect, it } from "vitest";
import { priceFromBinId } from "../src/math/bins.js";
import { advancePosition, openPaperPosition } from "../src/executor/paper.js";
import { inventoryAmounts } from "../src/executor/pnl.js";
import type { StrategyConfig } from "../src/strategy/schema.js";
import type { DiscoveredPool } from "../src/types.js";
import { pool } from "./fixtures.js";

const now = Date.UTC(2026, 9, 9, 12);

describe("paper executor", () => {
  it("accrues a pro-rata share of observed LP fees while price stays in range", () => {
    const market = pool({
      name: "SOL-USDC",
      binStep: 25,
      currentPrice: 100,
      tvlUsd: 100_000,
      fees: { "1h": 1_000, "24h": 20_000 },
    });
    const position = openPaperPosition({
      pool: market,
      strategy: strategy({ binsBelow: 8, binsAbove: 8, stopLossPct: 0.5 }),
      sizeUsd: 1_000,
      nowMs: now,
    });
    const marked = advancePosition({ position, pool: market, nowMs: now + 3_600_000, elapsedHours: 1 });
    expect(marked.position.status).toBe("open");
    expect(marked.position.feesUsd).toBeCloseTo(10, 6);
    expect(marked.events.some((event) => event.type === "mark")).toBe(true);
  });

  it("converts ask-side token X into token Y when the active bin moves up through those bins", () => {
    const market = pool({ name: "SOL-USDC", binStep: 100, currentPrice: 100 });
    const opened = openPaperPosition({
      pool: market,
      strategy: strategy({ binsBelow: 10, binsAbove: 10, onOutOfRange: "close", stopLossPct: 0.9 }),
      sizeUsd: 1_000,
      nowMs: now,
    });
    const before = inventoryAmounts(opened);
    const moved = shift(market, opened.activeBinId + 4);
    const marked = advancePosition({ position: opened, pool: moved, nowMs: now + 60_000, elapsedHours: 0 });
    const after = inventoryAmounts(marked.position);
    expect(marked.position.status).toBe("open");
    expect(after.amountX).toBeLessThan(before.amountX);
    expect(after.amountY).toBeGreaterThan(before.amountY);
  });

  it("closes when the active bin leaves the range", () => {
    const market = pool({ name: "SOL-USDC", binStep: 100, currentPrice: 100 });
    const opened = openPaperPosition({
      pool: market,
      strategy: strategy({ binsBelow: 2, binsAbove: 2, onOutOfRange: "close", stopLossPct: 0.9 }),
      sizeUsd: 1_000,
      nowMs: now,
    });
    const moved = shift(market, opened.activeBinId + 8);
    const marked = advancePosition({ position: opened, pool: moved, nowMs: now + 60_000, elapsedHours: 0 });
    expect(marked.position.status).toBe("closed");
    expect(marked.position.closeReason).toBe("out-of-range");
  });

  it("recenters a rebalancing strategy when price nears the edge", () => {
    const market = pool({ name: "SOL-USDC", binStep: 100, currentPrice: 100 });
    const opened = openPaperPosition({
      pool: market,
      strategy: strategy({
        binsBelow: 5,
        binsAbove: 5,
        onOutOfRange: "rebalance",
        rebalanceEdgeBins: 3,
        stopLossPct: 0.5,
      }),
      sizeUsd: 1_000,
      nowMs: now,
    });
    const moved = shift(market, opened.activeBinId + 4);
    const marked = advancePosition({ position: opened, pool: moved, nowMs: now + 60_000, elapsedHours: 0 });
    expect(marked.position.status).toBe("open");
    expect(marked.position.rebalanceCount).toBe(1);
    expect(marked.position.activeBinId).toBe(marked.position.centeredActiveBinId);
    expect(marked.position.activeBinId - marked.position.minBinId).toBe(5);
  });

  it("stop-losses a large adverse move before treating it as a normal exit", () => {
    const market = pool({ name: "SOL-USDC", binStep: 100, currentPrice: 100 });
    const opened = openPaperPosition({
      pool: market,
      strategy: strategy({ binsBelow: 20, binsAbove: 20, onOutOfRange: "close", stopLossPct: 0.1 }),
      sizeUsd: 1_000,
      nowMs: now,
    });
    const crashed = shift(market, opened.activeBinId - 40);
    const marked = advancePosition({ position: opened, pool: crashed, nowMs: now + 60_000, elapsedHours: 0 });
    expect(marked.position.status).toBe("closed");
    expect(marked.position.closeReason).toBe("stop-loss");
    expect(marked.position.realizedPnlUsd).toBeLessThan(0);
  });

  it("earns nothing for an hour spent fully out of range", () => {
    const market = pool({
      name: "SOL-USDC",
      binStep: 100,
      currentPrice: 100,
      tvlUsd: 100_000,
      fees: { "1h": 5_000 },
    });
    const opened = openPaperPosition({
      pool: market,
      strategy: strategy({ binsBelow: 2, binsAbove: 2, onOutOfRange: "close", stopLossPct: 0.99, maxHoldHours: null }),
      sizeUsd: 1_000,
      nowMs: now,
    });
    const moved = shift(market, opened.activeBinId + 8);
    const first = advancePosition({ position: opened, pool: moved, nowMs: now + 1_000, elapsedHours: 0 });
    expect(first.position.status).toBe("closed");
    const second = advancePosition({
      position: { ...first.position, status: "open", closeReason: undefined, closedAt: undefined },
      pool: moved,
      nowMs: now + 3_600_000,
      elapsedHours: 1,
    });
    expect(second.position.feesUsd).toBe(0);
  });
});

function shift(market: DiscoveredPool, binId: number): DiscoveredPool {
  const price = priceFromBinId(binId, market.binStep ?? 100);
  return pool({
    ...market,
    currentPrice: price,
    tokenX: { ...market.tokenX, priceUsd: price * market.tokenY.priceUsd },
  });
}

function strategy(
  over: Partial<StrategyConfig["exit"]> & { binsBelow: number; binsAbove: number },
): StrategyConfig {
  return {
    id: "test",
    name: "Test",
    description: "",
    placeholder: true,
    placeholderNote: "placeholder",
    docs: ["https://docs.meteora.ag/core-products/dlmm/formulas"],
    notes: "",
    product: "dlmm",
    shape: "Spot",
    sidedness: "two-sided",
    priority: 1,
    manualOnly: false,
    requires: {},
    when: [],
    exit: {
      onOutOfRange: over.onOutOfRange ?? "close",
      rebalanceEdgeBins: over.rebalanceEdgeBins ?? 0,
      stopLossPct: over.stopLossPct ?? 0.2,
      takeProfitPct: null,
      maxHoldHours: over.maxHoldHours === undefined ? 10_000 : over.maxHoldHours,
    },
    binsBelow: over.binsBelow,
    binsAbove: over.binsAbove,
  };
}

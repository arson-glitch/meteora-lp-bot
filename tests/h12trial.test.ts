import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import type { Candle } from "../src/tournament/candles.js";
import { h12TrialHash, loadH12Trial, rankH12Candidates } from "../src/tournament/h12trial.js";
import { compareFeeModels } from "../src/tournament/validateFees.js";
import { pool } from "./fixtures.js";

function days(start: number, count: number, price: number, fee = 100): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: start + index * 86_400,
    open: price,
    high: price * 1.01,
    low: price * 0.99,
    close: price * (1 + index * 0.001),
    volumeUsd: 10_000,
    lpFeesUsd: fee,
  }));
}

describe("H12 paper trial", () => {
  it("loads the frozen trial and keeps the rule hash", () => {
    const trial = loadH12Trial(resolve(process.cwd(), "strategies/frozen/h12-trial-2026-10-10.json"));
    expect(trial.status).toBe("trial, not promoted");
    expect(trial.rule.gamma).toBe(0.001);
    expect(trial.rule.topFraction).toBe(0.2);
    expect(trial.rule.outOfRangeTimeoutHours).toBe(96);
    expect(trial.rule.stopLossPct).toBe(0.18);
    expect(trial.rule.sizeUsd).toBe(250);
    expect(trial.parameterHash).toBe(h12TrialHash(trial.rule));
    expect(trial.strategy.shape).toBe("Spot");
    expect(trial.strategy.exit.outOfRangeTimeoutHours).toBe(96);
  });

  it("scores only bars before the entry day", () => {
    const start = Date.UTC(2026, 6, 1) / 1000;
    const now = Date.UTC(2026, 6, 20);
    const calm = days(start, 20, 100, 50);
    const spiked = days(start, 20, 100, 50);
    const entryDay = Math.floor(now / 1000 / 86_400) * 86_400;
    const future = spiked.find((candle) => candle.timestamp >= entryDay);
    if (future) future.lpFeesUsd = 1_000_000;
    const market = pool({ name: "SOL-USDC", binStep: 100, currentPrice: 100, tvlUsd: 100_000, address: "pool-a" });
    const other = pool({ name: "OTHER", binStep: 100, currentPrice: 10, tvlUsd: 100_000, address: "pool-b" });
    const clean = rankH12Candidates([{ pool: market, candles: calm, candleHours: 24 }], now);
    const dirty = rankH12Candidates([{ pool: other, candles: spiked, candleHours: 24 }], now);
    expect(clean.candidates).toHaveLength(1);
    expect(dirty.candidates).toHaveLength(1);
    expect(dirty.candidates[0]?.score).toBeCloseTo(clean.candidates[0]?.score ?? 0, 8);
  });

  it("keeps the top fifth and drops a width that does not clear", () => {
    const start = Date.UTC(2026, 6, 1) / 1000;
    const now = Date.UTC(2026, 6, 20);
    const rows = Array.from({ length: 12 }, (_, index) => ({
      pool: pool({
        name: `P${index}`,
        address: `pool-${index}`,
        binStep: 80,
        currentPrice: 1,
        tvlUsd: 50_000,
      }),
      candles: days(start, 20, 1, 10 + index * 100),
      candleHours: 24,
    }));
    const ranked = rankH12Candidates(rows, now);
    expect(ranked.cutoff).not.toBeNull();
    expect(ranked.passed.length + ranked.withdrew).toBeGreaterThan(0);
    expect(ranked.passed.every((row) => row.bins !== null && row.bins >= 1 && row.bins <= 80)).toBe(true);
    expect(ranked.passed.every((row) => row.score >= (ranked.cutoff ?? 0))).toBe(true);
  });
});

describe("validate-fees", () => {
  it("prefers the active-bin model when the snapshot liquidity sits in the active bin", () => {
    const active = 1000;
    const bins = [{ binId: active, usd: 100_000 }];
    for (let offset = 1; offset <= 5; offset += 1) bins.push({ binId: active + offset, usd: 0 });
    const check = compareFeeModels(
      [{
        pool: "pool",
        timeMs: 1_000,
        activeBin: active,
        binStep: 100,
        tvlUsd: 100_000,
        bins,
      }],
      [{
        pool: "pool",
        timeMs: 1_000 + 60_000,
        startBin: active,
        endBin: active + 5,
        feeUsd: 10,
      }],
    );
    expect(check.scoredSwaps).toBe(1);
    expect(check.closer).toBe("active-bin");
    expect(check.activeMaeUsd).toBeLessThan(check.crossedMaeUsd ?? 0);
  });

  it("reports no overlap when the snapshot is too old", () => {
    const check = compareFeeModels(
      [{
        pool: "pool",
        timeMs: 1_000,
        activeBin: 10,
        binStep: 100,
        tvlUsd: 10_000,
        bins: [{ binId: 10, usd: 10_000 }],
      }],
      [{
        pool: "pool",
        timeMs: 1_000 + 2 * 60 * 60 * 1000,
        startBin: 10,
        endBin: 10,
        feeUsd: 5,
      }],
    );
    expect(check.scoredSwaps).toBe(0);
    expect(check.closer).toBe("no-overlap");
  });
});

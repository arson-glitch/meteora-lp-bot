import { describe, expect, it } from "vitest";
import { openPaperPosition } from "../src/executor/paper.js";
import { gridCells, strategyFromCell } from "../src/tournament/grid.js";
import { describeCell, forwardStrategySnapshot, tokenHoldUsd } from "../src/tournament/leaderStudy.js";
import { rugGatePools } from "../src/tournament/rugGate.js";
import { SOL, USDC, USDT, pool, token } from "./fixtures.js";

describe("daily study helpers", () => {
  it("describes the wide quote bid-ask take-profit cell", () => {
    const cell = gridCells().find((item) => item.id === "grid-bidask-wide-quote-tp");
    expect(cell).toBeDefined();
    const text = describeCell(cell!);
    expect(text).toContain("BidAsk");
    expect(text).toContain("40 bins below");
    expect(text).toContain("quote-only deposit");
    expect(text).toContain("15% take-profit");
  });

  it("marks a meme/SOL hold up with price and leaves a stable pair flat", () => {
    const candles = [
      { timestamp: 1, open: 1, high: 1, low: 1, close: 1, volumeUsd: 0, lpFeesUsd: 0 },
      { timestamp: 2, open: 1.2, high: 1.2, low: 1.2, close: 1.2, volumeUsd: 0, lpFeesUsd: 0 },
    ];
    const meme = pool({
      name: "MEME-SOL",
      tokenX: token("MEME", "meme-mint", 1),
      tokenY: token("SOL", SOL, 100),
      currentPrice: 1.2,
    });
    expect(tokenHoldUsd(meme, candles, 250)).toEqual({ usd: 300, volatile: true });
    const stable = pool({
      name: "USDC-USDT",
      tokenX: token("USDC", USDC, 1),
      tokenY: token("USDT", USDT, 1),
      currentPrice: 1,
    });
    expect(tokenHoldUsd(stable, candles, 250)).toEqual({ usd: 250, volatile: false });
  });

  it("drops positions opened on this run from the forward snapshot", () => {
    const cell = gridCells().find((item) => item.id === "grid-bidask-wide-quote-tp");
    const strategy = strategyFromCell(cell!);
    const market = pool({
      name: "MEME-SOL",
      tokenX: token("MEME", "meme-mint", 1),
      tokenY: token("SOL", SOL, 100),
    });
    const older = openPaperPosition({ pool: market, strategy, sizeUsd: 250, nowMs: 1 });
    const fresh = openPaperPosition({ pool: market, strategy, sizeUsd: 250, nowMs: 2 });
    const snapshot = forwardStrategySnapshot({
      positions: [older, fresh],
      strategyId: strategy.id,
      pools: new Map([[market.address, market]]),
      solPriceUsd: 100,
      openedAt: new Date(2).toISOString(),
    });
    expect(snapshot.n).toBe(1);
    expect(snapshot.open).toBe(1);
  });

  it("skips a failing mint and stops once one pool passes", async () => {
    let calls = 0;
    const options = {
      failScore: 60,
      minHolders: 30,
      minTvlUsd: 5_000,
      failClosed: true,
      fetchSummary: async (mint: string) => {
        calls += 1;
        if (mint === "bad-mint") return { score_normalised: 90, risks: [] };
        return { score_normalised: 1, risks: [] };
      },
    };
    const bad = pool({
      name: "BAD-SOL",
      address: "bad-pool",
      tokenX: token("BAD", "bad-mint", 1),
      tokenY: token("SOL", SOL, 100),
      tvlUsd: 20_000,
    });
    const good = pool({
      name: "GOOD-SOL",
      address: "good-pool",
      tokenX: token("GOOD", "good-mint", 1),
      tokenY: token("SOL", SOL, 100),
      tvlUsd: 20_000,
    });
    const later = pool({
      name: "LATER-SOL",
      address: "later-pool",
      tokenX: token("LATER", "later-mint", 1),
      tokenY: token("SOL", SOL, 100),
      tvlUsd: 20_000,
    });
    const result = await rugGatePools({
      pools: [bad, good, later],
      coinType: "fresh-memecoin",
      options,
      accept: 1,
    });
    expect(result.passed.map((item) => item.name)).toEqual(["GOOD-SOL"]);
    expect(result.hits.map((item) => item.ok)).toEqual([false, true]);
    expect(result.hits[0]?.reasons[0]).toContain("90");
    expect(calls).toBe(2);
  });
});

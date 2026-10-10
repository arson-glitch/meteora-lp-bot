import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadStrategies } from "../src/strategy/loader.js";
import { pickStrategy } from "../src/strategy/picker.js";
import { SOL, USDC, USDT, pool, token } from "./fixtures.js";

const now = Date.UTC(2026, 9, 9, 12);
const strategies = loadStrategies(join(process.cwd(), "strategies"));

describe("strategy rulebook", () => {
  it("loads the shipped placeholders and requires a Meteora doc citation", () => {
    expect(strategies.length).toBeGreaterThanOrEqual(6);
    for (const strategy of strategies) {
      expect(strategy.placeholder).toBe(true);
      expect(strategy.docs.some((doc) => doc.startsWith("https://docs.meteora.ag/"))).toBe(true);
      expect(strategy.placeholderNote.toLowerCase()).toContain("placeholder");
    }
    expect(strategies.some((strategy) => strategy.manualOnly)).toBe(true);
  });

  it("picks Curve or Spot-Concentrated for stables, Spot-Spread for SOL-USDC, Bid-Ask or DCA for volatile pools", () => {
    const tightStable = pool({
      name: "USDC-USDT",
      tokenX: token("USDC", USDC, 1),
      tokenY: token("USDT", USDT, 1),
      currentPrice: 1,
      binStep: 1,
      tvlUsd: 500_000,
      market: market(0.2),
    });
    expect(pickStrategy(tightStable, strategies, { nowMs: now }).strategy?.id).toBe("spot-concentrated");

    const widerStable = pool({
      name: "USDC-USDT-wide",
      tokenX: token("USDC", USDC, 1),
      tokenY: token("USDT", USDT, 1),
      currentPrice: 1,
      binStep: 10,
      tvlUsd: 200_000,
      market: market(1),
    });
    expect(pickStrategy(widerStable, strategies, { nowMs: now }).strategy?.id).toBe("curve-stable");

    const major = pool({
      name: "SOL-USDC",
      binStep: 4,
      currentPrice: 110,
      tokenX: token("SOL", SOL, 110),
      market: market(2),
    });
    expect(pickStrategy(major, strategies, { nowMs: now }).strategy?.id).toBe("spot-spread");

    const smallMeme = pool({
      name: "MEME-SOL",
      binStep: 100,
      tvlUsd: 20_000,
      currentPrice: 0.001,
      tokenX: token("MEME", "meme", 0.1),
      tokenY: token("SOL", SOL, 100),
      market: market(40),
      createdAtMs: now - 3_600_000,
    });
    expect(pickStrategy(smallMeme, strategies, { nowMs: now }).strategy?.id).toBe("dca-in-bidask");

    const largeMeme = pool({
      ...smallMeme,
      name: "LARGE-SOL",
      tvlUsd: 200_000,
      market: market(20),
    });
    expect(pickStrategy(largeMeme, strategies, { nowMs: now }).strategy?.id).toBe("bid-ask-volatile");
    expect(pickStrategy(largeMeme, strategies, { nowMs: now }).reason).not.toContain("dca-out");
  });

  it("does not auto-select the manual DCA-out rule", () => {
    const meme = pool({
      name: "EXIT-SOL",
      binStep: 80,
      tvlUsd: 30_000,
      tokenX: token("EXIT", "exit-mint", 1),
      tokenY: token("SOL", SOL, 100),
      market: market(20),
    });
    expect(pickStrategy(meme, strategies, { nowMs: now }).strategy?.id).not.toBe("dca-out-bidask");
    expect(pickStrategy(meme, strategies, { nowMs: now, strategyId: "dca-out-bidask" }).strategy?.id).toBe(
      "dca-out-bidask",
    );
  });

  it("rejects a strategy file that does not cite the docs", () => {
    const dir = mkdtempSync(join(tmpdir(), "strategies-"));
    writeFileSync(
      join(dir, "bad.json"),
      JSON.stringify({
        id: "bad",
        name: "Bad",
        placeholder: true,
        placeholderNote: "placeholder",
        docs: ["https://example.com"],
        product: "dlmm",
        shape: "Spot",
        binsBelow: 1,
        binsAbove: 1,
        sidedness: "two-sided",
        priority: 1,
        exit: { onOutOfRange: "close", stopLossPct: 0.1 },
      }),
    );
    expect(() => loadStrategies(dir)).toThrow(/docs.meteora.ag/);
  });

  it("rejects perps, borrowed leverage, and lending", () => {
    const dir = mkdtempSync(join(tmpdir(), "strategies-"));
    writeFileSync(
      join(dir, "sol-perp-hedge.json"),
      JSON.stringify({
        id: "sol-perp-hedge",
        name: "Short SOL perp",
        placeholder: true,
        placeholderNote: "placeholder hedge with perps",
        docs: ["https://docs.meteora.ag/get-started"],
        product: "dlmm",
        shape: "Spot",
        binsBelow: 1,
        binsAbove: 1,
        sidedness: "two-sided",
        priority: 1,
        exit: { onOutOfRange: "close", stopLossPct: 0.1 },
      }),
    );
    expect(() => loadStrategies(dir)).toThrow(/spot DLMM only/);
  });
});

function market(change: number) {
  return {
    source: "dexscreener" as const,
    dexId: "meteora",
    pairAddress: "pair",
    priceChangeH1Pct: change / 4,
    priceChangeH24Pct: change,
    volumeH24Usd: 50_000,
    liquidityUsd: 20_000,
  };
}

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { binIdFromPrice } from "../src/math/bins.js";
import { loadStrategies } from "../src/strategy/loader.js";
import { pickStrategy } from "../src/strategy/picker.js";
import { layoutForStrategy } from "../src/strategy/sides.js";
import { replayStrategy, splitCandles } from "../src/tournament/backtest.js";
import type { Candle } from "../src/tournament/candles.js";
import { classifyPool } from "../src/tournament/classify.js";
import { assignBuckets } from "../src/tournament/discover.js";
import { openForwardBook } from "../src/tournament/forward.js";
import { gridCells, gridStrategies, strategyFromCell } from "../src/tournament/grid.js";
import { scoreTrials } from "../src/tournament/score.js";
import type { TrialResult } from "../src/tournament/backtest.js";
import type { CoinType, DiscoveredPool, MarketContext } from "../src/types.js";
import { SOL, USDC, USDT, pool, token } from "./fixtures.js";

const now = Date.UTC(2026, 9, 9, 12);

describe("coin classifier", () => {
  it("buckets pools from age, market cap, turnover, and price change", () => {
    expect(classifyPool(stablePool(), now).type).toBe("stable");
    expect(classifyPool(solPool(24 * 30), now).type).toBe("bluechip");
    expect(classifyPool(solPool(1), now).type).toBe("bluechip");

    const large = memePool({ ageHours: 100, marketCapUsd: 2_000_000_000, change: 1, volume24h: 1_000 });
    expect(classifyPool(large, now).type).toBe("bluechip");
    const largeButYoung = memePool({ ageHours: 48, marketCapUsd: 2_000_000_000, change: 1, volume24h: 1_000 });
    expect(classifyPool(largeButYoung, now).type).toBe("older-memecoin");

    const fresh = memePool({ ageHours: 2, marketCapUsd: 500_000, change: 80, volume24h: 5_000_000 });
    expect(classifyPool(fresh, now).type).toBe("fresh-memecoin");

    const hot = memePool({ ageHours: 24 * 10, marketCapUsd: 50_000_000, change: 40, volume24h: 1_000, holders: 8_000 });
    expect(classifyPool(hot, now).type).toBe("high-vol-trending");

    const busy = memePool({ ageHours: 24 * 10, marketCapUsd: 1_000_000, change: 1, volume24h: 900_000 });
    expect(classifyPool(busy, now).type).toBe("high-vol-trending");

    const mid = memePool({ ageHours: 24 * 30, marketCapUsd: 50_000_000, change: 2, volume24h: 10_000, holders: 5_000 });
    expect(classifyPool(mid, now).type).toBe("established-midcap");

    const old = memePool({ ageHours: 24 * 30, marketCapUsd: 1_000_000, change: 2, volume24h: 10_000 });
    expect(classifyPool(old, now).type).toBe("older-memecoin");

    const dollars = pool({
      name: "USDe-USDG",
      tokenX: token("USDe", "usde-mint", 1),
      tokenY: token("USDG", "usdg-mint", 1),
      currentPrice: 1,
      binStep: 1,
      createdAtMs: now - 24 * 30 * 3_600_000,
    });
    expect(classifyPool(dollars, now).type).toBe("stable");
  });

  it("keeps one pool per coin when several bin steps share a market", () => {
    const wide = solPool(24 * 30);
    wide.address = "sol-usdc-wide";
    wide.binStep = 10;
    wide.volume = { "24h": 1_000 };
    const tight = solPool(24 * 30);
    tight.address = "sol-usdc-tight";
    tight.binStep = 1;
    tight.volume = { "24h": 50_000 };
    const jup = pool({
      name: "JUP-SOL",
      address: "jup-sol",
      tokenX: token("JUP", "jup-mint", 1, { marketCapUsd: 2_000_000_000 }),
      tokenY: token("SOL", SOL, 100),
      currentPrice: 0.01,
      binStep: 80,
      tvlUsd: 1_000_000,
      volume: { "24h": 20_000 },
      createdAtMs: now - 24 * 30 * 3_600_000,
    });
    const bluechip = assignBuckets([wide, tight, jup], now, 4).find((bucket) => bucket.type === "bluechip");
    expect(bluechip?.pools.map((item) => item.address)).toEqual(["sol-usdc-tight", "jup-sol"]);
  });

  it("does not put the same coin in two buckets", () => {
    const hot = memePool({ ageHours: 24 * 10, marketCapUsd: 50_000_000, change: 40, volume24h: 5_000_000, holders: 8_000 });
    hot.address = "hot-pool";
    hot.tokenX = { ...hot.tokenX, address: "same-meme" };
    const calm = memePool({ ageHours: 24 * 30, marketCapUsd: 50_000_000, change: 2, volume24h: 10_000, holders: 5_000 });
    calm.address = "calm-pool";
    calm.tokenX = { ...calm.tokenX, address: "same-meme" };
    const assigned = assignBuckets([hot, calm], now, 4);
    const names = assigned.flatMap((bucket) => bucket.pools.map((item) => item.address));
    expect(names).toEqual(["hot-pool"]);
    expect(assigned.find((bucket) => bucket.type === "established-midcap")?.pools).toHaveLength(0);
  });
});

describe("strategy grid", () => {
  it("builds 108 unique cells and resolves quote versus token per pool", () => {
    const cells = gridCells();
    expect(cells).toHaveLength(108);
    expect(new Set(cells.map((cell) => cell.id)).size).toBe(108);
    expect(new Set(cells.map((cell) => cell.shape))).toEqual(new Set(["Spot", "Curve", "BidAsk"]));

    const quoteCell = cells.find((cell) => cell.side === "quote" && cell.width === "medium");
    if (!quoteCell) throw new Error("missing quote cell");
    const onSol = layoutForStrategy(solPool(100), strategyFromCell(quoteCell));
    expect(onSol.sidedness).toBe("single-sided-y");
    expect(onSol.binsAbove).toBe(0);
    expect(onSol.binsBelow).toBeGreaterThan(0);

    const reversed = pool({
      name: "USDC-MEME",
      tokenX: token("USDC", USDC, 1),
      tokenY: token("MEME", "meme-mint-1", 0.01),
      currentPrice: 0.01,
      binStep: 80,
    });
    const onReversed = layoutForStrategy(reversed, strategyFromCell(quoteCell));
    expect(onReversed.sidedness).toBe("single-sided-x");
    expect(onReversed.binsBelow).toBe(0);
    expect(onReversed.binsAbove).toBe(onSol.binsBelow);
  });

  it("round-trips a winner file and only matches its coin type", () => {
    const cell = gridCells().find((item) => item.id === "grid-curve-narrow-two-timeout");
    if (!cell) throw new Error("missing cell");
    const config = strategyFromCell(cell, {
      id: "winner-stable",
      name: "Tournament winner for stable",
      priority: 200,
      coinType: "stable",
      placeholder: false,
      placeholderNote: "Generated by the strategy tournament. Not a hand-written placeholder.",
      notes: "test",
    });
    const dir = mkdtempSync(join(tmpdir(), "winners-"));
    writeFileSync(
      join(dir, "winner-stable.json"),
      JSON.stringify({
        ...config,
        exit: config.exit,
      }),
    );
    const loaded = loadStrategies(dir);
    expect(loaded[0]?.coinType).toBe("stable");
    expect(loaded[0]?.exit.outOfRangeTimeoutHours).toBe(12);
    expect(loaded[0]?.quoteSide).toBe("two-sided");

    const bundled = [...loaded, ...loadStrategies(join(process.cwd(), "strategies"))];
    expect(pickStrategy(stablePool(), bundled, { nowMs: now }).strategy?.id).toBe("winner-stable");
    expect(pickStrategy(solPool(24 * 30), bundled, { nowMs: now }).strategy?.id).not.toBe("winner-stable");
  });
});

describe("backtest replay", () => {
  it("earns fees on a flat market and stays in range", () => {
    const strategy = strategyFromCell(cell("grid-spot-medium-two-oor"));
    strategy.exit.stopLossPct = 0.9;
    const result = replayStrategy({
      pool: flatPool(),
      strategy,
      candles: flatCandles(10),
      sizeUsd: 250,
      candleHours: 4,
      coinType: "stable",
      split: "train",
    });
    expect(result).not.toBeNull();
    expect(result?.closeReason).toBeNull();
    expect(result?.feesUsd ?? 0).toBeGreaterThan(20);
    expect(result?.netPnlUsd ?? 0).toBeGreaterThan(0);
    expect(Math.abs(result?.ilUsd ?? 1)).toBeLessThan(1);
  });

  it("closes a narrow range on a spike that a wide range survives", () => {
    const moved = binIdFromPrice(1.05, 25, "nearest");
    expect(moved).toBeGreaterThan(2);
    expect(moved).toBeLessThan(30);
    const narrow = strategyFromCell(cell("grid-spot-narrow-two-oor"));
    const wide = strategyFromCell(cell("grid-spot-wide-two-oor"));
    narrow.exit.stopLossPct = 0.9;
    wide.exit.stopLossPct = 0.9;
    const candles = [bar(0, 1, 1, 1, 1, 0), bar(1, 1, 1.05, 1, 1.05, 0)];
    const narrowResult = replayStrategy({
      pool: flatPool(),
      strategy: narrow,
      candles,
      sizeUsd: 250,
      candleHours: 4,
      coinType: "older-memecoin",
      split: "train",
    });
    const wideResult = replayStrategy({
      pool: flatPool(),
      strategy: wide,
      candles,
      sizeUsd: 250,
      candleHours: 4,
      coinType: "older-memecoin",
      split: "train",
    });
    expect(narrowResult?.closeReason).toBe("out-of-range");
    expect(wideResult?.closeReason).toBeNull();
  });

  it("waits out a short excursion when the exit is a 12h timeout", () => {
    const immediate = strategyFromCell(cell("grid-spot-narrow-two-oor"));
    const timeout = strategyFromCell(cell("grid-spot-narrow-two-timeout"));
    immediate.exit.stopLossPct = 0.9;
    timeout.exit.stopLossPct = 0.9;
    const outside = 1.01 ** 4;
    const candles = [
      bar(0, 1, 1, 1, 1, 100),
      bar(1, outside, outside, outside, outside, 100),
      bar(2, outside, outside, outside, outside, 100),
      bar(3, 1, 1, 1, 1, 100),
    ];
    const closed = replayStrategy({
      pool: flatPool(),
      strategy: immediate,
      candles,
      sizeUsd: 250,
      candleHours: 4,
      coinType: "older-memecoin",
      split: "train",
    });
    const waited = replayStrategy({
      pool: flatPool(),
      strategy: timeout,
      candles,
      sizeUsd: 250,
      candleHours: 4,
      coinType: "older-memecoin",
      split: "train",
    });
    expect(closed?.closeReason).toBe("out-of-range");
    expect(waited?.closeReason).toBeNull();
    expect(waited?.feesUsd ?? 0).toBeGreaterThan(closed?.feesUsd ?? 0);
  });

  it("replays train and test as separate entries", () => {
    const candles = flatCandles(10);
    const split = splitCandles(candles);
    expect(split.train.length).toBe(7);
    expect(split.test.length).toBe(3);
    const strategy = strategyFromCell(cell("grid-spot-medium-two-oor"));
    const train = replayStrategy({
      pool: flatPool(),
      strategy,
      candles: split.train,
      sizeUsd: 250,
      candleHours: 4,
      coinType: "stable",
      split: "train",
    });
    const test = replayStrategy({
      pool: flatPool(),
      strategy,
      candles: split.test,
      sizeUsd: 250,
      candleHours: 4,
      coinType: "stable",
      split: "test",
    });
    expect(train?.depositedUsd).toBe(250);
    expect(test?.depositedUsd).toBe(250);
    expect(test?.candles).toBe(3);
  });
});

describe("tournament scoring", () => {
  it("confirms on the test window and ignores a high test score outside the top five", () => {
    const trials: TrialResult[] = [];
    const specs = [
      ["s0", 0.1, -0.02],
      ["s1", 0.09, 0.04],
      ["s2", 0.08, 0.01],
      ["s3", 0.07, 0.01],
      ["s4", 0.06, 0.01],
      ["s5", 0.05, 0.9],
    ] as const;
    for (const [id, trainReturn, testReturn] of specs) {
      for (let i = 0; i < 3; i += 1) {
        trials.push(fakeTrial(id, "train", trainReturn));
        trials.push(fakeTrial(id, "test", testReturn));
      }
    }
    const board = scoreTrials(trials, gridCells()).find((item) => item.coinType === "stable");
    expect(board?.winner?.strategyId).toBe("s1");
    expect(board?.rows.find((row) => row.strategyId === "s5")?.inConfirmationSet).toBe(false);
    expect(board?.rows.find((row) => row.strategyId === "s0")?.promoted).toBe(false);
  });

  it("does not promote a thin sample or a non-positive test median", () => {
    const thin = scoreTrials(
      [
        fakeTrial("only", "train", 0.2),
        fakeTrial("only", "train", 0.3),
        fakeTrial("only", "test", 0.4),
        fakeTrial("only", "test", 0.4),
        fakeTrial("only", "test", 0.4),
      ],
      [],
    ).find((board) => board.coinType === "stable");
    expect(thin?.winner).toBeNull();
    expect(thin?.rows.find((row) => row.strategyId === "only")?.eligible).toBe(false);

    const negative = scoreTrials(
      [0, 1, 2].flatMap(() => [fakeTrial("neg", "train", 0.05), fakeTrial("neg", "test", -0.01)]),
      [],
    ).find((board) => board.coinType === "stable");
    expect(negative?.winner).toBeNull();
    expect(negative?.rows.find((row) => row.strategyId === "neg")?.inConfirmationSet).toBe(true);

    const skewed = scoreTrials(
      [0, 1, 2].flatMap((index) => [
        fakeTrial("skew", "train", 0.05),
        fakeTrial("skew", "test", index === 2 ? -0.5 : 0.2),
      ]),
      [],
    ).find((board) => board.coinType === "stable");
    expect(skewed?.rows.find((row) => row.strategyId === "skew")?.test.medianReturn ?? 0).toBeGreaterThan(0);
    expect(skewed?.winner).toBeNull();
  });
});

describe("forward paper book", () => {
  it("opens the whole grid without the 3-position cap", () => {
    const book = openForwardBook({
      buckets: [{ type: "stable", pools: [stablePool()] }],
      strategies: gridStrategies(),
      sizeUsd: 250,
      nowMs: now,
    });
    expect(book.kind).toBe("tournament-forward");
    expect(book.positions).toHaveLength(108);
    expect(new Set(book.positions.map((position) => position.strategyId)).size).toBe(108);
    expect(book.positions.every((position) => position.mode === "paper" && position.status === "open")).toBe(true);
  });
});

function cell(id: string) {
  const found = gridCells().find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

function market(change: number | null): MarketContext {
  return {
    source: change === null ? "none" : "dexscreener",
    dexId: null,
    pairAddress: null,
    priceChangeH1Pct: null,
    priceChangeH24Pct: change,
    volumeH24Usd: null,
    liquidityUsd: null,
  };
}

function stablePool(): DiscoveredPool {
  return pool({
    name: "USDC-USDT",
    tokenX: token("USDC", USDC, 1),
    tokenY: token("USDT", USDT, 1),
    currentPrice: 1,
    binStep: 1,
    tvlUsd: 500_000,
    createdAtMs: now - 24 * 30 * 3_600_000,
    market: market(0.1),
  });
}

function solPool(ageHours: number): DiscoveredPool {
  return pool({
    name: "SOL-USDC",
    tokenX: token("SOL", SOL, 100, { marketCapUsd: 80_000_000_000 }),
    tokenY: token("USDC", USDC, 1),
    currentPrice: 100,
    binStep: 4,
    tvlUsd: 5_000_000,
    createdAtMs: now - ageHours * 3_600_000,
    market: market(3),
  });
}

function memePool(input: {
  ageHours: number;
  marketCapUsd: number;
  change: number | null;
  volume24h: number;
  holders?: number;
}): DiscoveredPool {
  return pool({
    name: "MEME-USDC",
    tokenX: token("MEME", "meme-mint-2", 0.01, {
      marketCapUsd: input.marketCapUsd,
      holders: input.holders ?? 100,
    }),
    tokenY: token("USDC", USDC, 1),
    currentPrice: 0.01,
    binStep: 100,
    tvlUsd: 100_000,
    volume: { "24h": input.volume24h },
    createdAtMs: now - input.ageHours * 3_600_000,
    market: market(input.change),
  });
}

function flatPool(): DiscoveredPool {
  return pool({
    name: "FLAT-USDC",
    tokenX: token("FLAT", "flat-mint", 1),
    tokenY: token("USDC", USDC, 1),
    currentPrice: 1,
    binStep: 25,
    tvlUsd: 100_000,
    fees: { "24h": 400, "1h": 0 },
    createdAtMs: now - 24 * 30 * 3_600_000,
  });
}

function flatCandles(count: number): Candle[] {
  return Array.from({ length: count }, (_, index) => bar(index, 1, 1, 1, 1, 1_000));
}

function bar(index: number, open: number, high: number, low: number, close: number, lpFeesUsd = 0): Candle {
  return {
    timestamp: 1_700_000_000 + index * 14_400,
    open,
    high,
    low,
    close,
    volumeUsd: 50_000,
    lpFeesUsd,
  };
}

function fakeTrial(strategyId: string, split: "train" | "test", returnPct: number): TrialResult {
  const coinType: CoinType = "stable";
  return {
    poolAddress: `${strategyId}-${split}-${returnPct}`,
    poolName: "fixture",
    strategyId,
    coinType,
    split,
    candles: 10,
    depositedUsd: 250,
    equityUsd: 250 * (1 + returnPct),
    netPnlUsd: 250 * returnPct,
    returnPct,
    feesUsd: 1,
    ilUsd: -1,
    hodlUsd: 250,
    vsHodlUsd: 250 * returnPct,
    maxDrawdownPct: 0.05,
    closeReason: null,
    rebalanceCount: 0,
  };
}

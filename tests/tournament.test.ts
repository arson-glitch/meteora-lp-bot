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
import { assignBuckets, selectTournamentBuckets } from "../src/tournament/discover.js";
import { holdoutCount, splitCoinKeys } from "../src/tournament/holdout.js";
import { appendForwardPools, emptyForwardBook } from "../src/tournament/forward.js";
import { openForwardBook } from "../src/tournament/forward.js";
import { classicGridCells, costAwareCells, gridCells, gridStrategies, strategyFromCell } from "../src/tournament/grid.js";
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
  it("builds 108 classic cells plus the cost-aware family", () => {
    const classic = classicGridCells();
    expect(classic).toHaveLength(108);
    expect(costAwareCells().every((cell) => cell.stayInBinArray)).toBe(true);
    expect(costAwareCells().every((cell) => cell.shape === "Spot" || cell.shape === "Curve")).toBe(true);
    const cells = gridCells();
    expect(new Set(cells.map((cell) => cell.id)).size).toBe(cells.length);
    expect(cells.find((cell) => cell.id === "grid-spot-broad-two-stay")?.binsBelow).toBe(80);
    expect(cells.find((cell) => cell.id === "grid-spot-wide-two-rebalance6")?.outOfRangeTimeoutHours).toBe(6);
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

describe("coin holdout", () => {
  it("holds out about 30% of coins and keeps the sets disjoint", () => {
    const keys = Array.from({ length: 18 }, (_, index) => `coin-${String(index).padStart(2, "0")}`);
    expect(holdoutCount(18)).toBe(5);
    const split = splitCoinKeys(keys);
    expect(split.holdoutKeys).toHaveLength(5);
    expect(split.trainKeys).toHaveLength(13);
    expect(split.trainKeys.some((key) => split.holdoutKeys.includes(key))).toBe(false);
    expect(splitCoinKeys(keys).holdoutKeys).toEqual(split.holdoutKeys);
  });
});

describe("tournament scoring", () => {
  it("confirms on the time split and the coin holdout, and ignores a high test score outside the top five", () => {
    const trials: TrialResult[] = [];
    const specs = [
      ["s0", 0.1, -0.02, 0.2],
      ["s1", 0.09, 0.04, 0.03],
      ["s2", 0.08, 0.01, 0.02],
      ["s3", 0.07, 0.01, 0.02],
      ["s4", 0.06, 0.01, 0.02],
      ["s5", 0.05, 0.9, 0.5],
    ] as const;
    for (const [id, trainReturn, testReturn, holdoutReturn] of specs) {
      for (let i = 0; i < 8; i += 1) trials.push(fakeTrial(id, "train", trainReturn, i));
      for (let i = 0; i < 5; i += 1) trials.push(fakeTrial(id, "test", testReturn, i));
      for (let i = 0; i < 4; i += 1) trials.push(fakeTrial(id, "holdout", holdoutReturn, i));
    }
    const board = scoreTrials(trials, gridCells()).find((item) => item.coinType === "stable");
    expect(board?.winner?.strategyId).toBe("s1");
    expect(board?.rows.find((row) => row.strategyId === "s5")?.inConfirmationSet).toBe(false);
    expect(board?.rows.find((row) => row.strategyId === "s0")?.promoted).toBe(false);
  });

  it("does not promote a thin sample, a losing time split, or a losing holdout", () => {
    const thin = scoreTrials(
      [fakeTrial("only", "train", 0.2, 0), fakeTrial("only", "train", 0.3, 1)],
      [],
    ).find((board) => board.coinType === "stable");
    expect(thin?.winner).toBeNull();
    expect(thin?.rows.find((row) => row.strategyId === "only")?.eligible).toBe(false);

    const negative = many("neg", 0.05, -0.01, 0.04);
    const negativeBoard = scoreTrials(negative, []).find((board) => board.coinType === "stable");
    expect(negativeBoard?.winner).toBeNull();
    expect(negativeBoard?.rows.find((row) => row.strategyId === "neg")?.inConfirmationSet).toBe(true);

    const skewed = [
      ...repeat("skew", "train", 0.05, 8),
      ...[0.2, 0.2, 0.2, 0.2, -0.9].map((value, index) => fakeTrial("skew", "test", value, index)),
      ...repeat("skew", "holdout", 0.04, 4),
    ];
    const skewedBoard = scoreTrials(skewed, []).find((board) => board.coinType === "stable");
    expect(skewedBoard?.rows.find((row) => row.strategyId === "skew")?.test.medianReturn ?? 0).toBeGreaterThan(0);
    expect(skewedBoard?.winner).toBeNull();

    const missedHoldout = many("miss", 0.05, 0.04, -0.02);
    expect(scoreTrials(missedHoldout, []).find((board) => board.coinType === "stable")?.winner).toBeNull();
  });

  it("rejects a holdout that one coin dominates or that loses to the token", () => {
    const concentrated = many("wide", 0.05, 0.04, 0.04).map((trial) =>
      trial.split === "holdout" ? { ...trial, coinKey: "same-coin" } : trial,
    );
    const concentratedBoard = scoreTrials(concentrated, []).find((board) => board.coinType === "stable");
    expect(concentratedBoard?.winner).toBeNull();
    expect(concentratedBoard?.promotionNote).toContain("positive PnL");

    const losesToToken = many("tok", 0.05, 0.04, 0.04).map((trial) =>
      trial.split === "holdout" ? { ...trial, vsTokenUsd: -5 } : trial,
    );
    const tokenBoard = scoreTrials(losesToToken, []).find((board) => board.coinType === "stable");
    expect(tokenBoard?.winner).toBeNull();
    expect(tokenBoard?.promotionNote).toContain("holding the token");
  });

  it("does not promote Bid-Ask as a yield strategy", () => {
    const board = scoreTrials(many("grid-bidask-wide-two-oor", 0.2, 0.1, 0.1), gridCells()).find((item) => item.coinType === "stable");
    expect(board?.winner).toBeNull();
    expect(board?.promotionNote).toContain("Bid-Ask");
  });
});

describe("extra pools and forward append", () => {
  it("adds a second bin step for the same coin", () => {
    const tight = solPool(24 * 30);
    tight.address = "sol-tight";
    tight.binStep = 4;
    tight.volume = { "24h": 80_000 };
    const wide = solPool(24 * 30);
    wide.address = "sol-wide";
    wide.binStep = 20;
    wide.volume = { "24h": 10_000 };
    const selected = selectTournamentBuckets([tight, wide], now, 18).find((bucket) => bucket.type === "bluechip");
    expect(selected?.pools.map((pool) => pool.address).sort()).toEqual(["sol-tight", "sol-wide"]);
  });

  it("does not open a second grid on a coin already in the forward book", () => {
    const book = emptyForwardBook(now, 250);
    const first = appendForwardPools({
      book,
      buckets: [{ type: "bluechip", pools: [solPool(100)] }],
      strategies: gridStrategies().slice(0, 2),
      sizeUsd: 250,
      nowMs: now,
    });
    expect(first.added).toHaveLength(1);
    const again = appendForwardPools({
      book: first.book,
      buckets: [{ type: "bluechip", pools: [solPool(100)] }],
      strategies: gridStrategies().slice(0, 2),
      sizeUsd: 250,
      nowMs: now,
    });
    expect(again.added).toHaveLength(0);
    expect(again.book.positions).toHaveLength(2);
  });

  it("does not reopen a coin when the book row has no sample key", () => {
    const book = emptyForwardBook(now, 250);
    const primary = solPool(100);
    primary.address = "sol-old";
    const sibling = solPool(100);
    sibling.address = "sol-new";
    sibling.binStep = 80;
    book.pools.push({ coinType: "bluechip", address: "sol-old", name: "SOL-USDC" });
    const result = appendForwardPools({
      book,
      buckets: [{ type: "bluechip", pools: [sibling] }],
      knownPools: [primary, sibling],
      strategies: gridStrategies().slice(0, 2),
      sizeUsd: 250,
      nowMs: now,
    });
    expect(result.added).toHaveLength(0);
    expect(book.pools[0]?.sampleKey).toBeTruthy();
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
    expect(book.positions).toHaveLength(gridStrategies().length);
    expect(new Set(book.positions.map((position) => position.strategyId)).size).toBe(gridStrategies().length);
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

function repeat(strategyId: string, split: TrialResult["split"], returnPct: number, count: number): TrialResult[] {
  return Array.from({ length: count }, (_, index) => fakeTrial(strategyId, split, returnPct, index));
}

function many(strategyId: string, trainReturn: number, testReturn: number, holdoutReturn: number): TrialResult[] {
  return [
    ...repeat(strategyId, "train", trainReturn, 8),
    ...repeat(strategyId, "test", testReturn, 5),
    ...repeat(strategyId, "holdout", holdoutReturn, 4),
  ];
}

function fakeTrial(strategyId: string, split: TrialResult["split"], returnPct: number, index = 0): TrialResult {
  const coinType: CoinType = "stable";
  return {
    poolAddress: `${strategyId}-${split}-${returnPct}-${index}`,
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
    vsTokenUsd: 250 * returnPct,
    coinKey: `${split}-coin-${index}`,
    maxDrawdownPct: 0.05,
    closeReason: null,
    rebalanceCount: 0,
  };
}

import { describe, expect, it } from "vitest";
import { activeBinFeeUsd, assumedLiquidityBins } from "../src/math/activeBin.js";
import {
  binArrayIndex,
  liquidationCost,
  sellXForY,
  sunkBinArrayCount,
  tokenLegToSol,
} from "../src/math/costs.js";
import { priceFromBinId } from "../src/math/bins.js";
import { advancePosition, openPaperPosition } from "../src/executor/paper.js";
import { loadFrozenStrategy, parameterHash } from "../src/tournament/frozen.js";
import { appendFrozenPools, emptyFrozenBook } from "../src/tournament/frozenBook.js";
import { aggregateDrawdown, topCoinShare } from "../src/tournament/stats.js";
import { resolve } from "node:path";
import type { StrategyConfig } from "../src/strategy/schema.js";
import { pool, token } from "./fixtures.js";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("execution costs", () => {
  it("matches DLMM bin-array indexing, including negative ids", () => {
    expect(binArrayIndex(0)).toBe(0);
    expect(binArrayIndex(69)).toBe(0);
    expect(binArrayIndex(70)).toBe(1);
    expect(binArrayIndex(-1)).toBe(-1);
    expect(binArrayIndex(-70)).toBe(-1);
    expect(binArrayIndex(-71)).toBe(-2);
  });

  it("charges a new bin array only when the range leaves the active array", () => {
    expect(sunkBinArrayCount(0, 40, 40)).toBe(0);
    expect(sunkBinArrayCount(50, 90, 90)).toBe(1);
  });

  it("keeps position rent out of PnL and charges transaction fees", () => {
    const market = pool({
      name: "MEME-SOL",
      tokenX: token("MEME", "meme-mint", 1),
      tokenY: token("SOL", SOL, 100),
      currentPrice: 0.01,
      tvlUsd: 100_000,
      binStep: 25,
    });
    const cost = liquidationCost({
      pool: market,
      minBinId: 0,
      maxBinId: 40,
      activeBinId: 40,
      binStep: 25,
      rebalanceCount: 0,
      liquidityBins: 20,
      solPriceUsd: 100,
      tokenLeg: null,
      tokenAmount: 0,
      tokenPriceUsd: 1,
      otherPriceUsd: 100,
    });
    expect(cost.refundableRentUsd).toBeCloseTo(0.05740608 * 100, 4);
    expect(cost.sunkBinArrayUsd).toBe(0);
    expect(cost.pnlCostUsd).toBeCloseTo(cost.txFeeUsd, 8);
    expect(cost.txFeeUsd).toBeGreaterThan(0);
    expect(cost.txFeeUsd).toBeLessThan(0.02);
  });

  it("walks bins when the sale is larger than one bin of depth", () => {
    const bin = 0;
    const price = priceFromBinId(bin, 100);
    const small = sellXForY({
      amountX: 1,
      activeBinId: bin,
      binStep: 100,
      priceYUsd: 1,
      poolTvlUsd: 1_000_000,
      liquidityBins: 20,
      feeFraction: 0.01,
    });
    const large = sellXForY({
      amountX: 200_000,
      activeBinId: bin,
      binStep: 100,
      priceYUsd: 1,
      poolTvlUsd: 1_000_000,
      liquidityBins: 20,
      feeFraction: 0.01,
    });
    const smallMark = 1 * price;
    const largeMark = 200_000 * price;
    const smallSlip = smallMark - small.proceedsUsd;
    const largeSlip = largeMark - large.proceedsUsd;
    expect(smallSlip / smallMark).toBeGreaterThan(0.009);
    expect(smallSlip / smallMark).toBeLessThan(0.02);
    expect(largeSlip / largeMark).toBeGreaterThan(smallSlip / smallMark);
  });

  it("treats the non-SOL leg as the token to sell", () => {
    expect(tokenLegToSol({ address: "meme", symbol: "MEME" }, { address: SOL, symbol: "SOL" })).toBe("x");
    expect(tokenLegToSol({ address: SOL, symbol: "SOL" }, { address: USDC, symbol: "USDC" })).toBe("y");
  });
});

describe("active-bin fees", () => {
  it("pays the active bin's liquidity share and nothing to an empty bin", () => {
    const paid = activeBinFeeUsd({
      poolLpFeesPerHour: 1_000,
      hours: 1,
      poolTvlUsd: 100_000,
      liquidityBins: 20,
      bin: { binId: 1, price: 1, side: "bid", weight: 1, amountX: 0, amountY: 500 },
      priceXUsd: 1,
      priceYUsd: 1,
    });
    expect(paid).toBeCloseTo(100, 6);
    const missed = activeBinFeeUsd({
      poolLpFeesPerHour: 1_000,
      hours: 1,
      poolTvlUsd: 100_000,
      liquidityBins: 20,
      bin: { binId: 1, price: 1, side: "bid", weight: 1, amountX: 0, amountY: 0 },
      priceXUsd: 1,
      priceYUsd: 1,
    });
    expect(missed).toBe(0);
  });

  it("keeps the assumed pool width inside 20 to 400 bins", () => {
    const quiet = pool({ name: "Q", binStep: 100, market: { source: "dexscreener", dexId: null, pairAddress: null, priceChangeH1Pct: null, priceChangeH24Pct: 1, volumeH24Usd: null, liquidityUsd: null } });
    const violent = pool({ name: "V", binStep: 1, market: { source: "dexscreener", dexId: null, pairAddress: null, priceChangeH1Pct: null, priceChangeH24Pct: 400, volumeH24Usd: null, liquidityUsd: null } });
    expect(assumedLiquidityBins(quiet)).toBe(20);
    expect(assumedLiquidityBins(violent)).toBe(400);
  });

  it("accrues less than the TVL share when liquidity is not all in the active bin", () => {
    const market = pool({
      name: "MEME-SOL",
      tokenX: token("MEME", "meme-mint", 1),
      tokenY: token("SOL", SOL, 100),
      currentPrice: 0.01,
      binStep: 80,
      tvlUsd: 100_000,
      fees: { "1h": 1_000, "24h": 20_000 },
      market: { source: "dexscreener", dexId: null, pairAddress: null, priceChangeH1Pct: null, priceChangeH24Pct: 40, volumeH24Usd: null, liquidityUsd: null },
    });
    const strategy = quoteStrategy();
    const opened = openPaperPosition({ pool: market, strategy, sizeUsd: 250, nowMs: Date.UTC(2026, 9, 9) });
    const share = advancePosition({ position: opened, pool: market, nowMs: Date.UTC(2026, 9, 9, 1), elapsedHours: 1, feeModel: "tvl-share" });
    const active = advancePosition({
      position: opened,
      pool: market,
      nowMs: Date.UTC(2026, 9, 9, 1),
      elapsedHours: 1,
      feeModel: "active-bin",
      liquidityBins: assumedLiquidityBins(market),
    });
    expect(share.position.feesUsd).toBeGreaterThan(0);
    expect(active.position.feesUsd).toBeLessThan(share.position.feesUsd * 0.5);
  });
});

describe("frozen strategy", () => {
  it("loads the versioned file and rejects a parameter drift", () => {
    const frozen = loadFrozenStrategy(resolve(process.cwd(), "strategies/frozen/high-vol-2026-10-09.json"));
    expect(frozen.version).toBe("2026-10-09");
    expect(frozen.strategy.shape).toBe("BidAsk");
    expect(frozen.strategy.binsBelow).toBe(40);
    expect(frozen.strategy.binsAbove).toBe(0);
    expect(frozen.strategy.quoteSide).toBe("quote");
    expect(frozen.strategy.exit.stopLossPct).toBe(0.08);
    expect(frozen.strategy.exit.takeProfitPct).toBe(0.15);
    expect(frozen.parameterHash).toBe(parameterHash(frozen.strategy));
    expect(frozen.parameterHash).toHaveLength(64);
  });

  it("does not open a second position on a pool already in the frozen book", () => {
    const frozen = loadFrozenStrategy(resolve(process.cwd(), "strategies/frozen/high-vol-2026-10-09.json"));
    const book = emptyFrozenBook(frozen, Date.UTC(2026, 9, 9), 250, 100);
    const market = pool({ name: "MEME-SOL", address: "meme-pool", tokenX: token("MEME", "meme-mint", 1), tokenY: token("SOL", SOL, 100), currentPrice: 0.01 });
    const first = appendFrozenPools({ book, pools: [market, market], strategy: frozen.strategy, sizeUsd: 250, nowMs: Date.UTC(2026, 9, 9) });
    expect(first.added).toEqual(["MEME-SOL"]);
    const again = appendFrozenPools({ book: first.book, pools: [market], strategy: frozen.strategy, sizeUsd: 250, nowMs: Date.UTC(2026, 9, 9) });
    expect(again.added).toHaveLength(0);
    expect(again.book.slots).toHaveLength(1);
  });
});

describe("edge stats", () => {
  it("measures the aggregate curve and the top-coin share", () => {
    const drawdown = aggregateDrawdown([
      [{ t: 1, equity: 100 }, { t: 2, equity: 80 }],
      [{ t: 1, equity: 100 }, { t: 2, equity: 100 }],
    ]);
    expect(drawdown.maxDrawdownPct).toBeCloseTo(0.1, 6);
    const share = topCoinShare([
      { key: "a", label: "A", netPnlUsd: 50 },
      { key: "b", label: "B", netPnlUsd: 30 },
      { key: "c", label: "C", netPnlUsd: 20 },
      { key: "d", label: "D", netPnlUsd: -10 },
    ]);
    expect(share.top.map((coin) => coin.label)).toEqual(["A", "B", "C"]);
    expect(share.shareOfNet).toBeCloseTo(100 / 90, 6);
    expect(share.shareOfPositive).toBeCloseTo(1, 6);
  });
});

function quoteStrategy(): StrategyConfig {
  return {
    id: "quote-bidask",
    name: "quote",
    description: "",
    placeholder: false,
    placeholderNote: "",
    docs: ["https://docs.meteora.ag/core-products/dlmm/what-is-dlmm"],
    notes: "",
    product: "dlmm",
    shape: "BidAsk",
    binsBelow: 40,
    binsAbove: 0,
    sidedness: "single-sided-y",
    quoteSide: "quote",
    coinType: "high-vol-trending",
    priority: 0,
    manualOnly: true,
    requires: {},
    when: [],
    exit: {
      onOutOfRange: "close",
      rebalanceEdgeBins: 0,
      stopLossPct: 0.5,
      takeProfitPct: null,
      maxHoldHours: null,
      outOfRangeTimeoutHours: null,
    },
  };
}

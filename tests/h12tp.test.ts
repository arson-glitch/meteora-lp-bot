import { describe, expect, it } from "vitest";
import { afterCostPnlPct, advancePosition, openPaperPosition } from "../src/executor/paper.js";
import { liquidationCost, liquidationCostAllNonSol, stableToSolProceeds, tokenLegToSol } from "../src/math/costs.js";
import { inventoryAmounts } from "../src/executor/pnl.js";
import type { StrategyConfig } from "../src/strategy/schema.js";
import type { DiscoveredPool } from "../src/types.js";
import { pool, token, SOL, USDC } from "./fixtures.js";

const MEME = "Mememint111111111111111111111111111111111";

function strategy(over: Partial<StrategyConfig["exit"]> = {}): StrategyConfig {
  return {
    id: "h12-trial-tp10",
    name: "H12 trial 10% take-profit",
    description: "",
    placeholder: false,
    placeholderNote: "trial, not promoted",
    docs: ["https://docs.meteora.ag/core-products/dlmm/formulas"],
    notes: "",
    product: "dlmm",
    shape: "Spot",
    sidedness: "two-sided",
    binsBelow: 2,
    binsAbove: 2,
    priority: 0,
    manualOnly: true,
    requires: {},
    when: [],
    exit: {
      onOutOfRange: "close",
      rebalanceEdgeBins: 0,
      stopLossPct: 0.18,
      takeProfitPct: 0.1,
      maxHoldHours: null,
      outOfRangeTimeoutHours: 96,
      ...over,
    },
  };
}

function memeSol(tvlUsd: number): DiscoveredPool {
  return pool({
    name: "MEME-SOL",
    address: "meme-sol",
    binStep: 100,
    currentPrice: 0.01,
    tvlUsd,
    baseFeePct: 0.25,
    tokenX: token("MEME", MEME, 1),
    tokenY: token("SOL", SOL, 100),
    fees: { "1h": 0, "24h": 0 },
  });
}

function openAt(market: DiscoveredPool, exit: Partial<StrategyConfig["exit"]>) {
  const position = openPaperPosition({
    pool: market,
    strategy: strategy(exit),
    sizeUsd: 250,
    nowMs: Date.UTC(2026, 9, 11),
  });
  position.feesUsd = 40;
  position.feesX = 20;
  position.feesY = 0.2;
  return position;
}

describe("H12 take-profit after costs", () => {
  it("closes when the after-cost gain clears 10% and the pool can absorb the swap", () => {
    const market = memeSol(50_000_000);
    const position = openAt(market, { takeProfitPct: 0.1, takeProfitAfterCosts: true });
    const before = afterCostPnlPct({ position, pool: market, solPriceUsd: 100, liquidityBins: 20 });
    expect(before).toBeGreaterThanOrEqual(0.1);
    const stepped = advancePosition({
      position,
      pool: market,
      nowMs: Date.UTC(2026, 9, 11, 1),
      elapsedHours: 1,
      feeModel: "crossed-bins",
      liquidityBins: 20,
      solPriceUsd: 100,
    });
    expect(stepped.position.status).toBe("closed");
    expect(stepped.position.closeReason).toBe("take-profit");
    const amounts = inventoryAmounts(stepped.position);
    const cost = liquidationCostAllNonSol({
      pool: market,
      minBinId: stepped.position.minBinId,
      maxBinId: stepped.position.maxBinId,
      activeBinId: stepped.position.activeBinId,
      binStep: stepped.position.binStep,
      rebalanceCount: stepped.position.rebalanceCount,
      liquidityBins: 20,
      solPriceUsd: 100,
      amountX: amounts.amountX + stepped.position.feesX,
      amountY: amounts.amountY + stepped.position.feesY,
      priceXUsd: stepped.position.priceXUsd,
      priceYUsd: stepped.position.priceYUsd,
    });
    expect(cost.exitSlippageUsd).toBeGreaterThan(0);
  });

  it("stays open when only the pre-cost gain clears 10%", () => {
    const market = memeSol(30);
    const position = openAt(market, { takeProfitPct: 0.1, takeProfitAfterCosts: true });
    const after = afterCostPnlPct({ position, pool: market, solPriceUsd: 100, liquidityBins: 40 });
    expect(after).toBeLessThan(0.1);
    const stepped = advancePosition({
      position,
      pool: market,
      nowMs: Date.UTC(2026, 9, 11, 1),
      elapsedHours: 1,
      feeModel: "crossed-bins",
      liquidityBins: 40,
      solPriceUsd: 100,
    });
    expect(stepped.position.status).toBe("open");
    expect(stepped.position.closeReason).toBeUndefined();
  });

  it("still takes profit on mark-to-market when the after-cost flag is off", () => {
    const market = memeSol(30);
    const position = openAt(market, { takeProfitPct: 0.15 });
    const stepped = advancePosition({
      position,
      pool: market,
      nowMs: Date.UTC(2026, 9, 11, 1),
      elapsedHours: 1,
      feeModel: "crossed-bins",
      liquidityBins: 40,
      solPriceUsd: 100,
    });
    expect(stepped.position.closeReason).toBe("take-profit");
  });

  it("keeps the 18% stop on mark-to-market", () => {
    const market = memeSol(400);
    const position = openAt(market, { takeProfitPct: 0.1, takeProfitAfterCosts: true });
    position.feesUsd = 0;
    position.feesX = 0;
    position.feesY = 0;
    for (const bin of position.bins) {
      bin.amountX *= 0.8;
      bin.amountY *= 0.8;
    }
    const stepped = advancePosition({
      position,
      pool: market,
      nowMs: Date.UTC(2026, 9, 11, 1),
      elapsedHours: 1,
      feeModel: "crossed-bins",
      liquidityBins: 40,
      solPriceUsd: 100,
    });
    expect(stepped.position.closeReason).toBe("stop-loss");
  });

  it("matches the single-leg swap on a SOL pair and also sells the quote when neither leg is SOL", () => {
    const market = memeSol(80_000);
    const position = openAt(market, { takeProfitAfterCosts: true });
    const amounts = inventoryAmounts(position);
    const shared = {
      pool: market,
      minBinId: position.minBinId,
      maxBinId: position.maxBinId,
      activeBinId: position.activeBinId,
      binStep: position.binStep,
      rebalanceCount: 0,
      liquidityBins: 30,
      solPriceUsd: 100,
    };
    const leg = tokenLegToSol(position.tokenX, position.tokenY);
    expect(leg).toBe("x");
    const single = liquidationCost({
      ...shared,
      tokenLeg: leg,
      tokenAmount: amounts.amountX + position.feesX,
      tokenPriceUsd: position.priceXUsd,
      otherPriceUsd: position.priceYUsd,
    });
    const both = liquidationCostAllNonSol({
      ...shared,
      amountX: amounts.amountX + position.feesX,
      amountY: amounts.amountY + position.feesY,
      priceXUsd: position.priceXUsd,
      priceYUsd: position.priceYUsd,
    });
    expect(both.exitSlippageUsd).toBeCloseTo(single.exitSlippageUsd, 6);
    expect(both.txFeeUsd).toBeCloseTo(single.txFeeUsd, 6);

    const quote = pool({
      name: "MEME-USDC",
      address: "meme-usdc",
      binStep: 100,
      currentPrice: 1,
      tvlUsd: 80_000,
      baseFeePct: 0.25,
      tokenX: token("MEME", MEME, 1),
      tokenY: token("USDC", USDC, 1),
    });
    const quotePosition = openPaperPosition({
      pool: quote,
      strategy: strategy({ takeProfitAfterCosts: true }),
      sizeUsd: 250,
      nowMs: Date.UTC(2026, 9, 11),
    });
    const quoteAmounts = inventoryAmounts(quotePosition);
    const quoteShared = {
      pool: quote,
      minBinId: quotePosition.minBinId,
      maxBinId: quotePosition.maxBinId,
      activeBinId: quotePosition.activeBinId,
      binStep: quotePosition.binStep,
      rebalanceCount: 0,
      liquidityBins: 30,
      solPriceUsd: 100,
    };
    const quoteSingle = liquidationCost({
      ...quoteShared,
      tokenLeg: "x",
      tokenAmount: quoteAmounts.amountX,
      tokenPriceUsd: quotePosition.priceXUsd,
      otherPriceUsd: quotePosition.priceYUsd,
    });
    const quoteBoth = liquidationCostAllNonSol({
      ...quoteShared,
      amountX: quoteAmounts.amountX,
      amountY: quoteAmounts.amountY,
      priceXUsd: quotePosition.priceXUsd,
      priceYUsd: quotePosition.priceYUsd,
    });
    const quoteMark = quoteAmounts.amountY * quotePosition.priceYUsd;
    expect(quoteBoth.exitSlippageUsd - quoteSingle.exitSlippageUsd).toBeCloseTo(quoteMark - stableToSolProceeds(quoteMark), 4);

    const withFees = liquidationCostAllNonSol({
      ...shared,
      amountX: amounts.amountX + position.feesX + 50,
      amountY: amounts.amountY + position.feesY,
      priceXUsd: position.priceXUsd,
      priceYUsd: position.priceYUsd,
    });
    expect(withFees.exitSlippageUsd).toBeGreaterThan(both.exitSlippageUsd);
  });
});

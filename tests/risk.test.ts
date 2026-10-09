import { describe, expect, it } from "vitest";
import { emptyPaperBook } from "../src/executor/book.js";
import { evaluateOpenRisk, lossAgainstCap } from "../src/executor/risk.js";
import type { PaperPosition } from "../src/types.js";

const now = Date.UTC(2026, 9, 9, 15);
const limits = {
  maxPositionUsd: 250,
  maxOpenPositions: 2,
  dailyLossCapUsd: 100,
  minTvlUsd: 5_000,
  minVolume24hUsd: 10_000,
};

describe("risk limits", () => {
  it("caps size at the configured maximum", () => {
    const decision = evaluateOpenRisk({
      book: emptyPaperBook(now),
      limits,
      requestedUsd: 1_000,
      poolTvlUsd: 50_000,
      poolVolume24hUsd: 20_000,
      nowMs: now,
    });
    expect(decision.ok).toBe(true);
    expect(decision.sizeUsd).toBe(250);
  });

  it("blocks a new open once today's realized loss reaches the cap", () => {
    const book = emptyPaperBook(now);
    book.positions.push({
      status: "closed",
      closedAt: new Date(now).toISOString(),
      realizedPnlUsd: -100,
    } as PaperPosition);
    expect(lossAgainstCap(book, now)).toBe(100);
    const decision = evaluateOpenRisk({
      book,
      limits,
      requestedUsd: 100,
      poolTvlUsd: 50_000,
      poolVolume24hUsd: 20_000,
      nowMs: now,
    });
    expect(decision.ok).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/daily cap/);
  });

  it("blocks when the open-position cap is full", () => {
    const book = emptyPaperBook(now);
    book.positions.push({ status: "open", bins: [], priceXUsd: 1, priceYUsd: 1, claimedFeesUsd: 0, feesUsd: 0, depositedUsd: 10 } as unknown as PaperPosition);
    book.positions.push({ status: "open", bins: [], priceXUsd: 1, priceYUsd: 1, claimedFeesUsd: 0, feesUsd: 0, depositedUsd: 10 } as unknown as PaperPosition);
    const decision = evaluateOpenRisk({
      book,
      limits,
      requestedUsd: 100,
      poolTvlUsd: 50_000,
      poolVolume24hUsd: 20_000,
      nowMs: now,
    });
    expect(decision.ok).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(/open positions/);
  });
});

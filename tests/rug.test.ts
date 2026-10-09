import { describe, expect, it } from "vitest";
import { evaluatePoolRisk } from "../src/rugcheck/checker.js";
import { SOL, USDC, USDT, pool, token } from "./fixtures.js";

const options = {
  failScore: 60,
  minHolders: 30,
  minTvlUsd: 5_000,
  failClosed: true,
};

describe("rug checker", () => {
  it("passes a quote/quote pool without calling RugCheck", async () => {
    let called = false;
    const verdict = await evaluatePoolRisk(
      pool({
        name: "USDC-USDT",
        tokenX: token("USDC", USDC, 1),
        tokenY: token("USDT", USDT, 1, { freezeAuthorityDisabled: false }),
        currentPrice: 1,
      }),
      {
        ...options,
        fetchSummary: async () => {
          called = true;
          return { risks: [] };
        },
      },
    );
    expect(called).toBe(false);
    expect(verdict.ok).toBe(true);
    expect(verdict.warnings.some((warning) => warning.includes("quote"))).toBe(true);
  });

  it("fails a non-quote mint with freeze authority enabled", async () => {
    const verdict = await evaluatePoolRisk(
      pool({
        name: "MEME-SOL",
        tokenX: token("MEME", "meme-mint", 0.1, { freezeAuthorityDisabled: false }),
        tokenY: token("SOL", SOL, 100),
        currentPrice: 0.001,
      }),
      { ...options, fetchSummary: async () => ({ score_normalised: 10, risks: [] }) },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join(" ")).toMatch(/freeze authority/i);
    expect(verdict.fetchedRemote).toBe(true);
  });

  it("fails danger-level RugCheck risks and a high normalised score", async () => {
    const danger = await evaluatePoolRisk(riskyPool(), {
      ...options,
      fetchSummary: async () => ({
        score_normalised: 20,
        risks: [{ name: "Mint Authority still enabled", level: "danger" }],
      }),
    });
    expect(danger.ok).toBe(false);

    const scored = await evaluatePoolRisk(riskyPool(), {
      ...options,
      fetchSummary: async () => ({ score_normalised: 80, risks: [], lpLockedPct: 100 }),
    });
    expect(scored.ok).toBe(false);
    expect(scored.normalisedScore).toBe(80);
  });

  it("fails closed when RugCheck errors", async () => {
    const verdict = await evaluatePoolRisk(riskyPool(), {
      ...options,
      fetchSummary: async () => {
        throw new Error("HTTP 429");
      },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join(" ")).toMatch(/RugCheck request failed/);
  });

  it("passes a mild warning-only summary", async () => {
    const verdict = await evaluatePoolRisk(riskyPool(), {
      ...options,
      fetchSummary: async () => ({
        score_normalised: 24,
        lpLockedPct: 100,
        risks: [{ name: "Low Liquidity", level: "warn", value: "$5000" }],
      }),
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.warnings.some((warning) => warning.includes("Low Liquidity"))).toBe(true);
  });
});

function riskyPool() {
  return pool({
    name: "MEME-SOL",
    tokenX: token("MEME", "meme-mint", 0.1),
    tokenY: token("SOL", SOL, 100),
    currentPrice: 0.001,
    tvlUsd: 20_000,
  });
}

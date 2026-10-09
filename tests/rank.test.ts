import { describe, expect, it } from "vitest";
import { rankPools, selectCandidates } from "../src/scanner/rank.js";
import { pickDexPair } from "../src/scanner/dexscreener.js";
import { pool } from "./fixtures.js";

describe("ranking", () => {
  it("ranks a higher-volume pool above an otherwise identical pool", () => {
    const now = Date.UTC(2026, 9, 9);
    const ranked = rankPools(
      [
        pool({ name: "SMALL", volume: { "24h": 20_000 }, fees: { "24h": 100 } }),
        pool({ name: "LARGE", volume: { "24h": 2_000_000 }, fees: { "24h": 100 } }),
      ],
      now,
    );
    expect(ranked[0]?.name).toBe("LARGE");
    expect(ranked[0]?.score ?? 0).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it("keeps a non-quote pool in the candidate list when the volume leaders are quote pairs", () => {
    const quote = pool({ name: "SOL-USDC" });
    const meme = pool({
      name: "MEME-SOL",
      tokenX: {
        address: "meme",
        symbol: "MEME",
        name: "Meme",
        decimals: 6,
        priceUsd: 0.01,
        holders: 400,
        freezeAuthorityDisabled: true,
        isVerified: false,
        marketCapUsd: 10_000,
      },
    });
    const selected = selectCandidates([quote, quote, meme], 2, (item) => item.tokenX.symbol === "MEME");
    expect(selected.map((item) => item.name)).toContain("MEME-SOL");
  });

  it("prefers the Meteora pair that contains both pool mints", () => {
    const chosen = pickDexPair(
      [
        {
          dexId: "orca",
          pairAddress: "orca",
          liquidity: { usd: 50 },
          baseToken: { address: "token" },
          quoteToken: { address: "other" },
        },
        {
          dexId: "meteora",
          pairAddress: "dlmm",
          liquidity: { usd: 10 },
          baseToken: { address: "token" },
          quoteToken: { address: "quote" },
        },
      ],
      "token",
      "quote",
    );
    expect(chosen?.pairAddress).toBe("dlmm");
  });
});

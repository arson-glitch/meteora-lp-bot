import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { MemoryBookStore, emptyPaperBook } from "../src/executor/book.js";
import { runPipeline, type PipelineDeps } from "../src/pipeline.js";
import { evaluatePoolRisk } from "../src/rugcheck/checker.js";
import { loadStrategies } from "../src/strategy/loader.js";
import type { PnlEvent } from "../src/types.js";
import { SOL, USDC, USDT, pool, token } from "./fixtures.js";

const now = Date.UTC(2026, 9, 9, 12);

describe("paper pipeline", () => {
  it("runs scan -> rug check -> strategy -> paper open and accrues simulated fees", async () => {
    const config = loadConfig({
      MODE: "paper",
      MAX_POSITION_USD: "100",
      MAX_OPEN_POSITIONS: "2",
      DAILY_LOSS_CAP_USD: "50",
      MIN_TVL_USD: "1000",
      MIN_VOLUME_24H_USD: "1000",
      RUG_FAIL_SCORE: "60",
    });
    const events: PnlEvent[] = [];
    const sol = pool({
      name: "SOL-USDC",
      address: "sol-usdc",
      binStep: 4,
      currentPrice: 110,
      tokenX: token("SOL", SOL, 110),
      tvlUsd: 100_000,
      fees: { "1h": 200, "24h": 4_000 },
      score: 90,
    });
    const stable = pool({
      name: "USDC-USDT",
      address: "usdc-usdt",
      binStep: 1,
      currentPrice: 1,
      tokenX: token("USDC", USDC, 1),
      tokenY: token("USDT", USDT, 1),
      tvlUsd: 400_000,
      fees: { "1h": 50, "24h": 1_000 },
      market: {
        source: "dexscreener",
        dexId: "meteora",
        pairAddress: "p",
        priceChangeH1Pct: 0.01,
        priceChangeH24Pct: 0.1,
        volumeH24Usd: 80_000,
        liquidityUsd: 400_000,
      },
      score: 70,
    });
    const meme = pool({
      name: "MEME-SOL",
      address: "meme",
      binStep: 100,
      currentPrice: 0.001,
      tokenX: token("MEME", "meme-mint", 0.1, { freezeAuthorityDisabled: false, isVerified: false }),
      tokenY: token("SOL", SOL, 100),
      tvlUsd: 20_000,
      score: 40,
    });
    const sleeps: number[] = [];
    const deps: PipelineDeps = {
      scan: async () => [sol, stable, meme],
      rugCheck: (candidate, options) =>
        evaluatePoolRisk(candidate, {
          ...options,
          fetchSummary: async () => ({ score_normalised: 10, risks: [] }),
        }),
      strategies: loadStrategies(join(process.cwd(), "strategies")),
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      log: {
        info() {},
        warn() {},
        error() {},
        debug() {},
        pnl(event) {
          events.push(event);
        },
      },
      fetchPool: async () => {
        throw new Error("fresh book should not refetch");
      },
      openLive: async () => {
        throw new Error("paper mode must not open a live position");
      },
    };
    const store = new MemoryBookStore(emptyPaperBook(now));
    const report = await runPipeline(
      config,
      {
        fresh: true,
        horizonHours: 1,
        consider: 5,
        includeDamm: false,
        forceStrategy: false,
        confirmLive: false,
        scanLimit: 10,
        enrichLimit: 0,
      },
      store,
      deps,
    );

    expect(report.mode).toBe("paper");
    expect(report.opened).toBe(2);
    expect(report.decisions.find((decision) => decision.poolName === "MEME-SOL")?.reason).toMatch(/freeze authority/);
    expect(report.decisions.find((decision) => decision.poolName === "SOL-USDC")?.strategyId).toBe("spot-spread");
    expect(report.decisions.find((decision) => decision.poolName === "USDC-USDT")?.strategyId).toBe(
      "spot-concentrated",
    );
    const open = report.book.positions.filter((position) => position.status === "open");
    expect(open).toHaveLength(2);
    expect(open.every((position) => position.feesUsd > 0)).toBe(true);
    expect(open.every((position) => position.placeholderStrategy)).toBe(true);
    expect(events.some((event) => event.type === "open" && event.mode === "paper")).toBe(true);
    expect(events.some((event) => event.type === "mark")).toBe(true);
    expect(sleeps).toEqual([1_100]);
    expect(store.book.positions).toHaveLength(2);
  });
});

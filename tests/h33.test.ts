import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { borrowedRiskHit } from "../src/strategy/constraints.js";
import { replayStrategy } from "../src/tournament/backtest.js";
import type { Candle } from "../src/tournament/candles.js";
import { classicGridCells, gridStrategies } from "../src/tournament/grid.js";
import { appendMatchedSlots } from "../src/tournament/h12matched.js";
import { emptyH12Book, h12TpTrialPath, H12_TRIAL_FILE, loadH12TpTrial, loadH12Trial } from "../src/tournament/h12trial.js";
import {
  age12EntryIndex,
  age12Strategies,
  cleanSnapshotHours,
  countYoungFresh,
  findStat,
  passesAge12,
  preEntryScore,
  projectedTapeHours,
  scoreH33,
  selectH33Pools,
  seriesStartsTooLate,
  solChangeFromPairs,
  solDumpSkips,
  trainScoreCutoff,
  FEE_CHECK_OCT17_ISO,
  FEE_CHECK_OCT17_MIDNIGHT_ISO,
  FEE_CHECK_OCT20_ISO,
  FEE_CHECK_OCT20_MIDNIGHT_ISO,
  H33_REPRESENTATIVE,
  RECORDER_RESTART_ISO,
} from "../src/tournament/h33.js";
import { FROZEN_STRATEGY_FILE, loadFrozenStrategy } from "../src/tournament/frozen.js";
import { pool, token, SOL, USDC } from "./fixtures.js";

const HOUR = 3_600_000;

function bar(timestamp: number, price: number, lpFeesUsd: number): Candle {
  return {
    timestamp,
    open: price,
    high: price * 1.002,
    low: price * 0.998,
    close: price,
    volumeUsd: 1_000,
    lpFeesUsd,
  };
}

function wiggle(startSec: number, count: number, fee: number, spikeFrom?: number): Candle[] {
  const out: Candle[] = [];
  for (let index = 0; index < count; index += 1) {
    const price = 1 + ((index % 5) - 2) * 0.003;
    const fees = spikeFrom !== undefined && index >= spikeFrom ? 50_000 : fee;
    out.push(bar(startSec + index * 3600, price, fees));
  }
  return out;
}

describe("H33 age gate", () => {
  const created = Date.UTC(2026, 9, 14, 0, 0, 0);

  it("rejects an unknown creation time and a pool younger than 12 hours", () => {
    expect(passesAge12(0, created + 48 * HOUR)).toBe(false);
    expect(passesAge12(created, created + 11 * HOUR)).toBe(false);
    expect(passesAge12(created, created + 12 * HOUR)).toBe(true);
    expect(passesAge12(created, created + 13 * HOUR)).toBe(true);
  });

  it("excludes a tape that starts more than two hours after creation", () => {
    const candles = wiggle((created + 3 * HOUR) / 1000, 20, 1);
    expect(seriesStartsTooLate(candles, created)).toBe(true);
    expect(age12EntryIndex(candles, created)).toBeNull();
  });

  it("scores only bars before the delayed entry", () => {
    const start = created / 1000;
    const quiet = wiggle(start, 30, 2);
    const spiked = wiggle(start, 30, 2, 12);
    const earlySpike = wiggle(start, 30, 2, 10);
    const entry = age12EntryIndex(quiet, created);
    expect(entry).toBe(12);
    const calm = preEntryScore(quiet, entry ?? 0, 1, 100_000);
    const after = preEntryScore(spiked, entry ?? 0, 1, 100_000);
    const before = preEntryScore(earlySpike, entry ?? 0, 1, 100_000);
    expect(calm).not.toBeNull();
    expect(after).toBe(calm);
    expect(before).not.toBe(calm);
  });

  it("skips a SOL drop under -5 percent and keeps a missing quote closed", () => {
    expect(solDumpSkips(-5.01)).toBe(true);
    expect(solDumpSkips(-5)).toBe(false);
    expect(solDumpSkips(-4)).toBe(false);
    expect(solDumpSkips(null)).toBe(true);
    expect(solChangeFromPairs([
      { baseToken: { address: SOL }, quoteToken: { address: USDC }, priceChange: { h24: -6 }, liquidity: { usd: 1_000 } },
    ])).toBe(-6);
    expect(solChangeFromPairs([
      { baseToken: { address: USDC }, quoteToken: { address: SOL }, priceChange: { h24: -6 }, liquidity: { usd: 9_000 } },
    ])).toBeNull();
  });
});

describe("H33 books stay beside the frozen rules", () => {
  it("keeps the classic 108 and clones age12 cells without changing that set", () => {
    expect(classicGridCells()).toHaveLength(108);
    const clones = age12Strategies();
    expect(clones).toHaveLength(gridStrategies().length);
    expect(clones.every((strategy) => strategy.id.endsWith("-age12") && strategy.requires.minAgeHours === 12)).toBe(true);
    expect(clones.every((strategy) => borrowedRiskHit(`${strategy.notes} ${strategy.id}`) === null)).toBe(true);
    expect(H33_REPRESENTATIVE.every((id) => gridStrategies().some((strategy) => strategy.id === id))).toBe(true);
    expect(classicGridCells()).toHaveLength(108);
  });

  it("does not change the frozen hashes", () => {
    const h12 = loadH12Trial(join(process.cwd(), H12_TRIAL_FILE));
    const tp10 = loadH12TpTrial(h12TpTrialPath(0.1));
    const frozen = loadFrozenStrategy(join(process.cwd(), FROZEN_STRATEGY_FILE));
    expect(h12.parameterHash).toBe("dcfc7daa72a1e243b8175c861a9ab01f4d69cce7a8b84a32be17b26032ef34e8");
    expect(tp10.parameterHash).toBe("26407d26c0e5987de553eb65f3236ff2452bcd61ca53922125a9792233849e7d");
    expect(frozen.parameterHash).toBe("1457301141599b71eac3716df5acf5522f379e9cab67b480bb24f79cdd2d0b22");
  });

  it("opens one matched pool at the same mark in every book", () => {
    const now = Date.UTC(2026, 9, 14, 12);
    const base = loadH12Trial(join(process.cwd(), H12_TRIAL_FILE));
    const tp = loadH12TpTrial(h12TpTrialPath(0.1));
    const left = emptyH12Book(base, now, 100);
    const right = emptyH12Book(tp, now, 100);
    left.kind = "h12-matched";
    right.kind = "h12-matched";
    const market = pool({
      name: "MATCH-SOL",
      address: "match-pool",
      tokenX: token("MATCH", "match-mint", 0.2, { marketCapUsd: 1_000_000 }),
      tokenY: token("SOL", SOL, 100),
      createdAtMs: now - 48 * HOUR,
    });
    appendMatchedSlots(
      [{ book: left, trial: base }, { book: right, trial: tp }],
      { pool: market, bins: 6, score: 1.2, sigma: 0.4, feeYield: 0.02 },
      now,
    );
    expect(left.slots).toHaveLength(1);
    expect(right.slots).toHaveLength(1);
    expect(left.slots[0]?.position.poolAddress).toBe("match-pool");
    expect(left.slots[0]?.position.poolAddress).toBe(right.slots[0]?.position.poolAddress);
    expect(left.slots[0]?.position.openedAt).toBe(right.slots[0]?.position.openedAt);
    expect(left.parameterHash).toBe(base.parameterHash);
    expect(right.parameterHash).toBe(tp.parameterHash);
  });
});

describe("H33 fresh-pool study", () => {
  it("selects memecoins that were fresh at birth and already 18 hours old", () => {
    const now = Date.UTC(2026, 9, 14, 18);
    const meme = (name: string, ageHours: number) => pool({
      name,
      address: name,
      tokenX: token(name, `${name}-mint`, 0.01, { marketCapUsd: 500_000 }),
      tokenY: token("SOL", SOL, 100),
      createdAtMs: now - ageHours * HOUR,
      tvlUsd: 20_000,
      binStep: 80,
    });
    const rows = [meme("YOUNG", 6), meme("READY", 20), meme("OLD", 20 * 24), pool({ name: "SOL-USDC", createdAtMs: now - 20 * HOUR })];
    expect(selectH33Pools(rows, now).map((item) => item.name)).toEqual(["READY"]);
    expect(countYoungFresh(rows, now)).toBe(1);
  });

  it("keeps a future fee spike and a holdout coin out of the cutoff", () => {
    const created = Date.UTC(2026, 9, 1);
    const start = created / 1000;
    const strategy = gridStrategies().find((item) => item.id === "grid-spot-narrow-two-oor");
    expect(strategy).toBeTruthy();
    const names = ["coin-a", "coin-b", "coin-c", "coin-d", "coin-e", "coin-f"];
    const rows = names.map((name) => {
      const holdout = name === "coin-e" || name === "coin-f";
      return {
        pool: pool({
          name,
          address: name,
          tokenX: token(name, name, 0.01, { marketCapUsd: 500_000 }),
          tokenY: token("SOL", SOL, 100),
          createdAtMs: created,
          tvlUsd: 50_000,
          binStep: 100,
          currentPrice: 1,
        }),
        candles: wiggle(start, 30, holdout ? 400 : 2),
        candleHours: 1,
      };
    });
    const late = {
      pool: pool({
        name: "late",
        address: "late",
        tokenX: token("late", "late", 0.01, { marketCapUsd: 500_000 }),
        tokenY: token("SOL", SOL, 100),
        createdAtMs: created,
        tvlUsd: 50_000,
        binStep: 100,
      }),
      candles: wiggle(start + 5 * 3600, 30, 2),
      candleHours: 1,
    };
    const trainScores = rows
      .filter((row) => row.pool.tokenX.address < "coin-e")
      .map((row) => preEntryScore(row.candles, 12, 1, row.pool.tvlUsd))
      .filter((score): score is number => score !== null);
    const study = scoreH33({
      rows: [...rows, late],
      solCandles: [
        bar(start - 24 * 3600, 1, 0),
        bar(start + 12 * 3600, 0.9, 0),
      ],
      solInvert: false,
      solPriceUsd: 100,
      scannedYoung: 3,
      noTape: 1,
      replayStrategies: strategy ? [strategy] : [],
    });
    expect(study.excludedLate).toBe(1);
    expect(study.cutoff).toBe(trainScoreCutoff(trainScores));
    expect(study.plans.find((plan) => plan.name === "coin-e")?.ageEnters).toBe(true);
    expect(study.dumpPools).toBe(0);
    expect(study.agePools).toBeGreaterThan(0);
    const birth = findStat(study.stats, { arm: "birth", feeModel: "crossed-bins", window: "full", cohort: "train", cell: "classic-108" });
    const age = findStat(study.stats, { arm: "age12", feeModel: "active-bin", window: "full", cohort: "holdout", cell: "classic-108" });
    expect(birth?.entries).toBeGreaterThan(0);
    expect(age?.entries).toBe(2);
    const spiked = wiggle(start, 30, 2, 12);
    expect(preEntryScore(spiked, 12, 1, 50_000)).toBe(preEntryScore(rows[0]?.candles ?? [], 12, 1, 50_000));
  });

  it("does not accrue fees from candles before the entry bar", () => {
    const strategy = gridStrategies().find((item) => item.id === "grid-spot-narrow-two-oor");
    if (!strategy) throw new Error("missing cell");
    const market = pool({
      name: "FEE-SOL",
      address: "fee-pool",
      tokenX: token("FEE", "fee-mint", 1, { marketCapUsd: 1_000_000 }),
      tokenY: token("USDC", USDC, 1),
      tvlUsd: 100_000,
      binStep: 100,
      currentPrice: 1,
    });
    const candles = [5000, 1, 1, 1, 1].map((fee, index) => bar(1_700_000_000 + index * 3600, 1 + index * 0.0001, fee));
    const early = replayStrategy({
      pool: market,
      strategy,
      candles,
      sizeUsd: 250,
      candleHours: 1,
      coinType: "fresh-memecoin",
      split: "train",
      feeModel: "crossed-bins",
      entryIndex: 0,
    });
    const late = replayStrategy({
      pool: market,
      strategy,
      candles,
      sizeUsd: 250,
      candleHours: 1,
      coinType: "fresh-memecoin",
      split: "train",
      feeModel: "crossed-bins",
      entryIndex: 4,
    });
    expect(early?.feesUsd ?? 0).toBeGreaterThan(late?.feesUsd ?? 0);
    expect(late?.feesUsd ?? 0).toBeLessThan(50);
  });
});

describe("recorder hours", () => {
  it("counts only snapshot gaps of at most 30 minutes", () => {
    const start = Date.parse("2026-10-14T07:28:00.000Z");
    const tight = [0, 1, 2, 3, 4, 5, 6].map((step) => start + step * 10 * 60 * 1000);
    expect(cleanSnapshotHours(tight).hours).toBeCloseTo(1, 5);
    expect(cleanSnapshotHours([start, start + 40 * 60 * 1000]).hours).toBe(0);
  });

  it("projects post-gap tape to 17 October and 20 October", () => {
    const restart = Date.parse(RECORDER_RESTART_ISO);
    expect(projectedTapeHours(restart, Date.parse(FEE_CHECK_OCT17_ISO))).toBeCloseTo(72 + 4 / 60, 5);
    expect(projectedTapeHours(restart, Date.parse(FEE_CHECK_OCT20_ISO))).toBeCloseTo(144 + 4 / 60, 5);
    expect(projectedTapeHours(restart, Date.parse(FEE_CHECK_OCT17_MIDNIGHT_ISO))).toBeCloseTo(64 + 32 / 60, 5);
    expect(projectedTapeHours(restart, Date.parse(FEE_CHECK_OCT20_MIDNIGHT_ISO))).toBeCloseTo(136 + 32 / 60, 5);
  });
});

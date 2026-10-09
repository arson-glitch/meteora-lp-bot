import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sleep } from "../http.js";
import { parseStrategy, type StrategyConfig } from "../strategy/schema.js";
import type { CoinType, DiscoveredPool } from "../types.js";
import { replayStrategy, splitCandles, MIN_SERIES_CANDLES, type TrialResult } from "./backtest.js";
import { fetchCandleSeries, type CandleSeries } from "./candles.js";
import {
  assignBuckets,
  CANDIDATES_PER_BUCKET,
  discoverTournamentPools,
  MAX_POOLS_PER_BUCKET,
  type BucketAssignment,
} from "./discover.js";
import { openForwardBook, saveForwardBook, type TournamentForwardBook } from "./forward.js";
import { gridCells, gridStrategies, strategyFromCell, type GridCell } from "./grid.js";
import { renderLeaderboardCsv, renderLeaderboardMarkdown, type PoolSample } from "./report.js";
import { scoreTrials, type BucketLeaderboard } from "./score.js";

export interface TournamentRunOptions {
  nowMs?: number;
  poolsPerBucket?: number;
  sizeUsd?: number;
  reportsDir: string;
  strategiesDir: string;
  forwardPath: string;
  writeForward?: boolean;
  onProgress?: (message: string) => void;
}

export interface TournamentRunResult {
  boards: BucketLeaderboard[];
  samples: PoolSample[];
  trials: number;
  winnerIds: string[];
  forward: TournamentForwardBook | null;
  markdownPath: string;
}

/**
 * Paper tournament. This module does not import the live executor and does
 * not read the 3-position paper book.
 */
export async function runTournament(options: TournamentRunOptions): Promise<TournamentRunResult> {
  const nowMs = options.nowMs ?? Date.now();
  const sizeUsd = options.sizeUsd ?? 250;
  const perBucket = options.poolsPerBucket ?? MAX_POOLS_PER_BUCKET;
  const log = options.onProgress ?? (() => {});
  log("Discovering DLMM pools for the tournament");
  const universe = await discoverTournamentPools(nowMs);
  const buckets = assignBuckets(universe, nowMs, Math.max(perBucket, CANDIDATES_PER_BUCKET));
  log(buckets.map((bucket) => `${bucket.type}: ${bucket.pools.map((pool) => pool.name).join(", ") || "none"}`).join("\n"));

  const cells = gridCells();
  const strategies = gridStrategies();
  const trials: TrialResult[] = [];
  const samples: PoolSample[] = [];
  const played = new Map<CoinType, DiscoveredPool[]>();

  for (const bucket of buckets) {
    let used = 0;
    const accepted: DiscoveredPool[] = [];
    for (const pool of bucket.pools) {
      if (used >= perBucket) break;
      log(`Candles ${bucket.type} ${pool.name}`);
      let series: CandleSeries;
      try {
        series = await fetchCandleSeries(pool, nowMs);
      } catch (error) {
        samples.push(skipped(bucket.type, pool, error instanceof Error ? error.message : String(error)));
        await sleep(200);
        continue;
      }
      await sleep(200);
      if (series.candles.length < MIN_SERIES_CANDLES) {
        samples.push(skipped(bucket.type, pool, `only ${series.candles.length} candles`));
        continue;
      }
      used += 1;
      accepted.push(pool);
      samples.push({
        coinType: bucket.type,
        name: pool.name,
        address: pool.address,
        binStep: pool.binStep,
        tvlUsd: pool.tvlUsd,
        volume24hUsd: pool.volume["24h"] ?? 0,
        candles: series.candles.length,
        timeframe: series.timeframe,
        source: series.source,
        feeSource: series.feeSource,
      });
      const { train, test } = splitCandles(series.candles);
      for (const strategy of strategies) {
        const trainTrial = replayStrategy({
          pool,
          strategy,
          candles: train,
          sizeUsd,
          candleHours: series.candleHours,
          coinType: bucket.type,
          split: "train",
        });
        const testTrial = replayStrategy({
          pool,
          strategy,
          candles: test,
          sizeUsd,
          candleHours: series.candleHours,
          coinType: bucket.type,
          split: "test",
        });
        if (trainTrial) trials.push(trainTrial);
        if (testTrial) trials.push(testTrial);
      }
      log(`Replayed ${pool.name} (${series.candles.length} ${series.timeframe} candles, ${series.feeSource})`);
    }
    played.set(bucket.type, accepted);
  }

  const boards = scoreTrials(trials, cells);
  const generatedAt = new Date(nowMs).toISOString();
  const markdown = renderLeaderboardMarkdown({ generatedAt, sizeUsd, boards, samples });
  const csv = renderLeaderboardCsv(boards);
  mkdirSync(options.reportsDir, { recursive: true });
  const markdownPath = join(options.reportsDir, "leaderboard.md");
  writeFileSync(markdownPath, markdown);
  writeFileSync(join(options.reportsDir, "leaderboard.csv"), csv);
  writeFileSync(
    join(options.reportsDir, "leaderboard.json"),
    JSON.stringify({ generatedAt, sizeUsd, samples, boards, trialCount: trials.length }, null, 2),
  );
  const winnerIds = writeWinners(options.strategiesDir, boards, cells);

  let forward: TournamentForwardBook | null = null;
  if (options.writeForward !== false) {
    const forwardBuckets: BucketAssignment[] = buckets.map((bucket) => {
      const accepted = played.get(bucket.type) ?? [];
      return {
        type: bucket.type,
        pools: (accepted.length > 0 ? accepted : bucket.pools).slice(0, 1),
      };
    });
    forward = openForwardBook({ buckets: forwardBuckets, strategies, sizeUsd, nowMs });
    saveForwardBook(options.forwardPath, forward);
    log(`Opened ${forward.positions.length} forward paper positions`);
  }

  return { boards, samples, trials: trials.length, winnerIds, forward, markdownPath };
}

function writeWinners(strategiesDir: string, boards: BucketLeaderboard[], cells: GridCell[]): string[] {
  const dir = join(strategiesDir, "winners");
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".json")) unlinkSync(join(dir, name));
  }
  const ids: string[] = [];
  for (const board of boards) {
    const winner = board.winner;
    const cell = winner ? cells.find((item) => item.id === winner.strategyId) : undefined;
    if (!winner || !cell) continue;
    const config = strategyFromCell(cell, {
      id: `winner-${board.coinType}`,
      name: `Tournament winner for ${board.coinType}`,
      priority: 200,
      coinType: board.coinType,
      placeholder: false,
      placeholderNote: "Generated by the strategy tournament from a train/test backtest. Not a hand-written placeholder.",
      description: `${cell.shape} / ${cell.width} / ${cell.side} / ${cell.exit} won the ${board.coinType} bucket on the confirmation window.`,
      notes: board.promotionNote,
    });
    const raw = strategyToJson(config);
    const parsed = parseStrategy(raw, `${config.id}.json`);
    writeFileSync(join(dir, `${parsed.id}.json`), `${JSON.stringify(raw, null, 2)}\n`);
    ids.push(parsed.id);
  }
  return ids;
}

function strategyToJson(config: StrategyConfig): unknown {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    placeholder: config.placeholder,
    placeholderNote: config.placeholderNote,
    docs: config.docs,
    notes: config.notes,
    product: config.product,
    shape: config.shape,
    binsBelow: config.binsBelow,
    binsAbove: config.binsAbove,
    sidedness: config.sidedness,
    quoteSide: config.quoteSide ?? null,
    coinType: config.coinType ?? null,
    priority: config.priority,
    manualOnly: config.manualOnly,
    requires: config.requires,
    when: config.when,
    exit: {
      onOutOfRange: config.exit.onOutOfRange,
      rebalanceEdgeBins: config.exit.rebalanceEdgeBins,
      stopLossPct: config.exit.stopLossPct,
      takeProfitPct: config.exit.takeProfitPct,
      maxHoldHours: config.exit.maxHoldHours,
      outOfRangeTimeoutHours: config.exit.outOfRangeTimeoutHours ?? null,
    },
  };
}

function skipped(coinType: CoinType, pool: DiscoveredPool, reason: string): PoolSample {
  return {
    coinType,
    name: pool.name,
    address: pool.address,
    binStep: pool.binStep,
    tvlUsd: pool.tvlUsd,
    volume24hUsd: pool.volume["24h"] ?? 0,
    candles: 0,
    timeframe: "—",
    source: "—",
    feeSource: "—",
    skippedReason: reason,
  };
}

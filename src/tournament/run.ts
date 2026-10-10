import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sleep } from "../http.js";
import { assumedLiquidityBins } from "../math/activeBin.js";
import { parseStrategy, type StrategyConfig } from "../strategy/schema.js";
import type { CoinType, DiscoveredPool } from "../types.js";
import { replayStrategy, splitCandles, MIN_SERIES_CANDLES, type TrialResult } from "./backtest.js";
import { fetchCandleSeries, seriesSpanDays, type Candle, type CandleSeries } from "./candles.js";
import { sampleKey } from "./classify.js";
import {
  CANDIDATE_COINS_PER_BUCKET,
  discoverTournamentPools,
  enrichPriceChange,
  selectTournamentBuckets,
  TARGET_COINS_PER_BUCKET,
  type BucketAssignment,
} from "./discover.js";
import { splitCoinKeys } from "./holdout.js";
import { loadForwardBook, openForwardBook, saveForwardBook, type TournamentForwardBook } from "./forward.js";
import { gridCells, gridStrategies, strategyFromCell, type GridCell } from "./grid.js";
import { renderLeaderboardCsv, renderLeaderboardMarkdown, type PoolSample } from "./report.js";
import { renderHypotheses, type SizeSweepRow } from "./hypotheses.js";
import { tokenHoldUsd, studyLeaders, type LeaderStudy, type StudyWindow } from "./leaderStudy.js";
import { withCosts } from "./edge.js";
import { solPriceUsd } from "./frozenBook.js";
import { scoreTrials, type BucketLeaderboard } from "./score.js";

export interface TournamentRunOptions {
  nowMs?: number;
  poolsPerBucket?: number;
  sizeUsd?: number;
  reportsDir: string;
  strategiesDir: string;
  forwardPath: string;
  writeForward?: boolean;
  universe?: DiscoveredPool[];
  onProgress?: (message: string) => void;
}

export interface TournamentRunResult {
  boards: BucketLeaderboard[];
  samples: PoolSample[];
  trials: number;
  winnerIds: string[];
  forward: TournamentForwardBook | null;
  markdownPath: string;
  leaders: LeaderStudy[];
  solPriceUsd: number;
}

/**
 * Paper tournament. This module does not import the live executor and does
 * not read the 3-position paper book.
 */
export async function runTournament(options: TournamentRunOptions): Promise<TournamentRunResult> {
  const nowMs = options.nowMs ?? Date.now();
  const sizeUsd = options.sizeUsd ?? 250;
  const coinTarget = options.poolsPerBucket ?? TARGET_COINS_PER_BUCKET;
  const log = options.onProgress ?? (() => {});
  log("Discovering DLMM pools for the tournament");
  const universe = options.universe ?? (await discoverTournamentPools(nowMs));
  let buckets = selectTournamentBuckets(universe, nowMs, Math.max(coinTarget, CANDIDATE_COINS_PER_BUCKET));
  const primary = buckets.flatMap((bucket) => {
    const seen = new Set<string>();
    return bucket.pools.filter((pool) => {
      const key = sampleKey(pool);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
  log(`Enriching price change for ${primary.length} coins`);
  await enrichPriceChange(primary);
  buckets = selectTournamentBuckets(universe, nowMs, Math.max(coinTarget, CANDIDATE_COINS_PER_BUCKET));
  log(buckets.map((bucket) => `${bucket.type}: ${uniqueNames(bucket.pools)}`).join("\n"));

  const cells = gridCells();
  const strategies = gridStrategies();
  const price = await solPriceUsd(universe);
  log(`Scoring with crossed-bin fees and exit costs at SOL $${price.toFixed(2)}`);
  const sweepPools: Array<{ coinType: CoinType; pool: DiscoveredPool; candles: Candle[]; candleHours: number }> = [];
  const trials: TrialResult[] = [];
  const samples: PoolSample[] = [];
  const windows: StudyWindow[] = [];
  const played = new Map<CoinType, DiscoveredPool[]>();

  for (const bucket of buckets) {
    const ready: Array<{ pool: DiscoveredPool; series: CandleSeries }> = [];
    const coins = new Set<string>();
    for (const pool of bucket.pools) {
      const key = sampleKey(pool);
      const primaryCoin = !coins.has(key);
      if (primaryCoin && coins.size >= coinTarget) continue;
      if (!primaryCoin && !coins.has(key)) continue;
      log(`Candles ${bucket.type} ${pool.name}`);
      let series: CandleSeries;
      try {
        series = await fetchCandleSeries(pool, nowMs);
      } catch (error) {
        samples.push(skipped(bucket.type, pool, error instanceof Error ? error.message : String(error)));
        await sleep(120);
        continue;
      }
      await sleep(120);
      if (series.candles.length < MIN_SERIES_CANDLES) {
        samples.push(skipped(bucket.type, pool, `only ${series.candles.length} candles`));
        continue;
      }
      if (primaryCoin) coins.add(key);
      ready.push({ pool, series });
    }
    const { trainKeys, holdoutKeys } = splitCoinKeys([...coins]);
    const trainKeySet = new Set(trainKeys);
    const holdoutKeySet = new Set(holdoutKeys);
    log(`${bucket.type}: ${trainKeys.length} train coins, ${holdoutKeys.length} holdout coins, ${ready.length} pools`);
    const accepted: DiscoveredPool[] = [];
    for (const { pool, series } of ready) {
      const key = sampleKey(pool);
      const holdout = holdoutKeySet.has(key);
      if (!holdout && !trainKeySet.has(key)) continue;
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
        spanDays: seriesSpanDays(series),
        role: holdout ? "holdout" : "train",
      });
      if (holdout) {
        windows.push({
          coinType: bucket.type,
          pool,
          candles: series.candles,
          candleHours: series.candleHours,
          split: "holdout",
          key,
          label: pool.name,
        });
        if (!sweepPools.some((item) => item.coinType === bucket.type)) {
          sweepPools.push({ coinType: bucket.type, pool, candles: series.candles, candleHours: series.candleHours });
        }
        for (const strategy of strategies) {
          const trial = scoreReplay({
            pool,
            strategy,
            candles: series.candles,
            sizeUsd,
            candleHours: series.candleHours,
            coinType: bucket.type,
            split: "holdout",
            solPriceUsd: price,
            coinKey: key,
          });
          if (trial) trials.push(trial);
        }
      } else {
        const { train, test } = splitCandles(series.candles);
        windows.push({
          coinType: bucket.type,
          pool,
          candles: train,
          candleHours: series.candleHours,
          split: "train",
          key,
          label: pool.name,
        });
        if (test.length >= 2) {
          windows.push({
            coinType: bucket.type,
            pool,
            candles: test,
            candleHours: series.candleHours,
            split: "test",
            key,
            label: pool.name,
          });
        }
        for (const strategy of strategies) {
          const trainTrial = scoreReplay({
            pool,
            strategy,
            candles: train,
            sizeUsd,
            candleHours: series.candleHours,
            coinType: bucket.type,
            split: "train",
            solPriceUsd: price,
            coinKey: key,
          });
          const testTrial = scoreReplay({
            pool,
            strategy,
            candles: test,
            sizeUsd,
            candleHours: series.candleHours,
            coinType: bucket.type,
            split: "test",
            solPriceUsd: price,
            coinKey: key,
          });
          if (trainTrial) trials.push(trainTrial);
          if (testTrial) trials.push(testTrial);
        }
      }
      log(`Replayed ${pool.name} (${series.candles.length} ${series.timeframe}, ${holdout ? "holdout" : "train"})`);
    }
    played.set(bucket.type, accepted);
  }

  const boards = scoreTrials(trials, cells);
  log(`Cost study of the leading cell in each bucket at SOL $${price.toFixed(2)}`);
  const leaders = studyLeaders({ boards, windows, solPriceUsd: price, sizeUsd });
  const sweep = sizeSweep({ pools: sweepPools, sizeUsd, solPriceUsd: price });
  for (const study of leaders) {
    log(`${study.coinType} ${study.strategyId}${study.promoted ? " promoted" : ""}`);
  }
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
  const hypothesisPath = join(options.reportsDir, `hypotheses-${generatedAt.slice(0, 10)}.md`);
  writeFileSync(
    hypothesisPath,
    renderHypotheses({
      generatedAt,
      sizeUsd,
      solPriceUsd: price,
      trials,
      pools: universe,
      sweep,
    }),
  );
  log(`Hypotheses: ${hypothesisPath}`);

  let forward: TournamentForwardBook | null = null;
  if (options.writeForward !== false) {
    if (existsSync(options.forwardPath)) {
      forward = loadForwardBook(options.forwardPath);
      log(`Left existing forward book in place (${forward.positions.length} positions)`);
    } else {
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
  }

  return { boards, samples, trials: trials.length, winnerIds, forward, markdownPath, leaders, solPriceUsd: price };
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
      ...(config.exit.compositeExit ? { compositeExit: true } : {}),
    },
    ...(config.stayInBinArray ? { stayInBinArray: true } : {}),
  };
}

function scoreReplay(params: {
  pool: DiscoveredPool;
  strategy: StrategyConfig;
  candles: Candle[];
  sizeUsd: number;
  candleHours: number;
  coinType: CoinType;
  split: "train" | "test" | "holdout";
  solPriceUsd: number;
  coinKey: string;
}): TrialResult | null {
  const liquidityBins = assumedLiquidityBins(params.pool);
  const played = replayStrategy({
    pool: params.pool,
    strategy: params.strategy,
    candles: params.candles,
    sizeUsd: params.sizeUsd,
    candleHours: params.candleHours,
    coinType: params.coinType,
    split: params.split,
    feeModel: "crossed-bins",
    liquidityBins,
  });
  if (!played) return null;
  const priced = withCosts(played, params.pool, params.solPriceUsd, liquidityBins);
  const hold = tokenHoldUsd(params.pool, params.candles, params.sizeUsd);
  priced.coinKey = params.coinKey;
  priced.vsTokenUsd = priced.equityUsd - hold.usd;
  priced.poolShare = params.pool.tvlUsd > 0 ? params.sizeUsd / params.pool.tvlUsd : 0;
  return priced;
}

function sizeSweep(params: {
  pools: Array<{ coinType: CoinType; pool: DiscoveredPool; candles: Candle[]; candleHours: number }>;
  sizeUsd: number;
  solPriceUsd: number;
}): SizeSweepRow[] {
  const strategy = gridStrategies().find((item) => item.id === "grid-spot-broad-two-stay");
  if (!strategy || params.pools.length === 0) return [];
  const sizes = [50, params.sizeUsd, 1_000, 5_000];
  return sizes.map((size) => {
    const nets: number[] = [];
    for (const item of params.pools) {
      const trial = scoreReplay({
        pool: item.pool,
        strategy,
        candles: item.candles,
        sizeUsd: size,
        candleHours: item.candleHours,
        coinType: item.coinType,
        split: "holdout",
        solPriceUsd: params.solPriceUsd,
        coinKey: sampleKey(item.pool),
      });
      if (trial) nets.push(trial.netPnlUsd);
    }
    const meanNet = nets.length === 0 ? null : nets.reduce((sum, value) => sum + value, 0) / nets.length;
    return { sizeUsd: size, n: nets.length, meanNetUsd: meanNet };
  });
}

function uniqueNames(pools: DiscoveredPool[]): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const pool of pools) {
    const key = sampleKey(pool);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(pool.name);
  }
  return names.join(", ") || "none";
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

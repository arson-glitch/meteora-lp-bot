import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CoinType } from "../types.js";
import { COIN_TYPES } from "./classify.js";
import { sampleKey } from "./classify.js";
import {
  CANDIDATE_COINS_PER_BUCKET,
  discoverTournamentPools,
  enrichPriceChange,
  selectTournamentBuckets,
  TARGET_COINS_PER_BUCKET,
} from "./discover.js";
import {
  appendForwardPools,
  forwardStatus,
  loadForwardBookIfPresent,
  markForwardBook,
  saveForwardBook,
  type ForwardStatus,
} from "./forward.js";
import { FROZEN_STRATEGY_FILE } from "./frozen.js";
import { syncFrozenHighVolBook, type FrozenBookStatus } from "./frozenBook.js";
import { gridStrategies } from "./grid.js";
import type { BucketLeaderboard } from "./score.js";
import { runTournament } from "./run.js";

export interface DailyOptions {
  nowMs?: number;
  reportsDir: string;
  strategiesDir: string;
  forwardPath: string;
  sizeUsd?: number;
  poolsPerBucket?: number;
  frozenPath?: string;
  frozenBookPath?: string;
  onProgress?: (message: string) => void;
}

/**
 * Paper-only daily pass: mark the forward book, open the grid on one new
 * pool per bucket, rerun the tournament, and write reports/daily/YYYY-MM-DD.md.
 * This module does not import the live executor.
 */
export async function runDaily(options: DailyOptions): Promise<string> {
  const nowMs = options.nowMs ?? Date.now();
  const sizeUsd = options.sizeUsd ?? 250;
  const log = options.onProgress ?? (() => {});
  const prior = readPrior(join(options.reportsDir, "leaderboard.json"));
  let marked: ForwardStatus | null = null;
  if (existsSync(options.forwardPath)) {
    log("Marking forward paper positions");
    const book = await markForwardBook(options.forwardPath, nowMs);
    marked = forwardStatus(book);
  } else {
    log("No forward book yet");
  }

  log("Scanning for new forward pools");
  const universe = await discoverTournamentPools(nowMs);
  const coinTarget = options.poolsPerBucket ?? TARGET_COINS_PER_BUCKET;
  const shortlist = selectTournamentBuckets(universe, nowMs, Math.max(coinTarget, CANDIDATE_COINS_PER_BUCKET));
  const primary = shortlist.flatMap((bucket) => {
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
  const buckets = selectTournamentBuckets(universe, nowMs, coinTarget);
  const book = loadForwardBookIfPresent(options.forwardPath, nowMs, sizeUsd);
  const appended = appendForwardPools({
    book,
    buckets,
    strategies: gridStrategies(),
    sizeUsd,
    nowMs,
    knownPools: universe,
  });
  saveForwardBook(options.forwardPath, appended.book);
  log(`Opened ${appended.added.length} new forward pools`);

  const frozen = await syncFrozenHighVolBook({
    path: options.frozenBookPath ?? options.forwardPath.replace(/tournament-forward\.json$/, "frozen-high-vol-forward.json"),
    frozenPath: options.frozenPath ?? FROZEN_STRATEGY_FILE,
    universe,
    nowMs,
    sizeUsd,
    onProgress: log,
  });

  const result = await runTournament({
    nowMs,
    sizeUsd,
    poolsPerBucket: options.poolsPerBucket,
    reportsDir: options.reportsDir,
    strategiesDir: options.strategiesDir,
    forwardPath: options.forwardPath,
    writeForward: false,
    universe,
    onProgress: log,
  });

  const day = new Date(nowMs).toISOString().slice(0, 10);
  const dailyDir = join(options.reportsDir, "daily");
  mkdirSync(dailyDir, { recursive: true });
  const path = join(dailyDir, `${day}.md`);
  writeFileSync(
    path,
    renderDaily({
      generatedAt: new Date(nowMs).toISOString(),
      sizeUsd,
      marked,
      added: appended.added.map((pool) => `${pool.coinType} ${pool.name}`),
      forwardPositions: appended.book.positions.length,
      boards: result.boards,
      prior,
      trials: result.trials,
      frozen,
    }),
  );
  return path;
}

function renderDaily(params: {
  generatedAt: string;
  sizeUsd: number;
  marked: ForwardStatus | null;
  added: string[];
  forwardPositions: number;
  boards: BucketLeaderboard[];
  prior: Map<string, string | null> | null;
  trials: number;
  frozen: FrozenBookStatus;
}): string {
  const lines: string[] = [];
  lines.push(`# Paper daily ${params.generatedAt.slice(0, 10)}`);
  lines.push("");
  lines.push(`Generated ${params.generatedAt}. Deposit size $${params.sizeUsd}. ${params.trials} backtest trials. No live transactions.`);
  lines.push("");
  lines.push("## Forward book");
  lines.push("");
  if (!params.marked) {
    lines.push("There was no forward book to mark before the new trials were opened.");
  } else {
    lines.push(
      `Marked ${params.marked.positions} existing positions: ${params.marked.open} open, ${params.marked.closed} closed, PnL versus deposit $${params.marked.pnlUsd.toFixed(2)}.`,
    );
    lines.push("");
    lines.push("| Bucket | Pool | Open | Closed | PnL vs deposit | Closes |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const pool of params.marked.pools) {
      lines.push(
        `| ${pool.coinType} | ${pool.name} | ${pool.open} | ${pool.closed} | $${pool.pnlUsd.toFixed(2)} | ${pool.closeReasons || "—"} |`,
      );
    }
  }
  lines.push("");
  lines.push(`New forward trials: ${params.added.length ? params.added.join("; ") : "none"}. Book size after opens: ${params.forwardPositions} positions.`);
  lines.push("");
  lines.push("## Leaderboard changes");
  lines.push("");
  lines.push("| Bucket | Previous | Now | Time-test median | Holdout median | Holdout vs hold |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const type of COIN_TYPES) {
    const board = params.boards.find((item) => item.coinType === type);
    const winner = board?.winner;
    const previous = params.prior ? (params.prior.get(type) ?? "none") : "no prior file";
    const now = winner ? winner.strategyId : "not promoted";
    lines.push(
      `| ${type} | ${previous} | ${now} | ${pct(winner?.test.medianReturn ?? null)} | ${pct(winner?.holdout.medianReturn ?? null)} | ${usd(winner?.holdout.meanVsHodl ?? null)} |`,
    );
  }
  lines.push("");
  lines.push("## Versus holding");
  lines.push("");
  lines.push("Dollars versus buying the entry tokens and holding them to the end of the window. A negative number means the LP result lagged that hold. This is the backtest, not the forward book.");
  lines.push("");
  lines.push("| Bucket | Strategy | Train vs hold | Time-split vs hold | Holdout vs hold |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const type of COIN_TYPES) {
    const board = params.boards.find((item) => item.coinType === type);
    const row = board?.winner ?? board?.rows.find((item) => item.train.n > 0);
    if (!row) {
      lines.push(`| ${type} | — | — | — | — |`);
      continue;
    }
    lines.push(
      `| ${type} | \`${row.strategyId}\` | ${usd(row.train.meanVsHodl)} | ${usd(row.test.meanVsHodl)} | ${usd(row.holdout.meanVsHodl)} |`,
    );
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  for (const board of params.boards) lines.push(`- ${board.coinType}: ${board.promotionNote}`);
  lines.push("");
  lines.push("Fee share in the leaderboard is still candle LP fees times position value over frozen TVL. The frozen high-vol book below uses active-bin fee share and subtracts exit slippage, transaction fees, and non-refundable bin-array rent. Daily bars, when used, treat the day's high and low as a path. Holdout coins never enter the ranking. Full rows are in `reports/leaderboard.md`.");
  lines.push("");
  lines.push(renderFrozen(params.frozen));
  lines.push("");
  return lines.join("\n");
}

function readPrior(path: string): Map<string, string | null> | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { boards?: Array<{ coinType?: CoinType; winner?: { strategyId?: string } | null }> };
    const map = new Map<string, string | null>();
    for (const board of raw.boards ?? []) {
      if (!board.coinType) continue;
      map.set(board.coinType, board.winner?.strategyId ?? null);
    }
    return map;
  } catch {
    return null;
  }
}

function renderFrozen(status: FrozenBookStatus): string {
  const lines: string[] = [];
  lines.push("## Frozen high-vol book");
  lines.push("");
  lines.push(`Strategy \`${status.strategyId}\` version ${status.strategyVersion}, parameter hash \`${status.parameterHash}\`. SOL $${status.solPriceUsd.toFixed(2)}. ${status.qualifying} qualifying pools in the scan. Opened ${status.added.length} new paper positions${status.deferred ? `, ${status.deferred} deferred by the 200-per-run cap` : ""}. Book: ${status.positions} positions, ${status.open} open, ${status.closed} closed.`);
  lines.push("");
  lines.push(`Gross PnL versus deposit $${status.grossPnlUsd.toFixed(2)}. Liquidation PnL after exit slippage, transaction fees, and non-refundable bin-array rent $${status.netPnlUsd.toFixed(2)}. Position-account rent is refundable and is not in that cost. This book is separate from the 108-cell forward book.`);
  lines.push("");
  if (status.pools.length === 0) {
    lines.push("No frozen positions yet.");
    lines.push("");
    return lines.join("\n");
  }
  const shown = [...status.pools].sort((a, b) => a.netPnlUsd - b.netPnlUsd).slice(0, 15);
  lines.push("| Pool | Status | Gross PnL | Exit slippage | Tx + bin-array rent | Net PnL |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const pool of shown) {
    lines.push(`| ${pool.name} | ${pool.status} | $${pool.grossPnlUsd.toFixed(2)} | $${pool.exitSlippageUsd.toFixed(2)} | $${pool.txAndRentUsd.toFixed(2)} | $${pool.netPnlUsd.toFixed(2)} |`);
  }
  if (status.pools.length > shown.length) {
    lines.push("");
    lines.push(`Showing the 15 worst net results of ${status.pools.length}.`);
  }
  lines.push("");
  return lines.join("\n");
}

function pct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function usd(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `$${value.toFixed(2)}`;
}

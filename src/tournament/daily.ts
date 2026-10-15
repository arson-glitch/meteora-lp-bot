import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { displayPnlUsd } from "../executor/pnl.js";
import type { RugCheckOptions } from "../rugcheck/checker.js";
import type { CoinType, DiscoveredPool, PaperPosition } from "../types.js";
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
  archiveClosedGridPositions,
  FORWARD_POSITION_CAP,
  forwardStatus,
  gridArchiveDir,
  gridHistory,
  loadForwardBookIfPresent,
  markForwardBook,
  openPositionCount,
  saveForwardBook,
  type ForwardStatus,
} from "./forward.js";
import { FROZEN_STRATEGY_FILE } from "./frozen.js";
import { syncFrozenHighVolBook, type FrozenBookStatus } from "./frozenBook.js";
import { defaultDashboardPaths, writeDashboard } from "./dashboard.js";
import { renderH12Matched, syncH12MatchedBooks } from "./h12matched.js";
import { passesAge12, renderH33Paper, syncH33Paper, type H33PaperSync } from "./h33.js";
import { H12_TRIAL_BOOK, H12_TRIAL_FILE, renderH12TpTrials, renderH12Trial, syncH12TpBooks, syncH12TrialBook, type H12TrialStatus } from "./h12trial.js";
import { gridStrategies } from "./grid.js";
import { forwardStrategySnapshot, type ForwardStrategySnapshot, type LeaderStudy } from "./leaderStudy.js";
import { rugGatePools, type RugHit } from "./rugGate.js";
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
  h12FrozenPath?: string;
  h12BookPath?: string;
  h12CacheDir?: string;
  recorderDb?: string;
  rug?: RugCheckOptions;
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
  const archiveDir = gridArchiveDir(options.forwardPath);
  if (existsSync(options.forwardPath)) {
    log("Marking forward paper positions");
    const markedBook = await markForwardBook(options.forwardPath, nowMs);
    const archived = archiveClosedGridPositions(markedBook, archiveDir, nowMs);
    saveForwardBook(options.forwardPath, archived.book);
    if (archived.archived > 0 && archived.path) log(`Archived ${archived.archived} closed grid positions to ${archived.path}`);
    marked = forwardStatus(gridHistory(archived.book, archiveDir));
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
  const rugHits: RugHit[] = [];
  const noFresh: CoinType[] = [];
  const tooYoung: string[] = [];
  const openBuckets = options.rug ? await gateNewBuckets(buckets, book, universe, options.rug, rugHits, noFresh, tooYoung, nowMs, log) : buckets.map((bucket) => ({
    type: bucket.type,
    pools: bucket.pools.filter((pool) => passesAge12(pool.createdAtMs, nowMs)),
  }));
  const appended = appendForwardPools({
    book,
    buckets: openBuckets,
    strategies: gridStrategies(),
    sizeUsd,
    nowMs,
    knownPools: universe,
  });
  saveForwardBook(options.forwardPath, appended.book);
  log(`Opened ${appended.added.length} new forward pools`);
  const history = gridHistory(appended.book, archiveDir);

  const frozen = await syncFrozenHighVolBook({
    path: options.frozenBookPath ?? options.forwardPath.replace(/tournament-forward\.json$/, "frozen-high-vol-forward.json"),
    frozenPath: options.frozenPath ?? FROZEN_STRATEGY_FILE,
    universe,
    nowMs,
    sizeUsd,
    rug: options.rug,
    onProgress: log,
  });

  const h12CacheDir = options.h12CacheDir ?? join(process.cwd(), "data/h12");
  const h12 = await syncH12TrialBook({
    path: options.h12BookPath ?? join(process.cwd(), H12_TRIAL_BOOK),
    frozenPath: options.h12FrozenPath ?? join(process.cwd(), H12_TRIAL_FILE),
    cacheDir: h12CacheDir,
    universe,
    nowMs,
    solPriceUsd: frozen.solPriceUsd,
    rug: options.rug,
    onProgress: log,
  });
  const h12Tp = await syncH12TpBooks({
    cacheDir: h12CacheDir,
    universe,
    nowMs,
    solPriceUsd: frozen.solPriceUsd,
    rug: options.rug,
    onProgress: log,
  });
  const matched = await syncH12MatchedBooks({
    cacheDir: h12CacheDir,
    universe,
    nowMs,
    solPriceUsd: frozen.solPriceUsd,
    rug: options.rug,
    onProgress: log,
  });
  const h33 = await syncH33Paper({
    cacheDir: h12CacheDir,
    universe,
    nowMs,
    solPriceUsd: frozen.solPriceUsd,
    rug: options.rug,
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
      forwardPositions: history.positions.length,
      activeOpen: openPositionCount(appended.book),
      boards: result.boards,
      prior,
      trials: result.trials,
      frozen,
      leaders: result.leaders,
      solPriceUsd: result.solPriceUsd,
      positions: history.positions,
      pools: universe,
      openedAt: new Date(nowMs).toISOString(),
      rugs: rugHits,
      noFresh,
      tooYoung,
      poolTypes: new Map(history.pools.map((pool) => [pool.address, pool.coinType])),
      h12,
      h12Tp,
      matched,
      h33,
    }),
  );
  const dash = await writeDashboard({
    ...defaultDashboardPaths(options.reportsDir, options.recorderDb, nowMs),
    h12BookPath: options.h12BookPath ?? join(process.cwd(), H12_TRIAL_BOOK),
    frozenBookPath: options.frozenBookPath ?? options.forwardPath.replace(/tournament-forward\.json$/, "frozen-high-vol-forward.json"),
    forwardPath: options.forwardPath,
    pools: universe,
  });
  log(`Dashboard ${dash}`);
  return path;
}

async function gateNewBuckets(
  buckets: ReturnType<typeof selectTournamentBuckets>,
  book: ReturnType<typeof loadForwardBookIfPresent>,
  universe: DiscoveredPool[],
  rug: RugCheckOptions,
  hits: RugHit[],
  noFresh: CoinType[],
  tooYoung: string[],
  nowMs: number,
  log: (message: string) => void,
): Promise<ReturnType<typeof selectTournamentBuckets>> {
  const addresses = new Set(book.pools.map((pool) => pool.address));
  const keys = new Set(book.pools.map((pool) => pool.sampleKey).filter((key): key is string => Boolean(key)));
  for (const meta of book.pools) {
    if (meta.sampleKey) continue;
    const match = universe.find((pool) => pool.address === meta.address);
    if (!match) continue;
    meta.sampleKey = sampleKey(match);
    keys.add(meta.sampleKey);
  }
  const gated = [];
  for (const bucket of buckets) {
    const unseen = bucket.pools.filter((pool) => !addresses.has(pool.address) && !keys.has(sampleKey(pool)));
    const young = unseen.filter((pool) => !passesAge12(pool.createdAtMs, nowMs));
    if (young.length > 0) tooYoung.push(`${bucket.type}: ${young.map((pool) => pool.name).join(", ")}`);
    const candidates = unseen.filter((pool) => passesAge12(pool.createdAtMs, nowMs));
    if (candidates.length === 0) {
      noFresh.push(bucket.type);
      gated.push({ type: bucket.type, pools: [] });
      continue;
    }
    log(`Rug-checking new ${bucket.type} pools`);
    const result = await rugGatePools({ pools: candidates, coinType: bucket.type, options: rug, accept: 1 });
    hits.push(...result.hits);
    gated.push({ type: bucket.type, pools: result.passed });
  }
  return gated;
}

function renderDaily(params: {
  generatedAt: string;
  sizeUsd: number;
  marked: ForwardStatus | null;
  added: string[];
  forwardPositions: number;
  activeOpen: number;
  boards: BucketLeaderboard[];
  prior: Map<string, string | null> | null;
  trials: number;
  frozen: FrozenBookStatus;
  leaders: LeaderStudy[];
  solPriceUsd: number;
  positions: PaperPosition[];
  pools: DiscoveredPool[];
  openedAt: string;
  rugs: RugHit[];
  noFresh: CoinType[];
  tooYoung: string[];
  poolTypes: Map<string, string>;
  h12: H12TrialStatus;
  h12Tp: H12TrialStatus[];
  matched: Awaited<ReturnType<typeof syncH12MatchedBooks>>;
  h33: H33PaperSync;
}): string {
  const lines: string[] = [];
  lines.push(`# Paper daily ${params.generatedAt.slice(0, 10)}`);
  lines.push("");
  lines.push(`Generated ${params.generatedAt}. Deposit size $${params.sizeUsd}. SOL $${params.solPriceUsd.toFixed(2)}. ${params.trials} backtest trials. Paper only: no wallet, no signed transaction.`);
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
  lines.push(`New forward trials: ${params.added.length ? params.added.join("; ") : "none"}. Active book: ${params.activeOpen} open positions. The ${FORWARD_POSITION_CAP.toLocaleString("en-US")} cap counts open positions. Combined with archived closes: ${params.forwardPositions} positions.`);
  lines.push("");
  lines.push("New opens skip a pool younger than 12 hours, or a pool whose creation time is missing. After 12 hours a pool is opened only if it is still in that coin type and passes the rug check. Existing positions are left as they are. The H12 books already require 14 daily bars, so this gate does not change their entry list.");
  if (params.tooYoung.length > 0) {
    lines.push("");
    lines.push(`Left closed because the pool was under 12 hours: ${params.tooYoung.join("; ")}.`);
  }
  if (params.noFresh.length > 0) {
    lines.push("");
    lines.push(`No unseen pool remained in the scan for: ${params.noFresh.join(", ")}.`);
  }
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
  lines.push("### Promoted and demoted");
  lines.push("");
  for (const line of promotionMoves(params.prior, params.boards)) lines.push(`- ${line}`);
  lines.push("");
  lines.push("## Versus holding");
  lines.push("");
  lines.push("Dollars versus buying the entry tokens and holding them to the end of the window. A negative number means the LP result lagged that hold. This is the backtest, not the forward book.");
  lines.push("");
  lines.push("| Bucket | Strategy | Train vs hold | Time-split vs hold | Holdout vs hold |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const type of COIN_TYPES) {
    const board = params.boards.find((item) => item.coinType === type);
    const row = board?.winner ?? board?.rows.find((item) => item.trainRank === 1);
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
  lines.push("The ranking above still uses candle LP fees times position value over frozen TVL, with no exit slippage and no rent. The next section replays only the leading cell and subtracts those costs. It is still the TVL-share fee model. Yesterday's active-bin pass on the frozen high-vol cell took the edge away, so a positive TVL-share number is not a per-bin result. The frozen high-vol book later in this file marks with active-bin fees.");
  lines.push("");
  lines.push(renderLeaders(params));
  lines.push(renderLosses(params.positions, params.openedAt, params.marked));
  lines.push(renderRugs("New challenger pools", params.rugs));
  lines.push(renderFrozen(params.frozen));
  lines.push(renderRugs("Frozen high-vol opens", params.frozen.rugs));
  lines.push(renderH12Trial(params.h12));
  lines.push(renderRugs("H12 trial opens", params.h12.rugs));
  lines.push(renderH12TpTrials(params.h12Tp));
  const tpRugs = params.h12Tp[0]?.rugs ?? [];
  if (tpRugs.length > 0) lines.push(renderRugs("H12 take-profit opens", tpRugs));
  lines.push(renderH12Matched(params.matched));
  if (params.matched.rugs.length > 0) lines.push(renderRugs("H12 matched opens", params.matched.rugs));
  lines.push(renderH33Paper(params.h33));
  if (params.h33.rugs.length > 0) lines.push(renderRugs("H33 age-filter opens", params.h33.rugs));
  lines.push("");
  return lines.join("\n");
}

function promotionMoves(prior: Map<string, string | null> | null, boards: BucketLeaderboard[]): string[] {
  const lines: string[] = [];
  for (const type of COIN_TYPES) {
    const previous = prior?.get(type) ?? null;
    const now = boards.find((board) => board.coinType === type)?.winner?.strategyId ?? null;
    if (previous && previous !== now) {
      lines.push(now ? `${type}: demoted \`${previous}\`, promoted \`${now}\`.` : `${type}: demoted \`${previous}\`. Nothing is promoted.`);
    } else if (!previous && now) {
      lines.push(`${type}: promoted \`${now}\`.`);
    } else if (previous && previous === now) {
      lines.push(`${type}: \`${now}\` stays promoted.`);
    } else {
      lines.push(`${type}: still not promoted.`);
    }
  }
  return lines;
}

function renderLeaders(params: {
  sizeUsd: number;
  leaders: LeaderStudy[];
  positions: PaperPosition[];
  pools: DiscoveredPool[];
  openedAt: string;
  solPriceUsd: number;
  poolTypes: Map<string, string>;
}): string {
  const lines: string[] = [];
  const poolMap = new Map(params.pools.map((pool) => [pool.address, pool]));
  lines.push("## Leading cell, after costs");
  lines.push("");
  lines.push(`Each figure is a $${params.sizeUsd} paper deposit. Gross is inventory mark plus claimed fees, before costs. Net subtracts exit-swap slippage, signature and priority fees, and non-refundable bin-array rent. Position-account rent is refundable on close and is not in the loss. Impermanent loss is the inventory mark versus holding the tokens the position started with. Versus cash is the net PnL. Versus the token is equity after costs minus buying the volatile asset at the window's first open and holding it to the last close. That token hold is defined only when token X is volatile and token Y is a quote. If both legs are quotes, or the volatile asset is Y, the token hold is the deposit and is not a real token bet.`);
  lines.push("");
  lines.push("Drawdown mean, 5th percentile, and max are the distribution of each trial's own max drawdown, not a combined portfolio path. Forward rows use positions opened before this run. Their 5th percentile and worst figure are returns, not path drawdowns. New opens from today are left out so a zero mark does not dilute the book.");
  lines.push("");
  for (const type of COIN_TYPES) {
    const study = params.leaders.find((item) => item.coinType === type);
    lines.push(`### ${type}`);
    lines.push("");
    if (!study) {
      lines.push("No leading cell. The bucket did not produce a scored strategy.");
      lines.push("");
      continue;
    }
    lines.push(`\`${study.strategyId}\` ${study.promoted ? "is promoted" : "leads training and is not promoted"}. ${study.sentence}.`);
    lines.push("");
    lines.push("| Window | Trials | Coins | Mean gross | Median net | Mean net | Mean IL | Mean slippage | Mean tx + rent | Beat cash | Beat token | Mean vs token |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const split of ["train", "test", "holdout"] as const) {
      const label = split === "test" ? "time-split" : split;
      const gross = study.gross[split];
      const net = study.net[split];
      lines.push(
        `| ${label} | ${net.n} | ${net.coins} | ${usd(gross.meanPnlUsd)} | ${usd(net.medianPnlUsd)} | ${usd(net.meanPnlUsd)} | ${usd(net.meanIlUsd)} | ${usd(net.meanSlippageUsd)} | ${usd(net.meanTxRentUsd)} | ${net.beatCash}/${net.n} | ${net.beatToken}/${net.n} | ${usd(net.meanVsTokenUsd)} |`,
      );
    }
    lines.push("");
    for (const split of ["train", "test", "holdout"] as const) {
      const label = split === "test" ? "time-split" : split;
      const net = study.net[split];
      lines.push(
        `${label} drawdown: mean ${pct(net.drawdown.mean)}, 5th percentile ${pct(net.drawdown.p5)}, max ${pct(net.drawdown.max)}. Return 5th percentile ${pct(net.returns.p5)}. Top coins by net: ${net.topCoinText}. Share of net ${share(net.shareOfNet)}, share of positive PnL ${share(net.shareOfPositive)}. Volatile-token trials ${net.volatileTokenTrials}/${net.n}.`,
      );
    }
    lines.push("");
    const forward = forwardStrategySnapshot({
      positions: params.positions,
      strategyId: study.strategyId,
      pools: poolMap,
      solPriceUsd: params.solPriceUsd,
      openedAt: params.openedAt,
      coinType: type,
      poolTypes: params.poolTypes,
    });
    lines.push(renderForward(forward));
    if (study.net.test.volatileTokenTrials === 0 && study.net.holdout.volatileTokenTrials === 0) {
      lines.push("");
      lines.push("Out-of-sample token-hold comparisons are flat because the volatile leg is not token X against a quote, or both legs are quotes. Beating the token then means the same thing as beating cash.");
    }
    if (study.caution) {
      lines.push("");
      lines.push(study.caution);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderForward(forward: ForwardStrategySnapshot): string {
  if (forward.n === 0) return "Forward paper in this bucket: no earlier positions use this cell.";
  const thin = forward.n < 8 ? ` ${forward.n} positions is too small to treat as a result.` : "";
  return `Forward paper in this bucket: ${forward.n} positions (${forward.open} open, ${forward.closed} closed). Gross ${usd(forward.grossPnlUsd)}, net ${usd(forward.netPnlUsd)}, slippage ${usd(forward.slippageUsd)}, tx + rent ${usd(forward.txRentUsd)}. Versus cash ${usd(forward.vsCashUsd)} (${forward.beatCash}/${forward.n} ahead of cash). Versus the token ${usd(forward.vsTokenUsd)} (${forward.beatToken}/${forward.n} ahead of the token). Mean net return ${pct(forward.meanReturn)}, 5th percentile ${pct(forward.p5Return)}, worst ${pct(forward.worstReturn)}.${thin}`;
}

function renderLosses(positions: PaperPosition[], openedAt: string, marked: ForwardStatus | null): string {
  const lines: string[] = [];
  lines.push("## Large paper losses");
  lines.push("");
  const pools = (marked?.pools ?? []).filter((pool) => pool.pnlUsd < -100).sort((a, b) => a.pnlUsd - b.pnlUsd);
  if (pools.length === 0) lines.push("No forward pool is more than $100 under its deposit in aggregate.");
  else {
    lines.push("Pools whose open and closed positions together are more than $100 under the deposit:");
    lines.push("");
    for (const pool of pools) lines.push(`- ${pool.coinType} ${pool.name}: $${pool.pnlUsd.toFixed(2)} (${pool.closeReasons || "still open"})`);
  }
  const singles = positions
    .filter((position) => position.openedAt !== openedAt)
    .map((position) => ({ position, pnl: displayPnlUsd(position) }))
    .filter((row) => row.pnl < -100)
    .sort((a, b) => a.pnl - b.pnl)
    .slice(0, 15);
  lines.push("");
  if (singles.length === 0) lines.push("No single older position is more than $100 under its deposit.");
  else {
    lines.push("Worst single positions under −$100, excluding today's new opens:");
    lines.push("");
    for (const row of singles) {
      lines.push(`- ${row.position.poolName} \`${row.position.strategyId}\` ${row.position.status}: $${row.pnl.toFixed(2)}${row.position.closeReason ? ` (${row.position.closeReason})` : ""}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderRugs(title: string, hits: RugHit[]): string {
  const lines: string[] = [];
  lines.push(`## Rug checker: ${title}`);
  lines.push("");
  if (hits.length === 0) {
    lines.push("No pool was sent through the rug checker in this pass.");
    lines.push("");
    return lines.join("\n");
  }
  const failed = hits.filter((hit) => !hit.ok);
  const passed = hits.filter((hit) => hit.ok);
  const api = failed.filter((hit) => hit.reasons.length > 0 && hit.reasons.every((reason) => reason.includes("RugCheck request failed")));
  const rejected = failed.filter((hit) => !api.includes(hit));
  lines.push(`Checked ${hits.length}. Passed ${passed.length}. Rejected ${rejected.length}. RugCheck request failed ${api.length}.`);
  lines.push("");
  if (passed.length > 0) lines.push(`Passed: ${passed.map((hit) => `${hit.coinType} ${hit.name}`).join("; ")}.`);
  if (rejected.length === 0 && api.length === 0) {
    lines.push("");
    return lines.join("\n");
  }
  lines.push("");
  lines.push("| Pool | Bucket | Kind | Reasons |");
  lines.push("| --- | --- | --- | --- |");
  for (const hit of [...rejected, ...api]) {
    const kind = api.includes(hit) ? "api-failure" : "rejected";
    lines.push(`| ${hit.name} | ${hit.coinType} | ${kind} | ${hit.reasons.join("; ")} |`);
  }
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
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function share(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

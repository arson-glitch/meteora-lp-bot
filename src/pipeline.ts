import { Connection } from "@solana/web3.js";
import type { AppConfig } from "./config.js";
import { emptyPaperBook, type BookStore } from "./executor/book.js";
import { assertLiveTradingAllowed, openLivePosition } from "./executor/live.js";
import { advancePosition, openPaperPosition, resolvePrices } from "./executor/paper.js";
import { displayPnlUsd, markValueUsd } from "./executor/pnl.js";
import { evaluateOpenRisk } from "./executor/risk.js";
import type { Logger } from "./logger.js";
import { riskTokens } from "./markets.js";
import { evaluatePoolRisk, type RugCheckOptions } from "./rugcheck/checker.js";
import { selectCandidates } from "./scanner/rank.js";
import { fetchDlmmPool } from "./scanner/meteora.js";
import { scanPools, type ScanOptions } from "./scanner/scanner.js";
import { pickStrategy } from "./strategy/picker.js";
import type { StrategyConfig } from "./strategy/schema.js";
import type { DiscoveredPool, PaperBook, PaperPosition, PnlEvent, RugVerdict, RunMode } from "./types.js";

export interface RunOptions {
  fresh: boolean;
  horizonHours: number;
  consider: number;
  includeDamm: boolean;
  strategyId?: string;
  forceStrategy: boolean;
  confirmLive: boolean;
  scanLimit: number;
  enrichLimit: number;
}

export interface Decision {
  poolAddress: string;
  poolName: string;
  product: DiscoveredPool["product"];
  score: number;
  action: string;
  reason: string;
  strategyId?: string;
  positionId?: string;
  rug?: RugVerdict;
}

export interface PipelineReport {
  mode: RunMode;
  scanned: number;
  ranked: DiscoveredPool[];
  decisions: Decision[];
  book: PaperBook;
  opened: number;
  liveSignatures: string[];
}

export interface PipelineDeps {
  scan: (options: ScanOptions) => Promise<DiscoveredPool[]>;
  rugCheck: (pool: DiscoveredPool, options: RugCheckOptions) => Promise<RugVerdict>;
  strategies: StrategyConfig[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: Logger;
  fetchPool: (address: string) => Promise<DiscoveredPool | null>;
  openLive: typeof openLivePosition;
}

export function createDefaultDeps(config: AppConfig, log: Logger, strategies: StrategyConfig[]): PipelineDeps {
  return {
    scan: scanPools,
    rugCheck: evaluatePoolRisk,
    strategies,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log,
    fetchPool: fetchDlmmPool,
    openLive: openLivePosition,
  };
}

export async function runPipeline(
  config: AppConfig,
  options: RunOptions,
  bookStore: BookStore<PaperBook>,
  deps: PipelineDeps,
): Promise<PipelineReport> {
  if (config.mode === "live") assertLiveTradingAllowed(config, options.confirmLive);
  const nowMs = deps.now();
  const book = options.fresh ? emptyPaperBook(nowMs) : bookStore.load();
  book.events = book.events ?? [];
  await markOpenPositions(book, config, deps, undefined);

  const ranked = await deps.scan({
    scanLimit: options.scanLimit,
    includeDamm: options.includeDamm,
    enrichLimit: options.enrichLimit,
    birdeyeApiKey: config.birdeyeApiKey,
    nowMs,
    log: deps.log,
  });
  const tradable = ranked.filter((pool) => pool.product === "dlmm");
  const candidates = selectCandidates(tradable, options.consider, (pool) => riskTokens(pool).length > 0);
  const decisions: Decision[] = [];
  const liveSignatures: string[] = [];
  let opened = 0;

  for (const pool of candidates) {
    const decision = await considerPool(pool, config, options, book, deps, liveSignatures);
    decisions.push(decision);
    if (decision.action === "open") opened += 1;
    if (decision.rug?.fetchedRemote) await deps.sleep(1_100);
  }

  if (options.horizonHours > 0 && config.mode === "paper") {
    const freshIds = new Set(decisions.filter((decision) => decision.action === "open").map((d) => d.positionId));
    for (const position of book.positions) {
      if (!freshIds.has(position.id) || position.status !== "open") continue;
      const pool = ranked.find((item) => item.address === position.poolAddress);
      if (!pool) continue;
      applyAdvance(book, position, pool, deps, config.mode, options.horizonHours);
    }
  }

  book.updatedAt = new Date(deps.now()).toISOString();
  trimEvents(book);
  bookStore.save(book);
  return { mode: config.mode, scanned: ranked.length, ranked, decisions, book, opened, liveSignatures };
}

export async function monitorPositions(
  config: AppConfig,
  bookStore: BookStore<PaperBook>,
  deps: PipelineDeps,
  elapsedHours?: number,
): Promise<PaperBook> {
  const book = bookStore.load();
  await markOpenPositions(book, config, deps, elapsedHours);
  book.updatedAt = new Date(deps.now()).toISOString();
  trimEvents(book);
  bookStore.save(book);
  return book;
}

async function markOpenPositions(
  book: PaperBook,
  config: AppConfig,
  deps: PipelineDeps,
  elapsedHours: number | undefined,
): Promise<void> {
  for (const position of [...book.positions]) {
    if (position.status !== "open") continue;
    const pool = await deps.fetchPool(position.poolAddress);
    if (!pool) {
      deps.log.warn(`No fresh pool snapshot for ${position.poolName} (${position.poolAddress})`);
      continue;
    }
    applyAdvance(book, position, pool, deps, config.mode, elapsedHours);
  }
}

function applyAdvance(
  book: PaperBook,
  position: PaperPosition,
  pool: DiscoveredPool,
  deps: PipelineDeps,
  mode: RunMode,
  elapsedHours: number | undefined,
): void {
  const result = advancePosition({ position, pool, nowMs: deps.now(), elapsedHours });
  const index = book.positions.findIndex((item) => item.id === position.id);
  if (index >= 0) book.positions[index] = result.position;
  for (const event of result.events) {
    record(book, deps, {
      ts: result.position.updatedAt,
      mode,
      type: event.type,
      positionId: result.position.id,
      poolAddress: result.position.poolAddress,
      poolName: result.position.poolName,
      strategyId: result.position.strategyId,
      depositedUsd: result.position.depositedUsd,
      markValueUsd: markValueUsd(result.position),
      feesUsd: result.position.feesUsd,
      claimedFeesUsd: result.position.claimedFeesUsd,
      unrealizedPnlUsd: result.position.status === "open" ? displayPnlUsd(result.position) : undefined,
      realizedPnlUsd: result.position.status === "closed" ? result.position.realizedPnlUsd : undefined,
      detail: event.detail,
    });
  }
}

async function considerPool(
  pool: DiscoveredPool,
  config: AppConfig,
  options: RunOptions,
  book: PaperBook,
  deps: PipelineDeps,
  liveSignatures: string[],
): Promise<Decision> {
  const base = {
    poolAddress: pool.address,
    poolName: pool.name,
    product: pool.product,
    score: pool.score ?? 0,
  };
  const rug = await deps.rugCheck(pool, {
    failScore: config.rugFailScore,
    minHolders: config.rugMinHolders,
    minTvlUsd: config.limits.minTvlUsd,
    failClosed: config.rugFailClosed,
  });
  if (!rug.ok) {
    return { ...base, action: "skip", reason: `rug fail: ${rug.reasons.join("; ")}`, rug };
  }
  const picked = pickStrategy(pool, deps.strategies, {
    nowMs: deps.now(),
    strategyId: options.strategyId,
    force: options.forceStrategy,
  });
  if (!picked.strategy) {
    return { ...base, action: "skip", reason: picked.reason, rug };
  }
  const prices = resolvePrices(pool);
  if (prices.priceXUsd <= 0 || prices.priceYUsd <= 0) {
    return { ...base, action: "skip", reason: "missing token USD prices", rug, strategyId: picked.strategy.id };
  }
  const risk = evaluateOpenRisk({
    book,
    limits: config.limits,
    requestedUsd: config.limits.maxPositionUsd,
    poolTvlUsd: pool.tvlUsd,
    poolVolume24hUsd: pool.volume["24h"] ?? 0,
    nowMs: deps.now(),
  });
  if (!risk.ok) {
    return {
      ...base,
      action: "skip",
      reason: risk.reasons.join("; "),
      rug,
      strategyId: picked.strategy.id,
    };
  }
  if (config.mode === "live") {
    const connection = new Connection(config.rpcUrl, "confirmed");
    const amounts = depositAmounts(picked.strategy, risk.sizeUsd, prices);
    const opened = await deps.openLive({
      config,
      confirmLive: options.confirmLive,
      connection,
      poolAddress: pool.address,
      strategy: picked.strategy,
      amountX: amounts.amountX,
      amountY: amounts.amountY,
      decimalsX: pool.tokenX.decimals,
      decimalsY: pool.tokenY.decimals,
    });
    liveSignatures.push(opened.signature);
    record(book, deps, {
      ts: new Date(deps.now()).toISOString(),
      mode: "live",
      type: "open",
      poolAddress: pool.address,
      poolName: pool.name,
      strategyId: picked.strategy.id,
      depositedUsd: risk.sizeUsd,
      detail: `live signature ${opened.signature} position ${opened.positionPubkey}`,
    });
    return {
      ...base,
      action: "open",
      reason: `live open ${opened.signature}`,
      rug,
      strategyId: picked.strategy.id,
      positionId: opened.positionPubkey,
    };
  }

  let position: PaperPosition;
  try {
    position = openPaperPosition({
      pool,
      strategy: picked.strategy,
      sizeUsd: risk.sizeUsd,
      nowMs: deps.now(),
    });
  } catch (error) {
    return {
      ...base,
      action: "skip",
      reason: error instanceof Error ? error.message : String(error),
      rug,
      strategyId: picked.strategy.id,
    };
  }
  book.positions.push(position);
  record(book, deps, {
    ts: position.openedAt,
    mode: "paper",
    type: "open",
    positionId: position.id,
    poolAddress: pool.address,
    poolName: pool.name,
    strategyId: picked.strategy.id,
    depositedUsd: position.depositedUsd,
    markValueUsd: markValueUsd(position),
    feesUsd: 0,
    unrealizedPnlUsd: 0,
    detail: `${picked.strategy.name} bins ${position.minBinId}..${position.maxBinId} (${position.dynamicPosition ? "dynamic" : "default"} range). ${picked.reason}`,
  });
  return {
    ...base,
    action: "open",
    reason: picked.reason,
    rug,
    strategyId: picked.strategy.id,
    positionId: position.id,
  };
}

function depositAmounts(
  strategy: StrategyConfig,
  sizeUsd: number,
  prices: { priceXUsd: number; priceYUsd: number },
): { amountX: number; amountY: number } {
  if (strategy.sidedness === "single-sided-y" || strategy.binsAbove === 0) {
    return { amountX: 0, amountY: prices.priceYUsd > 0 ? sizeUsd / prices.priceYUsd : 0 };
  }
  if (strategy.sidedness === "single-sided-x" || strategy.binsBelow === 0) {
    return { amountX: prices.priceXUsd > 0 ? sizeUsd / prices.priceXUsd : 0, amountY: 0 };
  }
  return {
    amountX: prices.priceXUsd > 0 ? sizeUsd / 2 / prices.priceXUsd : 0,
    amountY: prices.priceYUsd > 0 ? sizeUsd / 2 / prices.priceYUsd : 0,
  };
}

function record(book: PaperBook, deps: PipelineDeps, event: PnlEvent): void {
  book.events.push(event);
  deps.log.pnl(event);
}

function trimEvents(book: PaperBook): void {
  if (book.events.length > 2_000) book.events.splice(0, book.events.length - 2_000);
}

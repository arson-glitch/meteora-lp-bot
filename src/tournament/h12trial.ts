import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { advancePosition, openPaperPosition } from "../executor/paper.js";
import { displayPnlUsd, inventoryAmounts } from "../executor/pnl.js";
import { assumedLiquidityBins } from "../math/activeBin.js";
import { COST_MODEL_VERSION, liquidationCostAllNonSol, type ExitCost } from "../math/costs.js";
import { binsForSpread, carteaSpread, CARTEA_GAMMA_FIGURE } from "../math/lvr.js";
import type { RugCheckOptions } from "../rugcheck/checker.js";
import { fetchDlmmPool } from "../scanner/meteora.js";
import { parseStrategy, type StrategyConfig } from "../strategy/schema.js";
import type { CoinType, DiscoveredPool, PaperPosition } from "../types.js";
import { fetchCandleWindow, type Candle, type CandleSeries } from "./candles.js";
import { classifyPool } from "./classify.js";
import { costOf } from "./frozenBook.js";
import { tokenHoldUsd } from "./leaderStudy.js";
import { rugGatePools, type RugHit } from "./rugGate.js";
import { quantile } from "./stats.js";
import { entryFeatures, h2Score, H12_LOOKBACK_DAYS, H12_MIN_DAY_SAMPLE } from "./h12walk.js";

export const H12_TRIAL_VERSION = "2026-10-10";
export const H12_TRIAL_STATUS = "trial, not promoted";
export const H12_TRIAL_FILE = "strategies/frozen/h12-trial-2026-10-10.json";
export const H12_TRIAL_BOOK = "data/h12-trial-forward.json";
export const H12_TRIAL_OPEN_CAP = 200;
export const H12_TP_LEVELS = [0.1, 0.15, 0.25, 0.4] as const;

export function h12TpLabel(level: number): string {
  return `tp${Math.round(level * 100)}`;
}

export function h12TpTrialPath(level: number, root = process.cwd()): string {
  return join(root, "strategies/frozen", `h12-trial-${h12TpLabel(level)}-2026-10-11.json`);
}

export function h12TpBookPath(level: number, root = process.cwd()): string {
  return join(root, "data", `h12-trial-${h12TpLabel(level)}-forward.json`);
}

export interface H12TrialRule {
  gamma: number;
  topFraction: number;
  lookbackDays: number;
  sizeUsd: number;
  score: "fee-tvl-over-abs-price-change";
  shape: "Spot";
  sidedness: "two-sided";
  onOutOfRange: "close";
  outOfRangeTimeoutHours: number;
  stopLossPct: number;
  takeProfitPct: number | null;
  /** True only on the take-profit variants. Omitted on the original trial. */
  takeProfitAfterCosts?: boolean;
  status: typeof H12_TRIAL_STATUS;
}

export const H12_TRIAL_RULE: H12TrialRule = {
  gamma: CARTEA_GAMMA_FIGURE,
  topFraction: 0.2,
  lookbackDays: H12_LOOKBACK_DAYS,
  sizeUsd: 250,
  score: "fee-tvl-over-abs-price-change",
  shape: "Spot",
  sidedness: "two-sided",
  onOutOfRange: "close",
  outOfRangeTimeoutHours: 96,
  stopLossPct: 0.18,
  takeProfitPct: null,
  status: H12_TRIAL_STATUS,
};

export interface H12TrialFile {
  version: string;
  frozenAt: string;
  status: typeof H12_TRIAL_STATUS;
  sourceStrategyId: string;
  parameterHash: string;
  costModelVersion: string;
  note: string;
  rule: H12TrialRule;
  strategy: StrategyConfig;
}

export interface H12Slot {
  position: PaperPosition;
  coinType: CoinType;
  binsEachSide: number;
  entryScore: number;
  entrySigma: number;
  entryFeeYield: number;
  entryTvlUsd: number;
  crossedBinFeesUsd: number;
  activeBinFeesUsd: number;
}

export interface H12TrialBook {
  version: 1;
  mode: "paper";
  kind: "h12-trial" | "h12-matched" | "h12-age12";
  status: typeof H12_TRIAL_STATUS;
  strategyId: string;
  strategyVersion: string;
  parameterHash: string;
  rule: H12TrialRule;
  updatedAt: string;
  sizeUsd: number;
  solPriceUsd: number;
  slots: H12Slot[];
}

export interface H12TrialRow {
  name: string;
  address: string;
  coinType: CoinType;
  status: "open" | "closed";
  binsEachSide: number;
  grossPnlUsd: number;
  crossedBinFeesUsd: number;
  activeBinFeesUsd: number;
  exitSlippageUsd: number;
  txAndRentUsd: number;
  netPnlUsd: number;
  vsCashUsd: number;
  vsHoldUsd: number;
  closeReason: string | null;
}

export interface H12TrialStatus {
  status: typeof H12_TRIAL_STATUS;
  strategyId: string;
  strategyVersion: string;
  parameterHash: string;
  solPriceUsd: number;
  scored: number;
  passedQuintile: number;
  withdrew: number;
  qualifying: number;
  positions: number;
  open: number;
  closed: number;
  added: string[];
  deferred: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  vsCashUsd: number;
  vsHoldUsd: number;
  crossedBinFeesUsd: number;
  activeBinFeesUsd: number;
  rows: H12TrialRow[];
  rugs: RugHit[];
}

interface Candidate {
  pool: DiscoveredPool;
  score: number;
  sigma: number;
  feeYield: number;
  bins: number | null;
}

/** Rule hash. Bin counts are an output of the rule, so they are not in the hash. */
export function h12TrialHash(rule: H12TrialRule = H12_TRIAL_RULE): string {
  const canonical = JSON.stringify({
    gamma: rule.gamma,
    lookbackDays: rule.lookbackDays,
    onOutOfRange: rule.onOutOfRange,
    outOfRangeTimeoutHours: rule.outOfRangeTimeoutHours,
    score: rule.score,
    shape: rule.shape,
    sidedness: rule.sidedness,
    sizeUsd: rule.sizeUsd,
    status: rule.status,
    stopLossPct: rule.stopLossPct,
    takeProfitPct: rule.takeProfitPct,
    topFraction: rule.topFraction,
    ...(rule.takeProfitAfterCosts === true ? { takeProfitAfterCosts: true } : {}),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function loadH12Trial(path: string): H12TrialFile {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<H12TrialFile> & { strategy?: unknown; rule?: H12TrialRule };
  if (raw.status !== H12_TRIAL_STATUS) {
    throw new Error(`${path} must be labelled ${H12_TRIAL_STATUS}`);
  }
  if (!raw.rule || typeof raw.parameterHash !== "string") throw new Error(`${path} is not an H12 trial file`);
  const strategy = parseStrategy(raw.strategy, path);
  const hash = h12TrialHash(raw.rule);
  if (hash !== raw.parameterHash) {
    throw new Error(`${path} parameter hash ${raw.parameterHash} does not match ${hash}`);
  }
  if (raw.rule.gamma !== H12_TRIAL_RULE.gamma || raw.rule.topFraction !== H12_TRIAL_RULE.topFraction) {
    throw new Error(`${path} does not match the pre-registered H12 trial`);
  }
  if (raw.rule.takeProfitPct !== null || raw.rule.takeProfitAfterCosts === true) {
    throw new Error(`${path} is a take-profit variant. The original H12 trial does not take profit.`);
  }
  return {
    version: typeof raw.version === "string" ? raw.version : H12_TRIAL_VERSION,
    frozenAt: typeof raw.frozenAt === "string" ? raw.frozenAt : "",
    status: H12_TRIAL_STATUS,
    sourceStrategyId: typeof raw.sourceStrategyId === "string" ? raw.sourceStrategyId : strategy.id,
    parameterHash: hash,
    costModelVersion: typeof raw.costModelVersion === "string" ? raw.costModelVersion : COST_MODEL_VERSION,
    note: typeof raw.note === "string" ? raw.note : "",
    rule: raw.rule,
    strategy,
  };
}

/** A take-profit sub-book. Same rule as the original trial, plus one after-cost level. */
export function loadH12TpTrial(path: string): H12TrialFile {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<H12TrialFile> & { strategy?: unknown; rule?: H12TrialRule };
  if (raw.status !== H12_TRIAL_STATUS) throw new Error(`${path} must be labelled ${H12_TRIAL_STATUS}`);
  if (!raw.rule || typeof raw.parameterHash !== "string") throw new Error(`${path} is not an H12 trial file`);
  const strategy = parseStrategy(raw.strategy, path);
  const hash = h12TrialHash(raw.rule);
  if (hash !== raw.parameterHash) throw new Error(`${path} parameter hash ${raw.parameterHash} does not match ${hash}`);
  if (!sameH12Rule(raw.rule) || raw.rule.takeProfitAfterCosts !== true || !isH12TpLevel(raw.rule.takeProfitPct)) {
    throw new Error(`${path} is not an H12 take-profit variant`);
  }
  if (strategy.exit.takeProfitPct !== raw.rule.takeProfitPct || strategy.exit.takeProfitAfterCosts !== true) {
    throw new Error(`${path} strategy exit does not match its take-profit rule`);
  }
  return {
    version: typeof raw.version === "string" ? raw.version : H12_TRIAL_VERSION,
    frozenAt: typeof raw.frozenAt === "string" ? raw.frozenAt : "",
    status: H12_TRIAL_STATUS,
    sourceStrategyId: typeof raw.sourceStrategyId === "string" ? raw.sourceStrategyId : strategy.id,
    parameterHash: hash,
    costModelVersion: typeof raw.costModelVersion === "string" ? raw.costModelVersion : COST_MODEL_VERSION,
    note: typeof raw.note === "string" ? raw.note : "",
    rule: raw.rule,
    strategy,
  };
}

function sameH12Rule(rule: H12TrialRule): boolean {
  return rule.gamma === H12_TRIAL_RULE.gamma
    && rule.topFraction === H12_TRIAL_RULE.topFraction
    && rule.lookbackDays === H12_TRIAL_RULE.lookbackDays
    && rule.sizeUsd === H12_TRIAL_RULE.sizeUsd
    && rule.score === H12_TRIAL_RULE.score
    && rule.shape === H12_TRIAL_RULE.shape
    && rule.sidedness === H12_TRIAL_RULE.sidedness
    && rule.onOutOfRange === H12_TRIAL_RULE.onOutOfRange
    && rule.outOfRangeTimeoutHours === H12_TRIAL_RULE.outOfRangeTimeoutHours
    && rule.stopLossPct === H12_TRIAL_RULE.stopLossPct
    && rule.status === H12_TRIAL_STATUS;
}

function isH12TpLevel(value: number | null): value is (typeof H12_TP_LEVELS)[number] {
  return value !== null && H12_TP_LEVELS.some((level) => Math.abs(level - value) < 1e-9);
}

/**
 * One cross-section. Fees and the price path are the last `lookbackDays`
 * complete daily bars before `nowMs`. A pool whose Cartea width is not
 * viable is counted as a withdrawal and is not opened.
 */
export function rankH12Candidates(
  rows: Array<{ pool: DiscoveredPool; candles: Candle[]; candleHours: number }>,
  nowMs: number,
  rule: H12TrialRule = H12_TRIAL_RULE,
): { candidates: Candidate[]; passed: Candidate[]; withdrew: number; cutoff: number | null } {
  const dayStart = Math.floor(nowMs / 86_400_000) * 86_400;
  const candidates: Candidate[] = [];
  for (const row of rows) {
    if (row.pool.binStep === null || !(row.pool.tvlUsd > 0)) continue;
    const history = row.candles.filter((candle) => candle.timestamp < dayStart);
    const feature = history.slice(-rule.lookbackDays);
    if (feature.length < rule.lookbackDays) continue;
    if (feature.some((candle) => candle.timestamp >= dayStart)) continue;
    const feat = entryFeatures(feature, row.candleHours, row.pool.tvlUsd);
    if (!feat) continue;
    const delta = carteaSpread({ feeYieldPerDay: feat.feeYield, sigmaDaily: feat.sigma, gamma: rule.gamma });
    const bins = delta === null ? null : binsForSpread(delta, row.pool.binStep);
    candidates.push({
      pool: row.pool,
      score: h2Score(feat.feeYield, feat.absChange),
      sigma: feat.sigma,
      feeYield: feat.feeYield,
      bins,
    });
  }
  if (candidates.length < H12_MIN_DAY_SAMPLE) {
    return { candidates, passed: [], withdrew: 0, cutoff: null };
  }
  const sorted = candidates.map((row) => row.score).sort((a, b) => a - b);
  const cutoff = quantile(sorted, 1 - rule.topFraction);
  const selected = candidates.filter((row) => row.score >= cutoff);
  const withdrew = selected.filter((row) => row.bins === null).length;
  const passed = selected.filter((row): row is Candidate & { bins: number } => row.bins !== null);
  return { candidates, passed, withdrew, cutoff };
}

export function strategyForWidth(template: StrategyConfig, bins: number): StrategyConfig {
  return { ...template, binsBelow: bins, binsAbove: bins };
}

export function emptyH12Book(trial: H12TrialFile, nowMs: number, solPriceUsd: number): H12TrialBook {
  return {
    version: 1,
    mode: "paper",
    kind: "h12-trial",
    status: H12_TRIAL_STATUS,
    strategyId: trial.strategy.id,
    strategyVersion: trial.version,
    parameterHash: trial.parameterHash,
    rule: trial.rule,
    updatedAt: new Date(nowMs).toISOString(),
    sizeUsd: trial.rule.sizeUsd,
    solPriceUsd,
    slots: [],
  };
}

export function loadH12Book(path: string, trial: H12TrialFile, nowMs: number, solPriceUsd: number): H12TrialBook {
  if (!existsSync(path)) return emptyH12Book(trial, nowMs, solPriceUsd);
  const book = JSON.parse(readFileSync(path, "utf8")) as H12TrialBook;
  if (book.kind !== "h12-trial" || book.status !== H12_TRIAL_STATUS || !Array.isArray(book.slots)) {
    throw new Error(`${path} is not the H12 trial paper book`);
  }
  if (book.parameterHash !== trial.parameterHash) {
    throw new Error(`H12 trial book hash ${book.parameterHash} does not match ${trial.parameterHash}`);
  }
  return book;
}

export function saveH12Book(path: string, book: H12TrialBook): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(book));
}

export async function markH12Book(book: H12TrialBook, nowMs: number, fetchPool: (address: string) => Promise<DiscoveredPool | null>): Promise<H12TrialBook> {
  const open = book.slots.filter((slot) => slot.position.status === "open");
  const pools = new Map<string, DiscoveredPool>();
  for (const slot of open) {
    if (pools.has(slot.position.poolAddress)) continue;
    const pool = await fetchPool(slot.position.poolAddress);
    if (pool) pools.set(slot.position.poolAddress, pool);
  }
  for (const slot of book.slots) {
    if (slot.position.status !== "open") continue;
    const pool = pools.get(slot.position.poolAddress);
    if (!pool || pool.binStep === null) continue;
    const liquidityBins = assumedLiquidityBins(pool);
    const active = advancePosition({
      position: slot.position,
      pool,
      nowMs,
      feeModel: "active-bin",
      liquidityBins,
      solPriceUsd: book.solPriceUsd,
    });
    const crossed = advancePosition({
      position: slot.position,
      pool,
      nowMs,
      feeModel: "crossed-bins",
      liquidityBins,
      solPriceUsd: book.solPriceUsd,
    });
    slot.activeBinFeesUsd += feeDelta(slot.position, active.position);
    slot.crossedBinFeesUsd += feeDelta(slot.position, crossed.position);
    slot.position = crossed.position;
  }
  book.updatedAt = new Date(nowMs).toISOString();
  return book;
}

export async function syncH12TrialBook(options: {
  path: string;
  frozenPath: string;
  cacheDir: string;
  universe: DiscoveredPool[];
  nowMs: number;
  solPriceUsd: number;
  rug?: RugCheckOptions;
  onProgress?: (message: string) => void;
}): Promise<H12TrialStatus> {
  const log = options.onProgress ?? (() => {});
  const trial = loadH12Trial(options.frozenPath);
  const book = loadH12Book(options.path, trial, options.nowMs, options.solPriceUsd);
  book.solPriceUsd = options.solPriceUsd;
  if (book.slots.some((slot) => slot.position.status === "open")) {
    log(`Marking ${book.slots.filter((slot) => slot.position.status === "open").length} H12 trial positions`);
    await markH12Book(book, options.nowMs, fetchDlmmPool);
  }
  log("Scoring the H12 fee quintile on pre-entry daily bars");
  const series = await loadH12DailySeries(options.universe, options.cacheDir, options.nowMs, log);
  const ranked = rankH12Candidates(series, options.nowMs, trial.rule);
  const have = new Set(book.slots.map((slot) => slot.position.poolAddress));
  const fresh = ranked.passed
    .filter((row) => !have.has(row.pool.address))
    .sort((a, b) => b.score - a.score);
  let opening = fresh;
  let rugs: RugHit[] = [];
  if (options.rug && fresh.length > 0) {
    log(`Rug-checking ${fresh.length} H12 trial candidates`);
    const gated = await rugGatePools({
      pools: fresh.map((row) => row.pool),
      coinType: "h12-trial",
      options: options.rug,
      accept: H12_TRIAL_OPEN_CAP,
    });
    const allowed = new Set(gated.passed.map((pool) => pool.address));
    opening = fresh.filter((row) => allowed.has(row.pool.address));
    rugs = gated.hits;
  }
  const added: string[] = [];
  let deferred = 0;
  for (const row of opening) {
    if (row.bins === null) continue;
    if (added.length >= H12_TRIAL_OPEN_CAP) {
      deferred += 1;
      continue;
    }
    const strategy = strategyForWidth(trial.strategy, row.bins);
    book.slots.push({
      position: openPaperPosition({
        pool: row.pool,
        strategy,
        sizeUsd: trial.rule.sizeUsd,
        nowMs: options.nowMs,
      }),
      coinType: classifyPool(row.pool, options.nowMs).type,
      binsEachSide: row.bins,
      entryScore: row.score,
      entrySigma: row.sigma,
      entryFeeYield: row.feeYield,
      entryTvlUsd: row.pool.tvlUsd,
      crossedBinFeesUsd: 0,
      activeBinFeesUsd: 0,
    });
    added.push(row.pool.name);
  }
  book.updatedAt = new Date(options.nowMs).toISOString();
  book.sizeUsd = trial.rule.sizeUsd;
  saveH12Book(options.path, book);
  const poolMap = new Map(options.universe.map((pool) => [pool.address, pool]));
  log(`H12 trial: opened ${added.length}, deferred ${deferred}, withdrew ${ranked.withdrew}`);
  return statusOf(book, ranked, added, deferred, rugs, poolMap);
}

export function renderH12Trial(status: H12TrialStatus): string {
  const lines: string[] = [];
  lines.push("## H12 trial book");
  lines.push("");
  lines.push(`Status: ${status.status}. Strategy \`${status.strategyId}\` version ${status.strategyVersion}, rule hash \`${status.parameterHash}\`. This is a paper trial. It is not a promoted strategy. Deposit $${H12_TRIAL_RULE.sizeUsd}. SOL $${status.solPriceUsd.toFixed(2)}.`);
  lines.push("");
  lines.push(`Pre-entry scores: ${status.scored}. Top 20% selected ${status.passedQuintile}. Cartea withdrawals ${status.withdrew}. Qualifying opens available ${status.qualifying}. Opened ${status.added.length}${status.deferred ? `, ${status.deferred} deferred by the ${H12_TRIAL_OPEN_CAP} cap` : ""}. Book: ${status.positions} positions, ${status.open} open, ${status.closed} closed.`);
  lines.push("");
  lines.push(`The position's accrued fees use the crossed-bin model. The active-bin column is the same mark computed separately and is not added on top. Versus cash is net PnL after exit slippage, transaction fees, and non-refundable bin-array rent. Versus hold is that equity minus buying the volatile token at entry. Gross PnL $${status.grossPnlUsd.toFixed(2)}. Net $${status.netPnlUsd.toFixed(2)}. Versus cash $${status.vsCashUsd.toFixed(2)}. Versus hold $${status.vsHoldUsd.toFixed(2)}. Crossed-bin fees $${status.crossedBinFeesUsd.toFixed(2)}. Active-bin fees $${status.activeBinFeesUsd.toFixed(2)}.`);
  lines.push("");
  if (status.rows.length === 0) {
    lines.push("No H12 trial positions yet.");
    lines.push("");
    return lines.join("\n");
  }
  lines.push("| Pool | Bucket | Bins | Status | Crossed-bin fees | Active-bin fees | Slippage | Tx + rent | Net | Vs cash | Vs hold |");
  lines.push("| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of status.rows) {
    lines.push(`| ${row.name} | ${row.coinType} | ${row.binsEachSide} | ${row.status} | $${row.crossedBinFeesUsd.toFixed(2)} | $${row.activeBinFeesUsd.toFixed(2)} | $${row.exitSlippageUsd.toFixed(2)} | $${row.txAndRentUsd.toFixed(2)} | $${row.netPnlUsd.toFixed(2)} | $${row.vsCashUsd.toFixed(2)} | $${row.vsHoldUsd.toFixed(2)} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function loadH12DailySeries(
  universe: DiscoveredPool[],
  cacheDir: string,
  nowMs: number,
  log: (line: string) => void,
): Promise<Array<{ pool: DiscoveredPool; candles: Candle[]; candleHours: number }>> {
  const dir = join(cacheDir, "24h");
  mkdirSync(dir, { recursive: true });
  const end = Math.floor(nowMs / 1000);
  const out: Array<{ pool: DiscoveredPool; candles: Candle[]; candleHours: number }> = [];
  let fetched = 0;
  for (const pool of universe) {
    if (pool.binStep === null) continue;
    const path = join(dir, `${pool.address}.json`);
    let series: CandleSeries | null = null;
    if (existsSync(path)) series = JSON.parse(readFileSync(path, "utf8")) as CandleSeries;
    const last = series?.candles[series.candles.length - 1]?.timestamp ?? 0;
    if (!series || last < end - 3 * 86_400) {
      series = await fetchCandleWindow(pool, "24h", end - 90 * 86_400, end);
      writeFileSync(path, JSON.stringify(series));
      fetched += 1;
      if (fetched % 25 === 0) log(`Refreshed ${fetched} daily series`);
    }
    if (series.candles.length === 0) continue;
    out.push({ pool, candles: series.candles, candleHours: series.candleHours });
  }
  return out;
}

function feeDelta(before: PaperPosition, after: PaperPosition): number {
  return (after.feesUsd + after.claimedFeesUsd) - (before.feesUsd + before.claimedFeesUsd);
}

function statusOf(
  book: H12TrialBook,
  ranked: { candidates: Candidate[]; passed: Candidate[]; withdrew: number },
  added: string[],
  deferred: number,
  rugs: RugHit[],
  pools: Map<string, DiscoveredPool>,
): H12TrialStatus {
  const rows = book.slots.map((slot) => rowFor(slot, pools.get(slot.position.poolAddress) ?? null, book.solPriceUsd));
  return {
    status: H12_TRIAL_STATUS,
    strategyId: book.strategyId,
    strategyVersion: book.strategyVersion,
    parameterHash: book.parameterHash,
    solPriceUsd: book.solPriceUsd,
    scored: ranked.candidates.length,
    passedQuintile: ranked.passed.length + ranked.withdrew,
    withdrew: ranked.withdrew,
    qualifying: ranked.passed.length,
    positions: rows.length,
    open: rows.filter((row) => row.status === "open").length,
    closed: rows.filter((row) => row.status === "closed").length,
    added,
    deferred,
    grossPnlUsd: rows.reduce((sum, row) => sum + row.grossPnlUsd, 0),
    netPnlUsd: rows.reduce((sum, row) => sum + row.netPnlUsd, 0),
    vsCashUsd: rows.reduce((sum, row) => sum + row.vsCashUsd, 0),
    vsHoldUsd: rows.reduce((sum, row) => sum + row.vsHoldUsd, 0),
    crossedBinFeesUsd: rows.reduce((sum, row) => sum + row.crossedBinFeesUsd, 0),
    activeBinFeesUsd: rows.reduce((sum, row) => sum + row.activeBinFeesUsd, 0),
    rows,
    rugs,
  };
}

export function h12MarkRow(slot: H12Slot, pool: DiscoveredPool | null, solPriceUsd: number): H12TrialRow {
  return rowFor(slot, pool, solPriceUsd);
}

function rowFor(slot: H12Slot, pool: DiscoveredPool | null, solPriceUsd: number): H12TrialRow {
  const gross = displayPnlUsd(slot.position);
  const cost = slot.position.takeProfitAfterCosts && pool
    ? costAllNonSol(slot.position, pool, solPriceUsd)
    : costOf(slot.position, pool, solPriceUsd);
  const net = gross - cost.pnlCostUsd;
  const equity = slot.position.depositedUsd + net;
  const hold = pool
    ? tokenHoldUsd(pool, [
        { timestamp: 0, open: slot.position.entryPrice, high: slot.position.entryPrice, low: slot.position.entryPrice, close: slot.position.entryPrice, volumeUsd: 0, lpFeesUsd: 0 },
        { timestamp: 1, open: slot.position.lastPrice, high: slot.position.lastPrice, low: slot.position.lastPrice, close: slot.position.lastPrice, volumeUsd: 0, lpFeesUsd: 0 },
      ], slot.position.depositedUsd)
    : { usd: slot.position.depositedUsd, volatile: false };
  return {
    name: slot.position.poolName,
    address: slot.position.poolAddress,
    coinType: slot.coinType,
    status: slot.position.status,
    binsEachSide: slot.binsEachSide,
    grossPnlUsd: gross,
    crossedBinFeesUsd: slot.crossedBinFeesUsd,
    activeBinFeesUsd: slot.activeBinFeesUsd,
    exitSlippageUsd: cost.exitSlippageUsd,
    txAndRentUsd: cost.txFeeUsd + cost.sunkBinArrayUsd,
    netPnlUsd: net,
    vsCashUsd: net,
    vsHoldUsd: equity - hold.usd,
    closeReason: slot.position.closeReason ?? null,
  };
}

function costAllNonSol(position: PaperPosition, pool: DiscoveredPool, solPriceUsd: number): ExitCost {
  const amounts = inventoryAmounts(position);
  return liquidationCostAllNonSol({
    pool,
    minBinId: position.minBinId,
    maxBinId: position.maxBinId,
    activeBinId: position.activeBinId,
    binStep: position.binStep,
    rebalanceCount: position.rebalanceCount,
    liquidityBins: assumedLiquidityBins(pool),
    solPriceUsd,
    amountX: amounts.amountX + position.feesX,
    amountY: amounts.amountY + position.feesY,
    priceXUsd: position.priceXUsd,
    priceYUsd: position.priceYUsd,
  });
}

/**
 * Mark and open the four take-profit sub-books. Does not read or write the
 * original H12 trial book. Rug-checks the union of new opens once.
 */
export async function syncH12TpBooks(options: {
  cacheDir: string;
  universe: DiscoveredPool[];
  nowMs: number;
  solPriceUsd: number;
  rug?: RugCheckOptions;
  onProgress?: (message: string) => void;
  root?: string;
}): Promise<H12TrialStatus[]> {
  const log = options.onProgress ?? (() => {});
  const root = options.root ?? process.cwd();
  const loaded = H12_TP_LEVELS.map((level) => {
    const trial = loadH12TpTrial(h12TpTrialPath(level, root));
    const book = loadH12Book(h12TpBookPath(level, root), trial, options.nowMs, options.solPriceUsd);
    book.solPriceUsd = options.solPriceUsd;
    return { level, trial, book };
  });
  for (const row of loaded) {
    const open = row.book.slots.filter((slot) => slot.position.status === "open").length;
    if (open > 0) {
      log(`Marking ${open} H12 ${h12TpLabel(row.level)} positions`);
      await markH12Book(row.book, options.nowMs, fetchDlmmPool);
    }
  }
  log("Scoring the H12 fee quintile for the take-profit sub-books");
  const series = await loadH12DailySeries(options.universe, options.cacheDir, options.nowMs, log);
  const ranked = rankH12Candidates(series, options.nowMs, H12_TRIAL_RULE);
  const wanted = new Map<string, Candidate>();
  for (const row of loaded) {
    const have = new Set(row.book.slots.map((slot) => slot.position.poolAddress));
    for (const candidate of ranked.passed) {
      if (candidate.bins === null || have.has(candidate.pool.address)) continue;
      wanted.set(candidate.pool.address, candidate);
    }
  }
  const fresh = [...wanted.values()].sort((a, b) => b.score - a.score);
  let allowed = new Set(fresh.map((row) => row.pool.address));
  let rugs: RugHit[] = [];
  if (options.rug && fresh.length > 0) {
    log(`Rug-checking ${fresh.length} H12 take-profit candidates`);
    const gated = await rugGatePools({
      pools: fresh.map((row) => row.pool),
      coinType: "h12-trial",
      options: options.rug,
      accept: H12_TRIAL_OPEN_CAP,
    });
    allowed = new Set(gated.passed.map((pool) => pool.address));
    rugs = gated.hits;
  }
  const statuses: H12TrialStatus[] = [];
  for (const row of loaded) {
    const have = new Set(row.book.slots.map((slot) => slot.position.poolAddress));
    const opening = ranked.passed.filter((candidate) => candidate.bins !== null && !have.has(candidate.pool.address) && allowed.has(candidate.pool.address));
    const added: string[] = [];
    let deferred = 0;
    for (const candidate of opening) {
      if (candidate.bins === null) continue;
      if (added.length >= H12_TRIAL_OPEN_CAP) {
        deferred += 1;
        continue;
      }
      row.book.slots.push({
        position: openPaperPosition({
          pool: candidate.pool,
          strategy: strategyForWidth(row.trial.strategy, candidate.bins),
          sizeUsd: row.trial.rule.sizeUsd,
          nowMs: options.nowMs,
        }),
        coinType: classifyPool(candidate.pool, options.nowMs).type,
        binsEachSide: candidate.bins,
        entryScore: candidate.score,
        entrySigma: candidate.sigma,
        entryFeeYield: candidate.feeYield,
        entryTvlUsd: candidate.pool.tvlUsd,
        crossedBinFeesUsd: 0,
        activeBinFeesUsd: 0,
      });
      added.push(candidate.pool.name);
    }
    row.book.updatedAt = new Date(options.nowMs).toISOString();
    row.book.sizeUsd = row.trial.rule.sizeUsd;
    saveH12Book(h12TpBookPath(row.level, root), row.book);
    const poolMap = new Map(options.universe.map((pool) => [pool.address, pool]));
    log(`H12 ${h12TpLabel(row.level)}: opened ${added.length}, deferred ${deferred}`);
    statuses.push(statusOf(row.book, ranked, added, deferred, rugs, poolMap));
  }
  return statuses;
}

export function renderH12TpTrials(statuses: H12TrialStatus[]): string {
  const lines: string[] = [];
  lines.push("## H12 take-profit sub-books");
  lines.push("");
  lines.push("Separate paper books. Same entry rule as the H12 trial. Take-profit is 10%, 15%, 25%, or 40% of the deposit after exit costs. On that exit the non-SOL inventory and unclaimed fees are swapped to SOL. These are not promoted. The original trial hash is unchanged. A negative net with no accrued fees is the cost of closing immediately.");
  lines.push("");
  const rugs = statuses[0]?.rugs ?? [];
  if (rugs.length > 0) {
    const passed = rugs.filter((hit) => hit.ok).length;
    lines.push(`Rug check, shared by all four books: checked ${rugs.length}. Passed ${passed}. Rejected ${rugs.length - passed}.`);
    lines.push("");
  }
  if (statuses.length === 0) {
    lines.push("No take-profit sub-books were synced.");
    lines.push("");
    return lines.join("\n");
  }
  lines.push("| Book | Hash | Opened | Positions | Open | Closed | Net | Vs cash | Vs hold |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const status of statuses) {
    lines.push(`| \`${status.strategyId}\` | \`${status.parameterHash.slice(0, 12)}\` | ${status.added.length} | ${status.positions} | ${status.open} | ${status.closed} | $${status.netPnlUsd.toFixed(2)} | $${status.vsCashUsd.toFixed(2)} | $${status.vsHoldUsd.toFixed(2)} |`);
  }
  lines.push("");
  for (const status of statuses) {
    lines.push(`### ${status.strategyId}`);
    lines.push("");
    lines.push(`Rule hash \`${status.parameterHash}\`. Scored ${status.scored}. Top 20% ${status.passedQuintile}. Withdrawals ${status.withdrew}. Opened ${status.added.length}${status.deferred ? `, ${status.deferred} deferred by the ${H12_TRIAL_OPEN_CAP} cap` : ""}. Crossed-bin fees $${status.crossedBinFeesUsd.toFixed(2)}. Active-bin fees $${status.activeBinFeesUsd.toFixed(2)} are not added on top.`);
    lines.push("");
    if (status.rows.length === 0) {
      lines.push("No positions yet.");
      lines.push("");
      continue;
    }
    lines.push("| Pool | Bucket | Bins | Status | Net | Vs cash | Vs hold | Exit |");
    lines.push("| --- | --- | ---: | --- | ---: | ---: | ---: | --- |");
    for (const row of status.rows) {
      lines.push(`| ${row.name} | ${row.coinType} | ${row.binsEachSide} | ${row.status} | $${row.netPnlUsd.toFixed(2)} | $${row.vsCashUsd.toFixed(2)} | $${row.vsHoldUsd.toFixed(2)} | ${row.closeReason ?? "—"} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

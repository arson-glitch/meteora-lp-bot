import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { advancePosition, closePaperPosition, openPaperPosition } from "../executor/paper.js";
import { inventoryAmounts, markValueUsd } from "../executor/pnl.js";
import { assumedLiquidityBins } from "../math/activeBin.js";
import { isSolToken, liquidationCostAllNonSol } from "../math/costs.js";
import { isQuoteToken } from "../markets.js";
import { fetchDlmmPools } from "../scanner/meteora.js";
import type { StrategyConfig } from "../strategy/schema.js";
import type { DiscoveredPool, PaperPosition, Sidedness } from "../types.js";
import { sampleKey } from "./classify.js";
import {
  estimateCandleLpFees,
  fetchCandleWindow,
  fetchGecko5m,
  type Candle,
  type CandleSeries,
} from "./candles.js";
import { splitCoinKeys } from "./holdout.js";
import { sleep } from "../http.js";
import { solPriceUsd } from "./frozenBook.js";
import { distribution, quantile } from "./stats.js";

/**
 * H30 pump-flip event study. Paper and backtest only.
 *
 * A 5-minute bar whose volume / TVL is in the top decile of earlier bars
 * is a signal. The position opens on the next bar. It closes on the first
 * of an upside range exit, a downside range exit, or 60 minutes, and the
 * exit sells every non-SOL balance to SOL.
 */

export const H30_SIZE_USD = 250;
export const H30_LOOKBACK_BARS = 144;
export const H30_MIN_LOOKBACK = 36;
export const H30_MAX_HOLD_BARS = 12;
export const H30_DECILE = 0.9;
export const H30_TRAIN_FRACTION = 0.7;
export const H30_MIN_TVL_USD = 5_000;
/**
 * Meteora returns HTTP 400 for a 5-minute window past about 8 hours.
 * 7.5 hours stays under that rejection.
 */
export const H30_METEORA_5M_SECONDS = Math.floor(7.5 * 3600);

export type FeeClass = "1pct" | "ge2";
export type SideName = "two-sided" | "one-sided-sol";
export type SpanName = 20 | 69;
export type FeeModelName = "crossed-bins" | "active-bin";
export type ExitKind = "upside" | "downside" | "timeout";
export type SplitName = "train" | "test" | "holdout";

export interface H30Cell {
  id: string;
  side: SideName;
  span: SpanName;
  feeClass: FeeClass;
}

export interface PumpEvent {
  poolAddress: string;
  poolName: string;
  coinKey: string;
  feeClass: FeeClass;
  side: SideName;
  span: SpanName;
  feeModel: FeeModelName;
  split: SplitName;
  exitKind: ExitKind;
  barsHeld: number;
  netPnlUsd: number;
  returnPct: number;
  vsHoldUsd: number;
  holdDefined: boolean;
  maxDrawdownPct: number;
  feesUsd: number;
  costUsd: number;
  costPct: number;
  binArrayRentUsd: number;
  beatCash: boolean;
  beatHold: boolean;
}

export function feeClassOf(baseFeePct: number | null): FeeClass | null {
  if (baseFeePct === null || !Number.isFinite(baseFeePct)) return null;
  if (baseFeePct >= 0.95 && baseFeePct < 1.25) return "1pct";
  if (baseFeePct >= 2) return "ge2";
  return null;
}

export function volumeTvl(volumeUsd: number, tvlUsd: number): number {
  if (!(tvlUsd > 0) || !(volumeUsd >= 0)) return 0;
  return volumeUsd / tvlUsd;
}

/**
 * Signal bar indexes. The cutoff is the 90th percentile of ratios in the
 * prior window only. The candidate bar and every later bar are excluded.
 */
export function signalIndexes(ratios: number[]): number[] {
  const out: number[] = [];
  for (let index = 0; index < ratios.length; index += 1) {
    const from = Math.max(0, index - H30_LOOKBACK_BARS);
    const prior = ratios.slice(from, index).filter((value) => Number.isFinite(value));
    if (prior.length < H30_MIN_LOOKBACK) continue;
    const cut = quantile([...prior].sort((a, b) => a - b), H30_DECILE);
    const ratio = ratios[index] ?? 0;
    if (ratio > cut) out.push(index);
  }
  return out;
}

export function splitFor(entryIndex: number, barCount: number, holdout: boolean): SplitName {
  if (holdout) return "holdout";
  const cut = Math.max(1, Math.floor(barCount * H30_TRAIN_FRACTION));
  return entryIndex < cut ? "train" : "test";
}

export function solSideLayout(
  pool: DiscoveredPool,
  span: SpanName,
): { sidedness: Sidedness; binsBelow: number; binsAbove: number } | null {
  const xSol = isSolToken(pool.tokenX);
  const ySol = isSolToken(pool.tokenY);
  const extra = span - 1;
  if (ySol && !xSol) return { sidedness: "single-sided-y", binsBelow: extra, binsAbove: 0 };
  if (xSol && !ySol) return { sidedness: "single-sided-x", binsBelow: 0, binsAbove: extra };
  return null;
}

export function twoSidedLayout(span: SpanName): { sidedness: Sidedness; binsBelow: number; binsAbove: number } {
  if (span === 20) return { sidedness: "two-sided", binsBelow: 10, binsAbove: 9 };
  return { sidedness: "two-sided", binsBelow: 34, binsAbove: 34 };
}

export function cells(): H30Cell[] {
  const out: H30Cell[] = [];
  for (const feeClass of ["1pct", "ge2"] as const) {
    for (const side of ["two-sided", "one-sided-sol"] as const) {
      for (const span of [20, 69] as const) {
        out.push({
          id: `h30-${side}-${span}-${feeClass}`,
          side,
          span,
          feeClass,
        });
      }
    }
  }
  return out;
}

interface ReadySeries {
  pool: DiscoveredPool;
  series: CandleSeries;
  tvlUsd: number;
  tvlSource: "scan-snapshot";
  meteoraBars: number;
  geckoBars: number;
  historyFeeBars: number;
}

export async function runH30(options: {
  reportsDir: string;
  cacheDir: string;
  onProgress?: (message: string) => void;
}): Promise<string> {
  const log = options.onProgress ?? (() => undefined);
  const nowMs = Date.now();
  mkdirSync(options.cacheDir, { recursive: true });
  mkdirSync(options.reportsDir, { recursive: true });
  log("Listing DLMM pools with bin step 100 to 125");
  const listed = await listWideStepPools();
  const universe = listed.filter((pool) => feeClassOf(pool.baseFeePct) !== null && pool.tvlUsd >= H30_MIN_TVL_USD && pool.binStep !== null);
  log(`Fee-class pools ${universe.length} of ${listed.length} listed`);
  const ready: ReadySeries[] = [];
  for (const pool of universe) {
    const series = await loadSeries(pool, options.cacheDir, nowMs, log);
    if (series.series.candles.length < H30_MIN_LOOKBACK + 2) continue;
    ready.push(series);
  }
  const price = await solPriceUsd(ready.map((row) => row.pool));
  const events = scoreUniverse(ready, price);
  const text = renderH30({ ready, listed: listed.length, universe: universe.length, events, solPriceUsd: price, nowMs });
  const path = join(options.reportsDir, `h30-pump-flip-${new Date(nowMs).toISOString().slice(0, 10)}.md`);
  writeFileSync(path, text);
  return path;
}

export function scoreUniverse(rows: ReadySeries[], solPriceUsd: number): PumpEvent[] {
  const keys = splitCoinKeys(rows.map((row) => sampleKey(row.pool)));
  const holdout = new Set(keys.holdoutKeys);
  const events: PumpEvent[] = [];
  for (const row of rows) {
    const feeClass = feeClassOf(row.pool.baseFeePct);
    if (!feeClass) continue;
    const ratios = row.series.candles.map((candle) => volumeTvl(candle.volumeUsd, row.tvlUsd));
    const signals = new Set(signalIndexes(ratios));
    const isHoldout = holdout.has(sampleKey(row.pool));
    for (const cell of cells()) {
      if (cell.feeClass !== feeClass) continue;
      const layout = cell.side === "two-sided" ? twoSidedLayout(cell.span) : solSideLayout(row.pool, cell.span);
      if (!layout) continue;
      for (const feeModel of ["crossed-bins", "active-bin"] as const) {
        events.push(...replayCell({
          row,
          cell,
          layout,
          signals,
          feeModel,
          solPriceUsd,
          holdout: isHoldout,
        }));
      }
    }
  }
  return events;
}

function replayCell(params: {
  row: ReadySeries;
  cell: H30Cell;
  layout: { sidedness: Sidedness; binsBelow: number; binsAbove: number };
  signals: Set<number>;
  feeModel: FeeModelName;
  solPriceUsd: number;
  holdout: boolean;
}): PumpEvent[] {
  const candles = params.row.series.candles;
  const out: PumpEvent[] = [];
  let cursor = 0;
  while (cursor < candles.length - 1) {
    if (!params.signals.has(cursor)) {
      cursor += 1;
      continue;
    }
    const entry = cursor + 1;
    const slice = candles.slice(entry, entry + H30_MAX_HOLD_BARS);
    const played = playSlice({
      pool: params.row.pool,
      candles: slice,
      candleHours: params.row.series.candleHours,
      layout: params.layout,
      feeModel: params.feeModel,
      solPriceUsd: params.solPriceUsd,
      strategyId: params.cell.id,
    });
    if (played) {
      out.push({
        poolAddress: params.row.pool.address,
        poolName: params.row.pool.name,
        coinKey: sampleKey(params.row.pool),
        feeClass: params.cell.feeClass,
        side: params.cell.side,
        span: params.cell.span,
        feeModel: params.feeModel,
        split: splitFor(entry, candles.length, params.holdout),
        exitKind: played.exitKind,
        barsHeld: played.barsHeld,
        netPnlUsd: played.netPnlUsd,
        returnPct: played.returnPct,
        vsHoldUsd: played.vsHoldUsd,
        holdDefined: played.holdDefined,
        maxDrawdownPct: played.maxDrawdownPct,
        feesUsd: played.feesUsd,
        costUsd: played.costUsd,
        costPct: played.costPct,
        binArrayRentUsd: played.binArrayRentUsd,
        beatCash: played.netPnlUsd > 0,
        beatHold: played.vsHoldUsd > 0,
      });
      cursor = entry + played.barsHeld;
      continue;
    }
    cursor += 1;
  }
  return out;
}

interface PlayedSlice {
  exitKind: ExitKind;
  barsHeld: number;
  netPnlUsd: number;
  returnPct: number;
  vsHoldUsd: number;
  holdDefined: boolean;
  maxDrawdownPct: number;
  feesUsd: number;
  costUsd: number;
  costPct: number;
  binArrayRentUsd: number;
}

export function playSlice(params: {
  pool: DiscoveredPool;
  candles: Candle[];
  candleHours: number;
  layout: { sidedness: Sidedness; binsBelow: number; binsAbove: number };
  feeModel: FeeModelName;
  solPriceUsd: number;
  strategyId: string;
}): PlayedSlice | null {
  const first = params.candles[0];
  if (!first || !(first.open > 0) || params.pool.binStep === null || !(params.pool.tvlUsd > 0)) return null;
  const strategy = strategyFor(params.strategyId, params.layout);
  const frozenY = params.pool.tokenY.priceUsd > 0 ? params.pool.tokenY.priceUsd : 1;
  let clock = first.timestamp * 1000;
  let position = openPaperPosition({
    pool: poolAt(params.pool, first.open, frozenY, first, params.candleHours),
    strategy,
    sizeUsd: H30_SIZE_USD,
    nowMs: clock,
  });
  const entryPrice = position.entryPrice;
  let peak = H30_SIZE_USD;
  let maxDrawdown = 0;
  let exitKind: ExitKind | null = null;
  let barsHeld = 0;
  const liquidityBins = assumedLiquidityBins(params.pool);

  for (let index = 0; index < params.candles.length; index += 1) {
    const candle = params.candles[index] as Candle;
    const path = ohlcPath(candle);
    const points = index === 0 ? path.slice(1) : path;
    const legHours = points.length > 0 ? params.candleHours / points.length : params.candleHours;
    for (const price of points) {
      if (!(price > 0) || position.status !== "open") continue;
      clock += legHours * 3_600_000;
      const stepped = advancePosition({
        position,
        pool: poolAt(params.pool, price, frozenY, candle, params.candleHours),
        nowMs: clock,
        elapsedHours: legHours,
        feeModel: params.feeModel,
        liquidityBins,
        solPriceUsd: params.solPriceUsd,
      });
      position = stepped.position;
      const marked = markValueUsd(position) + position.feesUsd + position.claimedFeesUsd;
      peak = Math.max(peak, marked);
      if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - marked) / peak);
      const heldHours = (clock - Date.parse(position.openedAt)) / 3_600_000;
      if (position.activeBinId > position.maxBinId) exitKind = "upside";
      else if (position.activeBinId < position.minBinId) exitKind = "downside";
      else if (heldHours >= 1) exitKind = "timeout";
      if (exitKind) {
        position = closePaperPosition(position, clock, exitKind);
        break;
      }
    }
    barsHeld += 1;
    if (exitKind) break;
  }
  if (!exitKind) {
    exitKind = "timeout";
    position = closePaperPosition(position, clock, exitKind);
  }
  return settle(position, params.pool, params.solPriceUsd, liquidityBins, entryPrice, exitKind, barsHeld, peak, maxDrawdown);
}

function settle(
  position: PaperPosition,
  pool: DiscoveredPool,
  solPriceUsd: number,
  liquidityBins: number,
  entryPrice: number,
  exitKind: ExitKind,
  barsHeld: number,
  peak: number,
  maxDrawdown: number,
): PlayedSlice {
  const amounts = inventoryAmounts(position);
  const gross = position.depositedUsd + position.realizedPnlUsd;
  const cost = liquidationCostAllNonSol({
    pool,
    minBinId: position.minBinId,
    maxBinId: position.maxBinId,
    activeBinId: position.activeBinId,
    binStep: position.binStep,
    rebalanceCount: position.rebalanceCount,
    liquidityBins,
    solPriceUsd,
    amountX: amounts.amountX + position.feesX,
    amountY: amounts.amountY + position.feesY,
    priceXUsd: position.priceXUsd,
    priceYUsd: position.priceYUsd,
  });
  const equity = gross - cost.pnlCostUsd;
  const costDrawdown = peak > 0 ? Math.max(0, (peak - equity) / peak) : 0;
  const net = equity - position.depositedUsd;
  const hold = tokenHold(pool, entryPrice, position.lastPrice, position.depositedUsd);
  return {
    exitKind,
    barsHeld,
    netPnlUsd: net,
    returnPct: position.depositedUsd > 0 ? net / position.depositedUsd : 0,
    vsHoldUsd: equity - hold.usd,
    holdDefined: hold.defined,
    maxDrawdownPct: Math.max(maxDrawdown, costDrawdown),
    feesUsd: position.feesUsd + position.claimedFeesUsd,
    costUsd: cost.pnlCostUsd,
    costPct: position.depositedUsd > 0 ? cost.pnlCostUsd / position.depositedUsd : 0,
    binArrayRentUsd: cost.sunkBinArrayUsd,
  };
}

function tokenHold(
  pool: DiscoveredPool,
  entryPrice: number,
  exitPrice: number,
  deposit: number,
): { usd: number; defined: boolean } {
  const xQuote = isQuoteToken(pool.tokenX);
  const yQuote = isQuoteToken(pool.tokenY);
  if (!xQuote && yQuote && entryPrice > 0 && exitPrice > 0) {
    return { usd: deposit * (exitPrice / entryPrice), defined: true };
  }
  return { usd: deposit, defined: false };
}

function strategyFor(
  id: string,
  layout: { sidedness: Sidedness; binsBelow: number; binsAbove: number },
): StrategyConfig {
  return {
    id,
    name: id,
    description: "H30 paper event study",
    placeholder: true,
    placeholderNote: "Built in memory for the pump-flip study. Not a winner file.",
    docs: ["https://docs.meteora.ag/core-products/dlmm/what-is-dlmm"],
    notes: "Spot range. Exit is applied by the study.",
    product: "dlmm",
    shape: "Spot",
    binsBelow: layout.binsBelow,
    binsAbove: layout.binsAbove,
    sidedness: layout.sidedness,
    quoteSide: null,
    priority: 0,
    manualOnly: true,
    stayInBinArray: false,
    requires: {},
    when: [],
    exit: {
      onOutOfRange: "close",
      rebalanceEdgeBins: 0,
      stopLossPct: 10,
      takeProfitPct: null,
      maxHoldHours: null,
      outOfRangeTimeoutHours: 1_000,
    },
  };
}

function ohlcPath(candle: Candle): number[] {
  const nearerHigh = Math.abs(candle.high - candle.open) <= Math.abs(candle.low - candle.open);
  const first = nearerHigh ? candle.high : candle.low;
  const second = nearerHigh ? candle.low : candle.high;
  return [candle.open, first, second, candle.close];
}

function poolAt(pool: DiscoveredPool, price: number, frozenY: number, candle: Candle, candleHours: number): DiscoveredPool {
  const perHour = candleHours > 0 ? candle.lpFeesUsd / candleHours : 0;
  return {
    ...pool,
    currentPrice: price,
    tokenX: { ...pool.tokenX, priceUsd: price * frozenY },
    tokenY: { ...pool.tokenY, priceUsd: frozenY },
    fees: { ...pool.fees, "1h": perHour },
  };
}

async function listWideStepPools(): Promise<DiscoveredPool[]> {
  const rows: DiscoveredPool[] = [];
  const filterBy = "is_blacklisted=false && tvl>=5000 && bin_step>=100 && bin_step<=125";
  for (let page = 1; page <= 12; page += 1) {
    const batch = await fetchDlmmPools({
      page,
      pageSize: 100,
      sortBy: "volume_24h:desc",
      filterBy,
      listSource: "volume",
    });
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < 100) break;
    await sleep(80);
  }
  const byAddress = new Map<string, DiscoveredPool>();
  for (const pool of rows) {
    if (pool.binStep === null || pool.binStep < 100 || pool.binStep > 125) continue;
    byAddress.set(pool.address, pool);
  }
  return [...byAddress.values()];
}

async function loadSeries(
  pool: DiscoveredPool,
  cacheDir: string,
  nowMs: number,
  log: (message: string) => void,
): Promise<ReadySeries> {
  const path = join(cacheDir, `${pool.address}.json`);
  if (existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, "utf8")) as ReadySeries;
    cached.pool = pool;
    return cached;
  }
  const end = Math.floor(nowMs / 1000);
  const meteora = await fetchCandleWindow(pool, "5m", end - H30_METEORA_5M_SECONDS, end).catch(() => emptySeries(pool));
  await sleep(60);
  let gecko = emptySeries(pool);
  gecko.source = "geckoterminal";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    gecko = await fetchGecko5m(pool);
    if (gecko.candles.length > 0) break;
    await sleep(1_500 * (attempt + 1));
  }
  await sleep(120);
  const merged = mergeSeries(pool, meteora, gecko);
  const ready: ReadySeries = {
    pool,
    series: merged.series,
    tvlUsd: pool.tvlUsd,
    tvlSource: "scan-snapshot",
    meteoraBars: meteora.candles.length,
    geckoBars: gecko.candles.length,
    historyFeeBars: merged.historyFeeBars,
  };
  writeFileSync(path, JSON.stringify(ready));
  log(`Bars ${pool.name}: meteora ${meteora.candles.length}, gecko ${gecko.candles.length}, history fees ${merged.historyFeeBars}`);
  return ready;
}

function emptySeries(pool: DiscoveredPool): CandleSeries {
  return {
    poolAddress: pool.address,
    timeframe: "5m",
    candleHours: 5 / 60,
    source: "meteora",
    feeSource: "fee-rate",
    candles: [],
  };
}

export function mergeSeries(
  pool: DiscoveredPool,
  meteora: CandleSeries,
  gecko: CandleSeries,
): { series: CandleSeries; historyFeeBars: number } {
  const byTs = new Map<number, Candle>();
  for (const candle of gecko.candles) {
    const timestamp = Math.floor(candle.timestamp / 300) * 300;
    byTs.set(timestamp, {
      ...candle,
      timestamp,
      lpFeesUsd: estimateCandleLpFees(pool, candle.volumeUsd),
    });
  }
  let historyFeeBars = 0;
  const historyBacked = meteora.feeSource === "volume-history" || meteora.feeSource === "mixed";
  for (const candle of meteora.candles) {
    const timestamp = Math.floor(candle.timestamp / 300) * 300;
    if (historyBacked) historyFeeBars += 1;
    byTs.set(timestamp, {
      timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volumeUsd: candle.volumeUsd,
      lpFeesUsd: historyBacked ? candle.lpFeesUsd : (candle.lpFeesUsd > 0 ? candle.lpFeesUsd : estimateCandleLpFees(pool, candle.volumeUsd)),
    });
  }
  const candles = [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp);
  const meteoraTs = new Set(meteora.candles.map((candle) => Math.floor(candle.timestamp / 300) * 300));
  const geckoOnly = candles.some((candle) => !meteoraTs.has(candle.timestamp));
  const meteoraOnly = meteora.candles.length > 0 && gecko.candles.length === 0;
  const feeSource = historyFeeBars === 0
    ? "fee-rate"
    : historyFeeBars === candles.length
      ? "volume-history"
      : "mixed";
  return {
    historyFeeBars,
    series: {
      poolAddress: pool.address,
      timeframe: "5m",
      candleHours: 5 / 60,
      source: meteoraOnly ? "meteora" : geckoOnly && meteora.candles.length > 0 ? "mixed" : gecko.candles.length > 0 && meteora.candles.length === 0 ? "geckoterminal" : meteora.candles.length > 0 ? "mixed" : "geckoterminal",
      feeSource,
      candles,
    },
  };
}

interface Summary {
  n: number;
  coins: number;
  mean: number | null;
  median: number | null;
  p5: number | null;
  meanPct: number | null;
  medianPct: number | null;
  p5Pct: number | null;
  winCash: number;
  winHold: number;
  holdDefined: number;
  meanVsHold: number | null;
  medianVsHold: number | null;
  maxDd: number | null;
  meanDd: number | null;
  top1: number | null;
  top3: number | null;
  meanCostPct: number | null;
  rentEvents: number;
}

export function summarizeEvents(events: PumpEvent[]): Summary {
  const nets = events.map((event) => event.netPnlUsd);
  const pcts = events.map((event) => event.returnPct);
  const holds = events.map((event) => event.vsHoldUsd);
  const dds = events.map((event) => event.maxDrawdownPct);
  const net = distribution(nets);
  const pct = distribution(pcts);
  const hold = distribution(holds);
  const dd = distribution(dds);
  const positive = new Map<string, number>();
  for (const event of events) {
    if (event.netPnlUsd <= 0) continue;
    positive.set(event.coinKey, (positive.get(event.coinKey) ?? 0) + event.netPnlUsd);
  }
  const ranked = [...positive.values()].sort((a, b) => b - a);
  const posSum = ranked.reduce((sum, value) => sum + value, 0);
  const top = (count: number) => posSum > 0 ? ranked.slice(0, count).reduce((sum, value) => sum + value, 0) / posSum : null;
  return {
    n: events.length,
    coins: new Set(events.map((event) => event.coinKey)).size,
    mean: net.mean,
    median: net.median,
    p5: net.p5,
    meanPct: pct.mean,
    medianPct: pct.median,
    p5Pct: pct.p5,
    winCash: events.filter((event) => event.beatCash).length,
    winHold: events.filter((event) => event.beatHold).length,
    holdDefined: events.filter((event) => event.holdDefined).length,
    meanVsHold: hold.mean,
    medianVsHold: hold.median,
    maxDd: dd.max,
    meanDd: dd.mean,
    top1: top(1),
    top3: top(3),
    meanCostPct: events.length === 0 ? null : events.reduce((sum, event) => sum + event.costPct, 0) / events.length,
    rentEvents: events.filter((event) => event.binArrayRentUsd > 0).length,
  };
}

export function oosEvents(events: PumpEvent[]): PumpEvent[] {
  return events.filter((event) => event.split === "test" || event.split === "holdout");
}

/**
 * A cell passes only when the time-split and the coin holdout each beat cash
 * and holding after costs, and no coin is more than half of positive OOS profit.
 */
export function cellPasses(events: PumpEvent[]): { pass: boolean; reason: string } {
  const test = summarizeEvents(events.filter((event) => event.split === "test"));
  const hold = summarizeEvents(events.filter((event) => event.split === "holdout"));
  const oos = summarizeEvents(oosEvents(events));
  if (test.n < 8 || hold.n < 4 || hold.coins < 4) {
    return { pass: false, reason: `too few OOS events (test ${test.n}, holdout ${hold.n} events / ${hold.coins} coins)` };
  }
  const beats = (row: Summary) =>
    row.mean !== null && row.mean > 0 &&
    row.median !== null && row.median > 0 &&
    row.meanVsHold !== null && row.meanVsHold > 0;
  if (!beats(test)) return { pass: false, reason: "time-split does not beat cash and holding" };
  if (!beats(hold)) return { pass: false, reason: "holdout does not beat cash and holding" };
  if (oos.top1 === null || oos.top1 > 0.5) {
    return { pass: false, reason: `one coin is ${oos.top1 === null ? "n/a" : pct(oos.top1)} of positive OOS profit` };
  }
  return { pass: true, reason: "OOS beats cash and holding and no coin is above half of positive profit" };
}

function renderH30(input: {
  ready: ReadySeries[];
  listed: number;
  universe: number;
  events: PumpEvent[];
  solPriceUsd: number;
  nowMs: number;
}): string {
  const day = new Date(input.nowMs).toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# H30 pump flip ${day}`);
  lines.push("");
  lines.push(`Generated ${new Date(input.nowMs).toISOString()}. Paper and backtest only. Deposit $${H30_SIZE_USD}. SOL $${input.solPriceUsd.toFixed(2)}. No signed transaction and no forward-book writes.`);
  lines.push("");
  lines.push("## Verified");
  lines.push("");
  lines.push("These points were read from the public responses or from the existing cost code, not filled in.");
  lines.push("");
  lines.push(`- Meteora \`/pools/{address}/ohlcv?timeframe=5m\` and \`/volume/history?timeframe=5m\` accept an 8-hour window and return HTTP 400 past that. This run requests ${H30_METEORA_5M_SECONDS / 3600} hours.`);
  lines.push("- Where a Meteora volume-history row matches a 5-minute timestamp, that row's \`fees\` field is the LP fee used for the bar.");
  lines.push("- GeckoTerminal \`/ohlcv/minute?aggregate=5&limit=1000\` is the longer price and volume tape. It has no LP-fee field.");
  lines.push("- Bin step and base fee come from the pool list. The 1% class is base fee from 0.95% up to but not including 1.25%. The other class is base fee at or above 2%. Other fee tiers are left out.");
  lines.push("- Exit slippage walks the pool's bins. A non-SOL quote is then sold to SOL at 4 bps against a $10M reserve. Transaction fees use the open and close signature budget. Bin-array rent is charged only for an array other than the active bin's array. Position-account rent is refundable and is not in PnL.");
  lines.push("- The decile cutoff for a signal uses only bars before that bar, at most the prior 144 bars (12 hours), and at least 36 bars. The bar is a signal only when its volume/TVL is strictly above that 90th percentile, so a flat tape does not signal. The position opens on the next bar's open. A new signal on the same pool waits until the previous position has closed.");
  lines.push("");
  lines.push("## Inferred");
  lines.push("");
  lines.push("- Neither endpoint publishes 5-minute TVL. Every ratio uses the pool's TVL from the scan that started this run. A pool whose TVL was lower during an older bar looks less extreme, and a pool whose TVL has since fallen looks more extreme.");
  lines.push("- Bars without a volume-history fee use base fee plus the current variable fee, times volume, times the pool's observed 24-hour LP share. The variable fee is today's snapshot.");
  lines.push("- The path inside a bar is open, the nearer wick, the other wick, then the close. That is the same wick assumption as the other backtests. It is not a swap tape.");
  lines.push("- Pool TVL is spread evenly across the assumed bin count when the fee models and the exit walk need a depth. There is no historical bin-array snapshot.");
  lines.push("- Holding means buying the volatile token when token X is volatile and token Y is a quote, from the entry price to the exit price. A quote-quote pair has no separate token hold, so versus holding equals versus cash on those events.");
  lines.push("- Train is the first 70% of each train coin's bars. The time split is the last 30% of those coins. Holdout coins are the sorted 30% sample-key split and never enter the threshold of another coin. The threshold is per pool.");
  lines.push("");
  const meteoraPools = input.ready.filter((row) => row.meteoraBars > 0).length;
  const geckoPools = input.ready.filter((row) => row.geckoBars > 0).length;
  const historyPools = input.ready.filter((row) => row.historyFeeBars > 0).length;
  const solPools = input.ready.filter((row) => solSideLayout(row.pool, 20) !== null).length;
  const feeCounts = new Map<string, number>();
  for (const row of input.ready) {
    const fee = feeClassOf(row.pool.baseFeePct) ?? "other";
    feeCounts.set(fee, (feeCounts.get(fee) ?? 0) + 1);
  }
  lines.push("## Sample");
  lines.push("");
  lines.push(`Listed pools with bin step 100 to 125 and TVL at or above $${H30_MIN_TVL_USD.toLocaleString("en-US")}: ${input.listed}. In a fee class and with enough bars: ${input.ready.length} of ${input.universe} fee-class pools. 1% class ${feeCounts.get("1pct") ?? 0}. At or above 2% ${feeCounts.get("ge2") ?? 0}. Pools with a SOL leg ${solPools}. Meteora 5-minute bars ${meteoraPools}. GeckoTerminal bars ${geckoPools}. Pools with at least one volume-history fee ${historyPools}.`);
  lines.push("");
  lines.push("One-sided SOL is skipped when neither leg is SOL. SOL as token Y sits on the bins at and below the active bin. SOL as token X sits on the bins at and above the active bin. Two-sided 20 bins is 10 below and 9 above. Two-sided 69 bins is 34 below and 34 above, so the range can cross into a second bin array and pay that rent.");
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push("Each figure is a $250 paper deposit. Net is after exit-swap slippage, transaction fees, and non-refundable bin-array rent. Versus cash is that net. Versus holding is equity after costs minus the token hold. Drawdown is the distribution of each event's own max drawdown. Top-coin shares use positive net only.");
  lines.push("");
  lines.push("| Cell | Model | Split | Events | Coins | Mean net | Median | p5 | Mean % | Win cash | Win hold | Mean vs hold | Mean DD | Max DD | Top 1 | Top 3 | Mean cost |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  const passes: string[] = [];
  for (const cell of cells()) {
    for (const feeModel of ["crossed-bins", "active-bin"] as const) {
      const mine = input.events.filter((event) => event.side === cell.side && event.span === cell.span && event.feeClass === cell.feeClass && event.feeModel === feeModel);
      for (const split of ["train", "test", "holdout", "oos"] as const) {
        const slice = split === "oos" ? oosEvents(mine) : mine.filter((event) => event.split === split);
        lines.push(resultRow(`${label(cell)}`, feeModel, split, summarizeEvents(slice)));
      }
      const gate = cellPasses(mine);
      passes.push(`- ${label(cell)} / ${feeModel}: ${gate.pass ? "pass" : "no pass"}. ${gate.reason}.`);
    }
  }
  lines.push("");
  lines.push("## Validation");
  lines.push("");
  lines.push("A cell passes only when the time-split has at least 8 events, the holdout has at least 4 events and 4 coins, both windows have positive mean and median net and a positive mean versus holding, and the largest coin is at most half of positive out-of-sample profit. Out of sample is the time split plus the holdout. Train is not part of the pass.");
  lines.push("");
  lines.push(...passes);
  lines.push("");
  const both = cells().filter((cell) => {
    const crossed = cellPasses(input.events.filter((event) => event.side === cell.side && event.span === cell.span && event.feeClass === cell.feeClass && event.feeModel === "crossed-bins"));
    const active = cellPasses(input.events.filter((event) => event.side === cell.side && event.span === cell.span && event.feeClass === cell.feeClass && event.feeModel === "active-bin"));
    return crossed.pass && active.pass;
  });
  const anyEvents = input.events.length > 0;
  const h30 = !anyEvents ? "untestable" : both.length > 0 ? "confirmed" : "rejected";
  lines.push("## Verdict on H30");
  lines.push("");
  lines.push(`**${h30}.** H30 says a top-decile 5-minute volume/TVL bar is a fee event worth owning for at most an hour, on a wide bin step, after a full exit to SOL. The claim is confirmed only when the same grid cell clears the out-of-sample gates under both the crossed-bin fee model and the active-bin fee model. Cells that clear both: ${both.length === 0 ? "none" : both.map((cell) => label(cell)).join(", ")}.`);
  lines.push("");
  lines.push(costSentence(input.events));
  lines.push("");
  lines.push("## Verdict on H11");
  lines.push("");
  lines.push("H11, measured on 2026-10-10, said a forced 24-hour hold lost less than closing on the first out-of-range mark, and that costs were still larger than half of fees on most of those trades. Every H11 out-of-sample mean was negative (0h −$16.42, 24h −$8.63, 48h −$13.87, 72h −$14.40). That check used longer candles and a fee screen, not this 5-minute pump rule, so the comparison is about the round trip rather than a paired retest.");
  lines.push("");
  lines.push(h30 === "confirmed"
    ? "H30 found at least one cell that clears cash and holding out of sample under both fee models. That is a narrow exception to H11's result that a short round trip does not pay for itself. It does not reopen H11's own 24-hour cell, and it does not change a frozen forward book."
    : h30 === "untestable"
      ? "H30 did not produce events, so it neither supports nor overturns H11."
      : "H30 does not overturn H11. The pump entry and the 60-minute cap still fail the out-of-sample cash and holding test once exit slippage, fees, and any new bin-array rent are included, or the profit sits in too few coins to trust. H11's warning stands: a short DLMM round trip on these pools does not clear its cost.");
  lines.push("");
  return lines.join("\n");
}

function costSentence(events: PumpEvent[]): string {
  const oos = summarizeEvents(oosEvents(events));
  if (oos.n === 0) return "The about-3% round-trip figure was not measured, because there is no out-of-sample event.";
  const rentShare = oos.n > 0 ? oos.rentEvents / oos.n : 0;
  return `Measured out-of-sample exit cost averages ${oos.meanCostPct === null ? "n/a" : pct(oos.meanCostPct)} of the $250 deposit. ${oos.rentEvents} of ${oos.n} out-of-sample events paid bin-array rent (${pct(rentShare)}). The about-3% cycle cost is what a new bin array costs near a $100 SOL price (0.07143744 SOL is about $7 on a $250 deposit). Events that stay inside the active array pay slippage and signature fees only, so their cost is smaller than 3%.`;
}

function resultRow(cell: string, model: string, split: string, row: Summary): string {
  return `| ${cell} | ${model} | ${split} | ${row.n} | ${row.coins} | ${usd(row.mean)} | ${usd(row.median)} | ${usd(row.p5)} | ${pct(row.meanPct)} | ${row.n === 0 ? "—" : `${row.winCash}/${row.n}`} | ${row.holdDefined === 0 ? "—" : `${row.winHold}/${row.holdDefined}`} | ${usd(row.meanVsHold)} | ${pct(row.meanDd)} | ${pct(row.maxDd)} | ${pct(row.top1)} | ${pct(row.top3)} | ${pct(row.meanCostPct)} |`;
}

function label(cell: H30Cell): string {
  const fee = cell.feeClass === "1pct" ? "fee 1%" : "fee >=2%";
  return `${cell.side}, ${cell.span} bins, ${fee}`;
}

function usd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

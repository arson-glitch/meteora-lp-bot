import { DLMM_API_BASE, GECKOTERMINAL_API_BASE } from "../constants.js";
import { getJson, sleep } from "../http.js";
import { observedLpFeeShare } from "../math/fees.js";
import { ageHours } from "../markets.js";
import type { DiscoveredPool } from "../types.js";

/**
 * Historical bars for the backtest.
 *
 * Primary source is the Meteora DLMM data API:
 *   GET /pools/{address}/ohlcv?timeframe=&start_time=&end_time=
 *   GET /pools/{address}/volume/history?timeframe=&start_time=&end_time=
 * Volume history `fees` is the LP slice (protocol_fees is separate).
 * https://docs.meteora.ag/developer-guides/dlmm/api-reference/overview
 *
 * GeckoTerminal hourly candles are the fallback when Meteora returns fewer
 * than eight bars. They have no per-candle LP fee, so fees are estimated.
 */

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
  /** LP fee in USD for this candle. Already the LP slice, not the gross swap fee. */
  lpFeesUsd: number;
}

export type CandleTimeframe = "1h" | "4h" | "12h" | "24h";

export interface CandleSeries {
  poolAddress: string;
  timeframe: CandleTimeframe;
  candleHours: number;
  source: "meteora" | "geckoterminal" | "recorder";
  feeSource: "volume-history" | "fee-rate" | "mixed" | "swap-events";
  candles: Candle[];
}

const HOURS: Record<CandleTimeframe, number> = { "1h": 1, "4h": 4, "12h": 12, "24h": 24 };

export function seriesSpanDays(series: CandleSeries): number {
  const first = series.candles[0];
  const last = series.candles[series.candles.length - 1];
  if (!first || !last) return 0;
  return Math.max(0, (last.timestamp - first.timestamp) / 86_400);
}

const MIN_BARS = 8;

/**
 * Pools younger than 36h use 1h bars over two days. Pools younger than 20
 * days use 4h bars over 16 days, which is as far as that timeframe accepts.
 * Older pools use daily bars over 90 days when that series actually covers
 * at least 20 days. A daily bar's high/low path is coarser than 4h.
 */
export async function fetchCandleSeries(pool: DiscoveredPool, nowMs: number): Promise<CandleSeries> {
  const age = ageHours(pool.createdAtMs, nowMs);
  const end = Math.floor(nowMs / 1000);
  const chosen = age < 36
    ? await fetchMeteora(pool, "1h", end - 48 * 3600, end)
    : age < 24 * 20
      ? await fetchMeteora(pool, "4h", end - 16 * 24 * 3600, end)
      : await chooseLongSeries(pool, end);
  if (chosen.candles.length >= MIN_BARS) return chosen;
  const gecko = await fetchGecko(pool, nowMs);
  if (gecko.candles.length > chosen.candles.length) return gecko;
  return chosen;
}

async function chooseLongSeries(pool: DiscoveredPool, end: number): Promise<CandleSeries> {
  const daily = await fetchMeteora(pool, "24h", end - 90 * 24 * 3600, end);
  if (daily.candles.length >= MIN_BARS && seriesSpanDays(daily) >= 20) return daily;
  const intraday = await fetchMeteora(pool, "4h", end - 16 * 24 * 3600, end);
  if (intraday.candles.length >= daily.candles.length) return intraday;
  return daily.candles.length > 0 ? daily : intraday;
}

/** One Meteora ohlcv window. Empty when the API rejects that timeframe or span. */
export async function fetchCandleWindow(
  pool: DiscoveredPool,
  timeframe: CandleTimeframe,
  startSec: number,
  endSec: number,
): Promise<CandleSeries> {
  return fetchMeteora(pool, timeframe, startSec, endSec);
}

async function fetchMeteora(
  pool: DiscoveredPool,
  timeframe: CandleTimeframe,
  start: number,
  end: number,
): Promise<CandleSeries> {
  const candleHours = HOURS[timeframe];
  const empty: CandleSeries = {
    poolAddress: pool.address,
    timeframe,
    candleHours,
    source: "meteora",
    feeSource: "fee-rate",
    candles: [],
  };
  let ohlcvBody: unknown;
  let volumeBody: unknown = null;
  try {
    [ohlcvBody, volumeBody] = await Promise.all([
      getJsonRetry<unknown>(
        `${DLMM_API_BASE}/pools/${pool.address}/ohlcv?timeframe=${timeframe}&start_time=${start}&end_time=${end}`,
      ),
      getJsonRetry<unknown>(
        `${DLMM_API_BASE}/pools/${pool.address}/volume/history?timeframe=${timeframe}&start_time=${start}&end_time=${end}`,
      ).catch(() => null),
    ]);
  } catch {
    return empty;
  }
  const prices = rowsOf(ohlcvBody);
  const feesByTs = new Map<number, number>();
  for (const row of rowsOf(volumeBody)) {
    const ts = num(row.timestamp);
    if (row.fees !== undefined && row.fees !== null) feesByTs.set(ts, num(row.fees));
  }
  let historyHits = 0;
  let estimates = 0;
  const candles: Candle[] = [];
  for (const row of prices) {
    const timestamp = num(row.timestamp);
    const open = num(row.open);
    const high = num(row.high);
    const low = num(row.low);
    const close = num(row.close);
    const volumeUsd = num(row.volume);
    if (!(close > 0) || !(open > 0)) continue;
    let lpFeesUsd = feesByTs.get(timestamp);
    if (lpFeesUsd === undefined) {
      lpFeesUsd = estimateCandleLpFees(pool, volumeUsd);
      estimates += 1;
    } else {
      historyHits += 1;
    }
    candles.push({
      timestamp,
      open,
      high: Math.max(high, open, close, low),
      low: Math.min(low > 0 ? low : open, open, close),
      close,
      volumeUsd,
      lpFeesUsd,
    });
  }
  candles.sort((a, b) => a.timestamp - b.timestamp);
  const feeSource = historyHits === 0 ? "fee-rate" : estimates === 0 ? "volume-history" : "mixed";
  return {
    poolAddress: pool.address,
    timeframe,
    candleHours,
    source: "meteora",
    feeSource,
    candles: dedupe(candles),
  };
}

async function fetchGecko(pool: DiscoveredPool, nowMs: number): Promise<CandleSeries> {
  const young = ageHours(pool.createdAtMs, nowMs) < 36;
  const url = `${GECKOTERMINAL_API_BASE}/networks/solana/pools/${pool.address}/ohlcv/hour?aggregate=${young ? 1 : 4}&limit=100`;
  let rows: number[][] = [];
  try {
    const body = await getJsonRetry<unknown>(url);
    rows = geckoRows(body);
  } catch {
    rows = [];
  }
  const candleHours = young ? 1 : 4;
  const candles: Candle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [timestamp, open, high, low, close, volume] = row.map((value) => num(value));
    if (!(close > 0) || !(open > 0)) continue;
    candles.push({
      timestamp,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low > 0 ? low : open, open, close),
      close,
      volumeUsd: volume,
      lpFeesUsd: estimateCandleLpFees(pool, volume),
    });
  }
  candles.sort((a, b) => a.timestamp - b.timestamp);
  return {
    poolAddress: pool.address,
    timeframe: young ? "1h" : "4h",
    candleHours,
    source: "geckoterminal",
    feeSource: "fee-rate",
    candles: dedupe(candles),
  };
}

/**
 * Gross fee fraction is (baseFeePct + dynamicFeePct) / 100 because the API
 * stores 0.04 as 0.04%, not as 4%. The LP keeps the observed 24h share.
 * dynamicFeePct is the current snapshot, not the historical variable fee.
 */
export function estimateCandleLpFees(pool: DiscoveredPool, volumeUsd: number): number {
  if (!(volumeUsd > 0)) return 0;
  const pct = Math.min(10, Math.max(0, (pool.baseFeePct ?? 0) + (pool.dynamicFeePct ?? 0)));
  const share = observedLpFeeShare(pool.fees["24h"] ?? 0, pool.protocolFees["24h"] ?? 0);
  return volumeUsd * (pct / 100) * share;
}

async function getJsonRetry<T>(url: string): Promise<T> {
  try {
    return await getJson<T>(url, { timeoutMs: 25_000 });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
    if (status !== 429 && status < 500) throw error;
    await sleep(800);
    return getJson<T>(url, { timeoutMs: 25_000 });
  }
}

function rowsOf(body: unknown): Array<Record<string, unknown>> {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : [];
  return list.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
}

function geckoRows(body: unknown): number[][] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: { attributes?: { ohlcv_list?: unknown } } }).data;
  const list = data?.attributes?.ohlcv_list;
  return Array.isArray(list) ? (list as number[][]) : [];
}

function dedupe(candles: Candle[]): Candle[] {
  const byTs = new Map<number, Candle>();
  for (const candle of candles) byTs.set(candle.timestamp, candle);
  return [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

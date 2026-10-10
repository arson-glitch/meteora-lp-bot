import { DEXSCREENER_API_BASE } from "../constants.js";
import { getJson, sleep } from "../http.js";

/**
 * Meteora's DLMM data API (pools, ohlcv, volume history) publishes volume and
 * LP fees, not a swap count. Confirmed against the swagger and a live pool
 * payload on 2026-10-10. Counts below are DexScreener's buys+sells on that
 * same Meteora pair address over the last 24 hours.
 */

export interface SwapCount {
  address: string;
  name: string;
  swaps24h: number | null;
}

export interface TapePlan {
  pools: number;
  measured: number;
  missing: number;
  totalSwaps: number;
  median: number | null;
  p90: number | null;
  mentionsPerDay: number;
  mentionsPerPoolPerDay: number;
}

const RECORDER_DROPPED = 286_000;
const RECORDER_MINUTES = 17;

export function mentionFirehose(pools: number, dropped = RECORDER_DROPPED, minutes = RECORDER_MINUTES): {
  perDay: number;
  perPoolPerDay: number;
} {
  const perDay = dropped * ((24 * 60) / minutes);
  return { perDay, perPoolPerDay: pools > 0 ? perDay / pools : 0 };
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

/** getSignatures is one call per 1,000 signatures, so it is about 0.001 credit on top of each getTransaction. */
export function tapeCredits(swapsPerDay: number): {
  txPerDay: number;
  getTransaction: number;
  archival: number;
  batch: number;
  stream: number;
  getTransactionMonth: number;
  archivalMonth: number;
  batchMonth: number;
  streamMonth: number;
} {
  const txPerDay = swapsPerDay * 1.1;
  const getTransaction = txPerDay * 1.001;
  const archival = txPerDay * 10;
  const batch = txPerDay * 0.1;
  const stream = txPerDay;
  return {
    txPerDay,
    getTransaction,
    archival,
    batch,
    stream,
    getTransactionMonth: getTransaction * 30,
    archivalMonth: archival * 30,
    batchMonth: batch * 30,
    streamMonth: stream * 30,
  };
}

export function planForMonth(credits: number): string {
  if (credits <= 1_000_000) return "Free ($0, 1M)";
  if (credits <= 10_000_000) return "Developer ($49, 10M)";
  if (credits <= 100_000_000) return "Business ($499, 100M)";
  if (credits <= 200_000_000) return "Professional ($999, 200M)";
  return "above Professional; extra credits are $5 per 1M";
}

export function planForSwaps(swapsPerDay: number): string {
  const month = tapeCredits(swapsPerDay).batchMonth;
  if (month <= 1_000_000) return "Free ($0, 1M) via getTransactionsForAddress";
  if (month <= 10_000_000) return "Developer ($49, 10M) via getTransactionsForAddress";
  if (month <= 100_000_000) return "Business ($499, 100M)";
  if (month <= 200_000_000) return "Professional ($999, 200M)";
  return "above Professional; extra credits are $5 per 1M";
}

export async function fetchSwapCounts(
  pools: Array<{ address: string; name: string }>,
  log: (line: string) => void,
): Promise<SwapCount[]> {
  const out = new Map<string, SwapCount>();
  for (const pool of pools) out.set(pool.address, { address: pool.address, name: pool.name, swaps24h: null });
  const addresses = [...out.keys()];
  for (let i = 0; i < addresses.length; i += 30) {
    const batch = addresses.slice(i, i + 30);
    log(`DexScreener swap counts ${i + batch.length}/${addresses.length}`);
    try {
      const body = await getJson<{ pairs?: Array<{ pairAddress?: string; txns?: { h24?: { buys?: number; sells?: number } } }> }>(
        `${DEXSCREENER_API_BASE}/latest/dex/pairs/solana/${batch.join(",")}`,
      );
      for (const pair of body.pairs ?? []) {
        const address = pair.pairAddress ?? "";
        const row = out.get(address);
        if (!row) continue;
        const buys = pair.txns?.h24?.buys ?? 0;
        const sells = pair.txns?.h24?.sells ?? 0;
        row.swaps24h = buys + sells;
      }
    } catch (error) {
      log(`DexScreener batch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(250);
  }
  return [...out.values()];
}

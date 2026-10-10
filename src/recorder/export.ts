import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CandleSeries } from "../tournament/candles.js";
import type { CoinType, DiscoveredPool } from "../types.js";
import { swapsToCandles } from "./prices.js";
import type { TrackedPool } from "./pools.js";
import { openStore, type LiquidityRow, type SwapRow } from "./store.js";

export interface RecorderSeriesFile {
  pool: DiscoveredPool;
  series: CandleSeries;
}

/**
 * Writes one series file per pool in the shape `replayStrategy` consumes
 * (`series.candles`, `series.candleHours`) plus JSONL tapes of the raw events.
 */
export function exportRecorder(dbPath: string, outDir: string): string[] {
  const store = openStore(dbPath);
  try {
    mkdirSync(outDir, { recursive: true });
    const written: string[] = [];
    for (const pool of store.listPools()) {
      const swaps = store.swapsFor(pool.address);
      const liquidity = store.liquidityFor(pool.address);
      const snapshots = store.snapshotsFor(pool.address);
      const candles = swapsToCandles(swaps.map(toPriced), pool, 3600);
      const last = candles[candles.length - 1];
      const series: CandleSeries = {
        poolAddress: pool.address,
        timeframe: "1h",
        candleHours: 1,
        source: "recorder",
        feeSource: "swap-events",
        candles,
      };
      const file: RecorderSeriesFile = {
        pool: toDiscovered(pool, last?.close ?? pool.currentPrice),
        series,
      };
      const base = resolve(outDir, pool.address);
      const seriesPath = `${base}.series.json`;
      writeFileSync(seriesPath, `${JSON.stringify(file)}\n`);
      writeFileSync(`${base}.swaps.jsonl`, `${swaps.map((row) => JSON.stringify(toSwapExport(row))).join("\n")}${swaps.length ? "\n" : ""}`);
      writeFileSync(`${base}.liquidity.jsonl`, `${liquidity.map((row) => JSON.stringify(toLiquidityExport(row))).join("\n")}${liquidity.length ? "\n" : ""}`);
      writeFileSync(`${base}.snapshots.jsonl`, `${snapshots.map((row) => JSON.stringify({
        takenAt: row.takenAt,
        slot: row.slot,
        activeBin: row.activeBin,
        binStep: row.binStep,
        bins: JSON.parse(row.bins) as unknown,
      })).join("\n")}${snapshots.length ? "\n" : ""}`);
      written.push(seriesPath);
    }
    return written;
  } finally {
    store.close();
  }
}

export function toDiscovered(pool: TrackedPool, price: number): DiscoveredPool {
  const coin = pool.coinType === "unclassified" ? "older-memecoin" : pool.coinType;
  return {
    product: "dlmm",
    address: pool.address,
    name: pool.name,
    tokenX: token(pool.mintX, pool.symbolX, pool.decimalsX, pool.priceUsdX),
    tokenY: token(pool.mintY, pool.symbolY, pool.decimalsY, pool.priceUsdY),
    tvlUsd: pool.tvlUsd,
    currentPrice: price > 0 ? price : pool.currentPrice,
    binStep: pool.binStep,
    baseFeePct: pool.baseFeePct,
    dynamicFeePct: pool.dynamicFeePct,
    protocolFeePct: pool.protocolFeePct,
    collectFeeMode: null,
    createdAtMs: pool.addedAtMs,
    volume: {},
    fees: {},
    protocolFees: {},
    feeTvlRatio: {},
    isBlacklisted: false,
    launchpad: "",
    tags: [coin satisfies CoinType],
    listSource: "volume",
    market: {
      source: "none",
      dexId: null,
      pairAddress: null,
      priceChangeH1Pct: null,
      priceChangeH24Pct: null,
      volumeH24Usd: null,
      liquidityUsd: pool.tvlUsd,
    },
  };
}

function token(address: string, symbol: string, decimals: number, priceUsd: number) {
  return {
    address,
    symbol,
    name: symbol,
    decimals,
    priceUsd,
    holders: null,
    freezeAuthorityDisabled: null,
    isVerified: false,
    marketCapUsd: null,
  };
}

function toPriced(row: SwapRow) {
  const timeSec = row.blockTime ?? Math.floor(row.receivedAt / 1000);
  return {
    timeSec,
    startBin: row.startBin,
    endBin: row.endBin,
    swapForY: row.swapForY,
    amountIn: row.amountIn,
    fee: row.fee,
    feeToken: row.feeToken,
  };
}

function toSwapExport(row: SwapRow) {
  return {
    signature: row.signature,
    slot: row.slot,
    time: row.blockTime ?? Math.floor(row.receivedAt / 1000),
    pool: row.pool,
    trader: row.trader,
    startBin: row.startBin,
    endBin: row.endBin,
    swapForY: row.swapForY,
    amountIn: row.amountIn,
    amountOut: row.amountOut,
    amountLeft: row.amountLeft,
    fee: row.fee,
    protocolFee: row.protocolFee,
    limitOrderFee: row.limitOrderFee,
    hostFee: row.hostFee,
    feeBps: row.feeBps,
    feeToken: row.feeToken,
    kind: row.kind,
  };
}

function toLiquidityExport(row: LiquidityRow) {
  return {
    signature: row.signature,
    slot: row.slot,
    time: row.blockTime ?? Math.floor(row.receivedAt / 1000),
    pool: row.pool,
    trader: row.trader,
    position: row.position,
    amountX: row.amountX,
    amountY: row.amountY,
    activeBin: row.activeBin,
    action: row.action,
  };
}

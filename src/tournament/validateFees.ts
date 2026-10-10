import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { strategyBinWeights } from "../math/distribution.js";
import { liquidityBinsFromMove } from "./h12walk.js";

const DEPOSIT_USD = 250;
const BINS_EACH_SIDE = 10;
const MAX_GAP_MS = 30 * 60 * 1000;

export interface TapeSnapshot {
  pool: string;
  timeMs: number;
  activeBin: number;
  binStep: number;
  tvlUsd: number;
  bins: Array<{ binId: number; usd: number }>;
}

export interface TapeSwap {
  pool: string;
  timeMs: number;
  startBin: number;
  endBin: number;
  feeUsd: number;
}

export interface FeeCheck {
  pools: number;
  snapshots: number;
  swaps: number;
  scoredSwaps: number;
  activeMaeUsd: number | null;
  crossedMaeUsd: number | null;
  closer: "active-bin" | "crossed-bins" | "tie" | "no-overlap";
  medianActiveShare: number | null;
  modelActiveShare: number | null;
}

/**
 * A $250 two-sided Spot position. Ground truth assigns each swap's LP fee
 * across the bins it crossed, in proportion to snapshot liquidity, then by
 * our dollars in that bin. The active-bin model gives the whole fee to the
 * active bin against TVL/N. The crossed-bin model splits the fee evenly
 * across the crossed bins against the same TVL/N.
 */
export function compareFeeModels(snapshots: TapeSnapshot[], swaps: TapeSwap[]): FeeCheck {
  const byPool = new Map<string, TapeSnapshot[]>();
  for (const snap of snapshots) {
    const list = byPool.get(snap.pool) ?? [];
    list.push(snap);
    byPool.set(snap.pool, list);
  }
  for (const list of byPool.values()) list.sort((a, b) => a.timeMs - b.timeMs);

  const shares: number[] = [];
  const modelShares: number[] = [];
  let activeAbs = 0;
  let crossedAbs = 0;
  let scored = 0;
  const pools = new Set<string>();

  for (const snap of snapshots) {
    if (!(snap.tvlUsd > 0)) continue;
    const active = snap.bins.find((bin) => bin.binId === snap.activeBin);
    if (!active) continue;
    const n = liquidityBinsFromMove(snap.binStep, 0.1);
    shares.push(active.usd / snap.tvlUsd);
    modelShares.push(1 / n);
    pools.add(snap.pool);
  }

  for (const swap of swaps) {
    if (!(swap.feeUsd > 0)) continue;
    const snaps = byPool.get(swap.pool);
    if (!snaps) continue;
    const snap = latestAtOrBefore(snaps, swap.timeMs);
    if (!snap || swap.timeMs - snap.timeMs > MAX_GAP_MS || !(snap.tvlUsd > 0)) continue;
    const truth = truthFee(snap, swap);
    if (truth === null) continue;
    const n = liquidityBinsFromMove(snap.binStep, 0.1);
    const ours = ourUsdByBin(snap.activeBin, BINS_EACH_SIDE);
    activeAbs += Math.abs(activeModelFee(snap, swap, ours, n) - truth);
    crossedAbs += Math.abs(crossedModelFee(snap, swap, ours, n) - truth);
    scored += 1;
    pools.add(swap.pool);
  }

  const activeMae = scored > 0 ? activeAbs / scored : null;
  const crossedMae = scored > 0 ? crossedAbs / scored : null;
  let closer: FeeCheck["closer"] = "no-overlap";
  if (activeMae !== null && crossedMae !== null) {
    const gap = Math.abs(activeMae - crossedMae);
    closer = gap < 1e-9 ? "tie" : activeMae < crossedMae ? "active-bin" : "crossed-bins";
  }
  return {
    pools: pools.size,
    snapshots: snapshots.length,
    swaps: swaps.length,
    scoredSwaps: scored,
    activeMaeUsd: activeMae,
    crossedMaeUsd: crossedMae,
    closer,
    medianActiveShare: median(shares),
    modelActiveShare: median(modelShares),
  };
}

export function renderFeeCheck(check: FeeCheck, dbPath: string): string {
  const lines = [
    "# Fee model check",
    "",
    `Paper only. Database \`${dbPath}\`. Hypothetical deposit $${DEPOSIT_USD}, two-sided Spot, ${BINS_EACH_SIDE} bins each side. A swap is scored when a snapshot of the same pool is at most 30 minutes older.`,
    "",
    `Pools in the overlap: ${check.pools}. Snapshots: ${check.snapshots}. Swaps: ${check.swaps}. Swaps with a snapshot and positive LP fee: ${check.scoredSwaps}.`,
    "",
    `Median snapshot active-bin share of TVL: ${pct(check.medianActiveShare)}. Even-spread model share: ${pct(check.modelActiveShare)}.`,
    "",
    `Mean absolute error versus snapshot-weighted fees: active-bin ${usd(check.activeMaeUsd)}, crossed-bin ${usd(check.crossedMaeUsd)}.`,
    "",
    check.closer === "no-overlap"
      ? "No overlapping swap and snapshot, so neither model was scored."
      : `Closer model: ${check.closer}.`,
    "",
  ];
  return lines.join("\n");
}

export function validateFeesFile(dbPath: string, reportPath?: string): string {
  if (!existsSync(dbPath)) {
    const text = renderFeeCheck(emptyCheck(), dbPath).replace(
      "No overlapping swap and snapshot, so neither model was scored.",
      `Database not found at ${dbPath}. No overlapping swap and snapshot, so neither model was scored.`,
    );
    if (reportPath) writeReport(reportPath, text);
    return text;
  }
  const loaded = readRecorder(dbPath);
  const check = compareFeeModels(loaded.snapshots, loaded.swaps);
  const text = renderFeeCheck(check, dbPath);
  if (reportPath) writeReport(reportPath, text);
  return text;
}

function emptyCheck(): FeeCheck {
  return {
    pools: 0,
    snapshots: 0,
    swaps: 0,
    scoredSwaps: 0,
    activeMaeUsd: null,
    crossedMaeUsd: null,
    closer: "no-overlap",
    medianActiveShare: null,
    modelActiveShare: null,
  };
}

function readRecorder(dbPath: string): { snapshots: TapeSnapshot[]; swaps: TapeSwap[] } {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const pools = db.prepare(`SELECT json FROM pools`).all() as Array<{ json: string }>;
  const meta = new Map<string, { decimalsX: number; decimalsY: number; priceUsdX: number; priceUsdY: number; tvlUsd: number; binStep: number }>();
  for (const row of pools) {
    const parsed = JSON.parse(row.json) as {
      address?: string;
      decimalsX?: number;
      decimalsY?: number;
      priceUsdX?: number;
      priceUsdY?: number;
      tvlUsd?: number;
      binStep?: number;
    };
    if (!parsed.address) continue;
    meta.set(parsed.address, {
      decimalsX: parsed.decimalsX ?? 0,
      decimalsY: parsed.decimalsY ?? 0,
      priceUsdX: parsed.priceUsdX ?? 0,
      priceUsdY: parsed.priceUsdY ?? 0,
      tvlUsd: parsed.tvlUsd ?? 0,
      binStep: parsed.binStep ?? 0,
    });
  }
  const snapshots: TapeSnapshot[] = [];
  const snapRows = db.prepare(`SELECT pool, taken_at, active_bin, bin_step, bins FROM snapshots`).all() as Array<{
    pool: string;
    taken_at: number;
    active_bin: number;
    bin_step: number;
    bins: string;
  }>;
  for (const row of snapRows) {
    const pool = meta.get(row.pool);
    if (!pool) continue;
    const packed = JSON.parse(row.bins) as Array<[number, string, string]>;
    const bins = packed.map(([binId, xRaw, yRaw]) => ({
      binId,
      usd: tokenUsd(xRaw, pool.decimalsX, pool.priceUsdX) + tokenUsd(yRaw, pool.decimalsY, pool.priceUsdY),
    }));
    snapshots.push({
      pool: row.pool,
      timeMs: row.taken_at,
      activeBin: row.active_bin,
      binStep: row.bin_step || pool.binStep,
      tvlUsd: pool.tvlUsd,
      bins,
    });
  }
  const swaps: TapeSwap[] = [];
  const swapRows = db.prepare(`SELECT pool, received_at, start_bin, end_bin, fee, fee_token FROM swaps`).all() as Array<{
    pool: string;
    received_at: number;
    start_bin: number;
    end_bin: number;
    fee: string;
    fee_token: string;
  }>;
  for (const row of swapRows) {
    const pool = meta.get(row.pool);
    if (!pool) continue;
    const decimals = row.fee_token === "y" ? pool.decimalsY : pool.decimalsX;
    const price = row.fee_token === "y" ? pool.priceUsdY : pool.priceUsdX;
    swaps.push({
      pool: row.pool,
      timeMs: row.received_at,
      startBin: row.start_bin,
      endBin: row.end_bin,
      feeUsd: tokenUsd(row.fee, decimals, price),
    });
  }
  db.close();
  return { snapshots, swaps };
}

function truthFee(snap: TapeSnapshot, swap: TapeSwap): number | null {
  const lo = Math.min(swap.startBin, swap.endBin);
  const hi = Math.max(swap.startBin, swap.endBin);
  const crossed = snap.bins.filter((bin) => bin.binId >= lo && bin.binId <= hi && bin.usd > 0);
  if (crossed.length === 0) return null;
  const total = crossed.reduce((sum, bin) => sum + bin.usd, 0);
  if (!(total > 0)) return null;
  const ours = ourUsdByBin(snap.activeBin, BINS_EACH_SIDE);
  let fee = 0;
  for (const bin of crossed) {
    const slice = swap.feeUsd * (bin.usd / total);
    const our = ours.get(bin.binId) ?? 0;
    if (our <= 0) continue;
    fee += slice * Math.min(our / bin.usd, 1);
  }
  return fee;
}

function activeModelFee(snap: TapeSnapshot, swap: TapeSwap, ours: Map<number, number>, liquidityBins: number): number {
  const lo = Math.min(swap.startBin, swap.endBin);
  const hi = Math.max(swap.startBin, swap.endBin);
  if (snap.activeBin < lo || snap.activeBin > hi) return 0;
  const our = ours.get(snap.activeBin) ?? 0;
  if (our <= 0 || liquidityBins <= 0) return 0;
  const poolBin = snap.tvlUsd / liquidityBins;
  if (!(poolBin > 0)) return 0;
  return swap.feeUsd * Math.min(our / poolBin, 1);
}

function crossedModelFee(snap: TapeSnapshot, swap: TapeSwap, ours: Map<number, number>, liquidityBins: number): number {
  const lo = Math.min(swap.startBin, swap.endBin);
  const hi = Math.max(swap.startBin, swap.endBin);
  const ids: number[] = [];
  for (let binId = lo; binId <= hi; binId += 1) ids.push(binId);
  if (ids.length === 0 || liquidityBins <= 0) return 0;
  const poolBin = snap.tvlUsd / liquidityBins;
  if (!(poolBin > 0)) return 0;
  const slice = swap.feeUsd / ids.length;
  let fee = 0;
  for (const binId of ids) {
    const our = ours.get(binId) ?? 0;
    if (our <= 0) continue;
    fee += slice * Math.min(our / poolBin, 1);
  }
  return fee;
}

function ourUsdByBin(activeBin: number, binsEachSide: number): Map<number, number> {
  const weights = strategyBinWeights({
    shape: "Spot",
    sidedness: "two-sided",
    minBinId: activeBin - binsEachSide,
    maxBinId: activeBin + binsEachSide,
    activeBinId: activeBin,
  });
  const bids = weights.filter((weight) => weight.side === "bid");
  const asks = weights.filter((weight) => weight.side === "ask");
  const bidWeight = bids.reduce((sum, weight) => sum + weight.weight, 0);
  const askWeight = asks.reduce((sum, weight) => sum + weight.weight, 0);
  const out = new Map<number, number>();
  for (const weight of bids) {
    if (bidWeight <= 0) continue;
    out.set(weight.binId, (DEPOSIT_USD * 0.5 * weight.weight) / bidWeight);
  }
  for (const weight of asks) {
    if (askWeight <= 0) continue;
    out.set(weight.binId, (DEPOSIT_USD * 0.5 * weight.weight) / askWeight);
  }
  return out;
}

function latestAtOrBefore(snaps: TapeSnapshot[], timeMs: number): TapeSnapshot | null {
  let found: TapeSnapshot | null = null;
  for (const snap of snaps) {
    if (snap.timeMs > timeMs) break;
    found = snap;
  }
  return found;
}

function tokenUsd(raw: string, decimals: number, price: number): number {
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0 || !(price > 0)) return 0;
  return (amount / 10 ** decimals) * price;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function writeReport(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function usd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(4)}`;
}

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(2)}%`;
}

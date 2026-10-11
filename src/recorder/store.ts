import { mkdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { dirname } from "node:path";
import { hourStartMs, utcDayStartMs, wsCredits } from "./budget.js";
import type { DecodedLiquidity, DecodedSwap } from "./decode.js";
import type { TrackedPool } from "./pools.js";

export interface SwapRow {
  signature: string;
  eventIndex: number;
  slot: number;
  blockTime: number | null;
  receivedAt: number;
  pool: string;
  trader: string;
  startBin: number;
  endBin: number;
  swapForY: boolean;
  amountIn: string;
  amountOut: string;
  amountLeft: string | null;
  fee: string;
  protocolFee: string;
  limitOrderFee: string | null;
  hostFee: string | null;
  feeBps: string | null;
  feeToken: "x" | "y";
  kind: string;
}

export interface LiquidityRow {
  signature: string;
  eventIndex: number;
  slot: number;
  blockTime: number | null;
  receivedAt: number;
  pool: string;
  trader: string;
  position: string;
  amountX: string;
  amountY: string;
  activeBin: number;
  action: "add" | "remove";
}

/** Sqlite meta key. The dashboard treats any meta key matching /drop/i as this count. */
export const DROPPED_META_KEY = "dropped_messages";

export interface CreditHour {
  hourStart: number;
  rpcCalls: number;
  rpcCredits: number;
  wsMessages: number;
  wsBytes: number;
}

export class RecorderStore {
  private readonly insertSwapStmt: StatementSync;
  private readonly insertLiqStmt: StatementSync;
  private readonly insertSnapStmt: StatementSync;
  private readonly upsertPoolStmt: StatementSync;
  private readonly upsertHourStmt: StatementSync;
  private readonly metaStmt: StatementSync;

  constructor(readonly db: DatabaseSync) {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS pools (
        address TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS swaps (
        signature TEXT NOT NULL,
        event_index INTEGER NOT NULL,
        slot INTEGER NOT NULL,
        block_time INTEGER,
        received_at INTEGER NOT NULL,
        pool TEXT NOT NULL,
        trader TEXT NOT NULL,
        start_bin INTEGER NOT NULL,
        end_bin INTEGER NOT NULL,
        swap_for_y INTEGER NOT NULL,
        amount_in TEXT NOT NULL,
        amount_out TEXT NOT NULL,
        amount_left TEXT,
        fee TEXT NOT NULL,
        protocol_fee TEXT NOT NULL,
        limit_order_fee TEXT,
        host_fee TEXT,
        fee_bps TEXT,
        fee_token TEXT NOT NULL,
        kind TEXT NOT NULL,
        PRIMARY KEY (signature, event_index)
      );
      CREATE INDEX IF NOT EXISTS swaps_pool_time ON swaps(pool, received_at);
      CREATE TABLE IF NOT EXISTS liquidity (
        signature TEXT NOT NULL,
        event_index INTEGER NOT NULL,
        slot INTEGER NOT NULL,
        block_time INTEGER,
        received_at INTEGER NOT NULL,
        pool TEXT NOT NULL,
        trader TEXT NOT NULL,
        position TEXT NOT NULL,
        amount_x TEXT NOT NULL,
        amount_y TEXT NOT NULL,
        active_bin INTEGER NOT NULL,
        action TEXT NOT NULL,
        PRIMARY KEY (signature, event_index)
      );
      CREATE INDEX IF NOT EXISTS liquidity_pool_time ON liquidity(pool, received_at);
      CREATE TABLE IF NOT EXISTS snapshots (
        pool TEXT NOT NULL,
        taken_at INTEGER NOT NULL,
        slot INTEGER,
        active_bin INTEGER NOT NULL,
        bin_step INTEGER NOT NULL,
        bins TEXT NOT NULL,
        PRIMARY KEY (pool, taken_at)
      );
      CREATE TABLE IF NOT EXISTS credit_hours (
        hour_start INTEGER PRIMARY KEY,
        rpc_calls INTEGER NOT NULL,
        rpc_credits INTEGER NOT NULL,
        ws_messages INTEGER NOT NULL,
        ws_bytes INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.insertSwapStmt = db.prepare(`
      INSERT OR IGNORE INTO swaps (
        signature, event_index, slot, block_time, received_at, pool, trader,
        start_bin, end_bin, swap_for_y, amount_in, amount_out, amount_left,
        fee, protocol_fee, limit_order_fee, host_fee, fee_bps, fee_token, kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.insertLiqStmt = db.prepare(`
      INSERT OR IGNORE INTO liquidity (
        signature, event_index, slot, block_time, received_at, pool, trader,
        position, amount_x, amount_y, active_bin, action
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.insertSnapStmt = db.prepare(`
      INSERT OR REPLACE INTO snapshots (pool, taken_at, slot, active_bin, bin_step, bins)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.upsertPoolStmt = db.prepare(`INSERT OR REPLACE INTO pools (address, json) VALUES (?, ?)`);
    this.upsertHourStmt = db.prepare(`
      INSERT INTO credit_hours (hour_start, rpc_calls, rpc_credits, ws_messages, ws_bytes)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(hour_start) DO UPDATE SET
        rpc_calls = excluded.rpc_calls,
        rpc_credits = excluded.rpc_credits,
        ws_messages = excluded.ws_messages,
        ws_bytes = excluded.ws_bytes
    `);
    this.metaStmt = db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`);
  }

  upsertPools(pools: TrackedPool[]): void {
    for (const pool of pools) this.upsertPoolStmt.run(pool.address, JSON.stringify(pool));
  }

  insertSwap(row: SwapRow): boolean {
    const result = this.insertSwapStmt.run(
      row.signature,
      row.eventIndex,
      row.slot,
      row.blockTime,
      row.receivedAt,
      row.pool,
      row.trader,
      row.startBin,
      row.endBin,
      row.swapForY ? 1 : 0,
      row.amountIn,
      row.amountOut,
      row.amountLeft,
      row.fee,
      row.protocolFee,
      row.limitOrderFee,
      row.hostFee,
      row.feeBps,
      row.feeToken,
      row.kind,
    );
    return result.changes > 0;
  }

  insertLiquidity(row: LiquidityRow): boolean {
    const result = this.insertLiqStmt.run(
      row.signature,
      row.eventIndex,
      row.slot,
      row.blockTime,
      row.receivedAt,
      row.pool,
      row.trader,
      row.position,
      row.amountX,
      row.amountY,
      row.activeBin,
      row.action,
    );
    return result.changes > 0;
  }

  insertSnapshot(pool: string, takenAt: number, slot: number | null, activeBin: number, binStep: number, bins: string): void {
    this.insertSnapStmt.run(pool, takenAt, slot, activeBin, binStep, bins);
  }

  saveHour(hour: CreditHour): void {
    this.upsertHourStmt.run(hour.hourStart, hour.rpcCalls, hour.rpcCredits, hour.wsMessages, hour.wsBytes);
  }

  getHour(hourStart: number): CreditHour | null {
    const row = this.db.prepare(`
      SELECT hour_start, rpc_calls, rpc_credits, ws_messages, ws_bytes
      FROM credit_hours WHERE hour_start = ?
    `).get(hourStart) as CreditHourRow | undefined;
    return row ? mapHour(row) : null;
  }

  creditsSince(startMs: number): number {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(rpc_credits), 0) AS rpc, COALESCE(SUM(ws_bytes), 0) AS bytes
      FROM credit_hours WHERE hour_start >= ?
    `).get(startMs) as { rpc: number; bytes: number };
    return row.rpc + wsCredits(row.bytes);
  }

  /** First stored hour at or after `startMs`. Null when this span has no rows. */
  earliestHour(startMs: number): number | null {
    const row = this.db.prepare(`
      SELECT MIN(hour_start) AS t FROM credit_hours WHERE hour_start >= ?
    `).get(startMs) as { t: number | null };
    return typeof row.t === "number" ? row.t : null;
  }

  droppedCount(): number {
    const raw = Number(this.getMeta(DROPPED_META_KEY) ?? "0");
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  }

  setDroppedCount(count: number): void {
    this.setMeta(DROPPED_META_KEY, String(Math.max(0, Math.floor(count))));
  }

  setMeta(key: string, value: string): void {
    this.metaStmt.run(key, value);
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  lastReceivedAt(): number {
    const row = this.db.prepare(`SELECT MAX(received_at) AS t FROM swaps`).get() as { t: number | null };
    return row.t ?? 0;
  }

  knownSignature(signature: string): boolean {
    const row = this.db.prepare(`SELECT 1 AS ok FROM swaps WHERE signature = ? LIMIT 1`).get(signature) as { ok: number } | undefined;
    return row !== undefined;
  }

  listPools(): TrackedPool[] {
    const rows = this.db.prepare(`SELECT json FROM pools`).all() as Array<{ json: string }>;
    return rows.map((row) => JSON.parse(row.json) as TrackedPool);
  }

  swapsFor(pool: string): SwapRow[] {
    const rows = this.db.prepare(`
      SELECT signature, event_index, slot, block_time, received_at, pool, trader,
             start_bin, end_bin, swap_for_y, amount_in, amount_out, amount_left,
             fee, protocol_fee, limit_order_fee, host_fee, fee_bps, fee_token, kind
      FROM swaps WHERE pool = ? ORDER BY received_at, event_index
    `).all(pool) as unknown as SwapSql[];
    return rows.map(mapSwap);
  }

  liquidityFor(pool: string): LiquidityRow[] {
    const rows = this.db.prepare(`
      SELECT signature, event_index, slot, block_time, received_at, pool, trader,
             position, amount_x, amount_y, active_bin, action
      FROM liquidity WHERE pool = ? ORDER BY received_at, event_index
    `).all(pool) as unknown as LiquiditySql[];
    return rows.map(mapLiquidity);
  }

  snapshotsFor(pool: string): Array<{ takenAt: number; slot: number | null; activeBin: number; binStep: number; bins: string }> {
    return (this.db.prepare(`
      SELECT taken_at, slot, active_bin, bin_step, bins FROM snapshots WHERE pool = ? ORDER BY taken_at
    `).all(pool) as Array<{ taken_at: number; slot: number | null; active_bin: number; bin_step: number; bins: string }>).map((row) => ({
      takenAt: row.taken_at,
      slot: row.slot,
      activeBin: row.active_bin,
      binStep: row.bin_step,
      bins: row.bins,
    }));
  }

  counts(): { swaps: number; liquidity: number; snapshots: number } {
    const swaps = this.db.prepare(`SELECT COUNT(*) AS n FROM swaps`).get() as { n: number };
    const liquidity = this.db.prepare(`SELECT COUNT(*) AS n FROM liquidity`).get() as { n: number };
    const snapshots = this.db.prepare(`SELECT COUNT(*) AS n FROM snapshots`).get() as { n: number };
    return { swaps: swaps.n, liquidity: liquidity.n, snapshots: snapshots.n };
  }

  close(): void {
    this.db.close();
  }
}

export function openStore(path: string): RecorderStore {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  return new RecorderStore(new DatabaseSync(path));
}

export function swapRow(event: DecodedSwap, signature: string, slot: number, receivedAt: number, blockTime: number | null): SwapRow {
  return {
    signature,
    eventIndex: event.index,
    slot,
    blockTime,
    receivedAt,
    pool: event.pool,
    trader: event.trader,
    startBin: event.startBin,
    endBin: event.endBin,
    swapForY: event.swapForY,
    amountIn: event.amountIn,
    amountOut: event.amountOut,
    amountLeft: event.amountLeft,
    fee: event.fee,
    protocolFee: event.protocolFee,
    limitOrderFee: event.limitOrderFee,
    hostFee: event.hostFee,
    feeBps: event.feeBps,
    feeToken: event.feeToken,
    kind: event.event,
  };
}

export function liquidityRow(event: DecodedLiquidity, signature: string, slot: number, receivedAt: number, blockTime: number | null): LiquidityRow {
  return {
    signature,
    eventIndex: event.index,
    slot,
    blockTime,
    receivedAt,
    pool: event.pool,
    trader: event.trader,
    position: event.position,
    amountX: event.amountX,
    amountY: event.amountY,
    activeBin: event.activeBin,
    action: event.action,
  };
}

interface CreditHourRow {
  hour_start: number;
  rpc_calls: number;
  rpc_credits: number;
  ws_messages: number;
  ws_bytes: number;
}

function mapHour(row: CreditHourRow): CreditHour {
  return {
    hourStart: row.hour_start,
    rpcCalls: row.rpc_calls,
    rpcCredits: row.rpc_credits,
    wsMessages: row.ws_messages,
    wsBytes: row.ws_bytes,
  };
}

interface SwapSql {
  signature: string;
  event_index: number;
  slot: number;
  block_time: number | null;
  received_at: number;
  pool: string;
  trader: string;
  start_bin: number;
  end_bin: number;
  swap_for_y: number;
  amount_in: string;
  amount_out: string;
  amount_left: string | null;
  fee: string;
  protocol_fee: string;
  limit_order_fee: string | null;
  host_fee: string | null;
  fee_bps: string | null;
  fee_token: string;
  kind: string;
}

function mapSwap(row: SwapSql): SwapRow {
  return {
    signature: row.signature,
    eventIndex: row.event_index,
    slot: row.slot,
    blockTime: row.block_time,
    receivedAt: row.received_at,
    pool: row.pool,
    trader: row.trader,
    startBin: row.start_bin,
    endBin: row.end_bin,
    swapForY: row.swap_for_y === 1,
    amountIn: row.amount_in,
    amountOut: row.amount_out,
    amountLeft: row.amount_left,
    fee: row.fee,
    protocolFee: row.protocol_fee,
    limitOrderFee: row.limit_order_fee,
    hostFee: row.host_fee,
    feeBps: row.fee_bps,
    feeToken: row.fee_token === "x" ? "x" : "y",
    kind: row.kind,
  };
}

interface LiquiditySql {
  signature: string;
  event_index: number;
  slot: number;
  block_time: number | null;
  received_at: number;
  pool: string;
  trader: string;
  position: string;
  amount_x: string;
  amount_y: string;
  active_bin: number;
  action: string;
}

function mapLiquidity(row: LiquiditySql): LiquidityRow {
  return {
    signature: row.signature,
    eventIndex: row.event_index,
    slot: row.slot,
    blockTime: row.block_time,
    receivedAt: row.received_at,
    pool: row.pool,
    trader: row.trader,
    position: row.position,
    amountX: row.amount_x,
    amountY: row.amount_y,
    activeBin: row.active_bin,
    action: row.action === "remove" ? "remove" : "add",
  };
}

export function dayCredits(store: RecorderStore, nowMs: number, pending: CreditHour | null): number {
  const start = utcDayStartMs(nowMs);
  let total = store.creditsSince(start);
  if (pending && pending.hourStart >= start) {
    const saved = store.getHour(pending.hourStart);
    const savedCredits = saved ? saved.rpcCredits + wsCredits(saved.wsBytes) : 0;
    total += pending.rpcCredits + wsCredits(pending.wsBytes) - savedCredits;
  }
  return total;
}

import { unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DLMM_PROGRAM_ID } from "../constants.js";
import { sleep } from "../http.js";
import { backfillPools } from "./backfill.js";
import {
  DEFAULT_DAILY_CREDIT_CAP,
  DEFAULT_RPC_RPS,
  HELIUS_FREE_MONTHLY_CREDITS,
  HELIUS_FREE_RPC_RPS,
  hourStartMs,
  projectedFromHourCredits,
  projectedMonthCredits,
  reservedSnapshotCredits,
} from "./budget.js";
import { decodeDlmmEvents, selectTracked, type DecodedEvent } from "./decode.js";
import { CreditMeter, limiterForRps, meteredConnection } from "./meter.js";
import { loadSmokePools, loadTrackedPools, writePoolFile, type TrackedPool } from "./pools.js";
import { redact, endpointLabel } from "./redact.js";
import { snapshotPool, type SnapshotClient } from "./snapshot.js";
import { openStore, liquidityRow, swapRow } from "./store.js";
import { LogSubscriber, type WsMode } from "./subscribe.js";
import { eventsFromTransaction } from "./txEvents.js";
import { parseWsBuckets, poolsForWebsocket, WS_BUCKETS } from "./wsFilter.js";

export interface RecordOptions {
  dir: string;
  refreshPools: boolean;
  smoke: boolean;
  smokeSeconds: number;
  smokePools: number;
  poolLimit: number;
  rps: number;
  snapshotMinutes: number;
  binsEachSide: number;
  dailyCap: number;
  wsMode: WsMode;
  /** Comma-separated coin types. Omit or `all` to stream every pool. */
  wsBuckets: string | undefined;
  /** Each UTC hour, unsubscribe this many loudest pools. 0 keeps every subscription. */
  wsDropNoisiest: number;
  backfillPerPool: number;
  backfillMaxAgeMs: number;
  secret: string | undefined;
  rpcUrl: string;
}

export async function runRecord(options: RecordOptions): Promise<{ swaps: number; liquidity: number; snapshots: number }> {
  const log = (line: string) => {
    console.log(`${new Date().toISOString()} ${redact(line, options.secret)}`);
  };
  if (process.env.MODE === "live") log("MODE=live is ignored. This process only reads chain data.");
  const endpoint = resolveEndpoint(options.secret, options.rpcUrl);
  log(`recorder read-only endpoint=${endpointLabel(endpoint.helius)} ws=${options.wsMode} rps=${options.rps} daily_cap=${options.dailyCap} free_monthly=${HELIUS_FREE_MONTHLY_CREDITS} free_rps=${HELIUS_FREE_RPC_RPS}`);
  if (options.wsMode === "program") {
    log("program-wide logsSubscribe streams every DLMM log. On the free plan that spends credits on pools you do not track.");
  }
  const dbPath = resolve(options.dir, "recorder.sqlite");
  const poolPath = resolve(options.dir, "pools.json");
  const store = openStore(dbPath);
  const nowMs = Date.now();
  const pools = options.smoke
    ? await loadSmokePools(options.smokePools, nowMs)
    : await loadTrackedPools({
      path: poolPath,
      refresh: options.refreshPools,
      limit: options.poolLimit,
      nowMs,
      log,
    });
  if (options.smoke) writePoolFile(poolPath, pools);
  if (pools.length === 0) throw new Error("no DLMM pools to record");
  store.upsertPools(pools);
  const tracked = new Set(pools.map((pool) => pool.address));
  const bucketFilter = parseWsBuckets(options.wsBuckets);
  if (bucketFilter.unknown.length > 0) {
    log(`websocket ignored unknown buckets: ${bucketFilter.unknown.join(", ")} (known: ${WS_BUCKETS.join(", ")})`);
  }
  const wsPools = options.wsMode === "program" ? pools : poolsForWebsocket(pools, bucketFilter);
  const droppedWs = new Set<string>();
  log(`tracking ${pools.length} pools`);
  if (bucketFilter.buckets) {
    log(`websocket buckets=${[...bucketFilter.buckets].join(",")} streaming=${wsPools.length}; snapshots stay on all ${pools.length} pools`);
  }
  if (options.wsDropNoisiest > 0 && options.wsMode === "program") {
    log("--ws-drop-noisiest applies to per-pool subscriptions; program mode is one subscription");
  } else if (options.wsDropNoisiest > 0) {
    log(`websocket drops the ${options.wsDropNoisiest} noisiest pools at each UTC hour; snapshots stay on all ${pools.length} pools`);
  }
  const meter = new CreditMeter(store, options.dailyCap, log);
  const limiter = limiterForRps(options.rps);
  const connection = meteredConnection(endpoint.http, limiter, meter, options.secret);
  let sessionSwaps = 0;
  let sessionLiquidity = 0;
  let dropped = 0;
  let lastSlot: number | null = null;
  let stopping = false;
  const queue: Array<{ signature: string; slot: number; attempts: number }> = [];
  const queued = new Set<string>();
  const RPC_PER_SNAPSHOT = 2;

  const swapRoom = () => {
    const reserved = reservedSnapshotCredits({
      pools: pools.length,
      snapshotMinutes: options.snapshotMinutes,
      rpcPerSnapshot: RPC_PER_SNAPSHOT,
      nowMs: Date.now(),
    });
    return meter.usedToday() + reserved < options.dailyCap;
  };

  const persist = (events: DecodedEvent[], signature: string, slot: number, blockTime: number | null) => {
    const receivedAt = blockTime ? blockTime * 1000 : Date.now();
    for (const event of events) {
      if (event.kind === "swap") {
        if (store.insertSwap(swapRow(event, signature, slot, receivedAt, blockTime))) sessionSwaps += 1;
      } else if (store.insertLiquidity(liquidityRow(event, signature, slot, receivedAt, blockTime))) sessionLiquidity += 1;
    }
  };

  const ingest = (logs: string[], signature: string, slot: number) => {
    if (slot > 0) lastSlot = slot;
    const fromLogs = selectTracked(decodeDlmmEvents(logs), tracked);
    if (fromLogs.length > 0) {
      persist(fromLogs, signature, slot, null);
      return;
    }
    if (!swapRoom() || queued.has(signature)) return;
    if (queue.length >= 400) {
      dropped += 1;
      return;
    }
    queued.add(signature);
    queue.push({ signature, slot, attempts: 0 });
  };

  if (!options.smoke) {
    await backfillPools({
      connection,
      pools,
      store,
      tracked,
      perPool: options.backfillPerPool,
      maxAgeMs: options.backfillMaxAgeMs,
      allow: () => meter.allow(),
      log,
    });
  }

  const subscriber = new LogSubscriber({
    url: endpoint.ws,
    mode: options.wsMode,
    addresses: wsPools.map((pool) => pool.address),
    programId: DLMM_PROGRAM_ID,
    meter,
    secret: options.secret,
    log,
    shouldStream: () => swapRoom(),
    onLogs: ingest,
  });
  const pidPath = resolve(options.dir, "recorder.pid");
  writeFileSync(pidPath, `${process.pid}\n`);
  let closed = false;
  const shutdown = () => {
    if (closed) return;
    closed = true;
    stopping = true;
    log("stopping");
    subscriber.stop();
    meter.flush();
    store.close();
    try {
      unlinkSync(pidPath);
    } catch {
      /* already removed */
    }
  };
  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });

  let drainDone: () => void = () => undefined;
  const drained = new Promise<void>((resolve) => {
    drainDone = resolve;
  });
  const drain = (async () => {
    try {
      while (!stopping) {
        const job = queue.shift();
        if (!job) {
          await sleep(200);
          continue;
        }
        queued.delete(job.signature);
        if (!swapRoom()) {
          dropped += 1;
          continue;
        }
        try {
          const tx = await connection.getTransaction(job.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 1,
          });
          const events = selectTracked(eventsFromTransaction(tx as never), tracked);
          persist(events, job.signature, job.slot, tx?.blockTime ?? null);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("429") && job.attempts < 3 && queue.length < 400) {
            queue.unshift({ ...job, attempts: job.attempts + 1 });
            queued.add(job.signature);
            log("rpc 429, backing off 2s");
            await sleep(2_000);
            continue;
          }
          log(`tx ${job.signature.slice(0, 12)} failed: ${message.split("\n")[0]?.slice(0, 180) ?? "error"}`);
        }
      }
    } finally {
      drainDone();
    }
  })();
  void drain;

  const nameOf = (address: string) => pools.find((pool) => pool.address === address)?.name ?? address;
  let rankedHour = hourStartMs(Date.now());
  const onHour = () => {
    const hour = hourStartMs(Date.now());
    if (hour === rankedHour) return;
    rankedHour = hour;
    if (options.wsDropNoisiest <= 0 || options.wsMode !== "mentions") {
      subscriber.resetHourBytes();
      return;
    }
    const loud = subscriber.noisiest(options.wsDropNoisiest);
    if (loud.length === 0) {
      subscriber.resetHourBytes();
      return;
    }
    for (const item of loud) droppedWs.add(item.address);
    const keep = wsPools.filter((pool) => !droppedWs.has(pool.address)).map((pool) => pool.address);
    subscriber.setAddresses(keep);
    subscriber.resetHourBytes();
    subscriber.resubscribe();
    const listed = loud.map((item) => `${nameOf(item.address)} ${item.bytes}B`).join(", ");
    log(`websocket dropped noisiest ${listed}; streaming ${keep.length} of ${pools.length}`);
  };

  subscriber.start();
  const cache = new Map<string, SnapshotClient>();
  await snapshotRound(pools, connection, store, cache, options, meter, () => lastSlot, () => stopping, log);
  log(meter.snapshotLine());

  if (options.smoke) {
    log(`smoke listening for ${options.smokeSeconds}s`);
    const deadline = Date.now() + options.smokeSeconds * 1000;
    while (Date.now() < deadline && !stopping) {
      await sleep(5_000);
      meter.roll(Date.now());
      onHour();
    }
    stopping = true;
    await drained;
    const counts = store.counts();
    log(`smoke done swaps=${counts.swaps} liquidity=${counts.liquidity} snapshots=${counts.snapshots} session_swaps=${sessionSwaps} session_liquidity=${sessionLiquidity} dropped=${dropped} ${meter.snapshotLine()}`);
    shutdown();
    return counts;
  }

  log(`snapshot every ${options.snapshotMinutes} minutes. pid ${process.pid}`);
  let nextHeartbeat = Date.now() + 5 * 60_000;
  while (!stopping) {
    const slice = Math.min(15_000, options.snapshotMinutes * 60_000);
    await sleep(slice);
    if (stopping) break;
    meter.roll(Date.now());
    onHour();
    if (Date.now() >= nextHeartbeat) {
      const counts = store.counts();
      const now = Date.now();
      const month = store.creditsSince(monthStart(now));
      log(`heartbeat swaps=${counts.swaps} liquidity=${counts.liquidity} snapshots=${counts.snapshots} queue=${queue.length} dropped=${dropped} ${meter.snapshotLine()} projected_month=${projectedMonthCredits(month, now).toFixed(0)} projected_from_hour=${projectedFromHourCredits(meter.openHourTotal()).toFixed(0)}`);
      nextHeartbeat = Date.now() + 5 * 60_000;
    }
    if (due(store, options.snapshotMinutes)) {
      await snapshotRound(pools, connection, store, cache, options, meter, () => lastSlot, () => stopping, log);
    }
  }
  return store.counts();
}

async function snapshotRound(
  pools: TrackedPool[],
  connection: ReturnType<typeof meteredConnection>,
  store: ReturnType<typeof openStore>,
  cache: Map<string, SnapshotClient>,
  options: RecordOptions,
  meter: CreditMeter,
  slot: () => number | null,
  stopping: () => boolean,
  log: (line: string) => void,
): Promise<void> {
  if (!meter.allow()) {
    log("snapshot skipped: daily credit cap reached");
    return;
  }
  for (const pool of pools) {
    if (stopping() || !meter.allow()) break;
    try {
      await snapshotPool({
        connection,
        pool,
        binsEachSide: options.binsEachSide,
        store,
        cache,
        slot: slot(),
        nowMs: Date.now(),
        log,
      });
    } catch (error) {
      log(`snapshot ${pool.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  meter.flush();
  store.setMeta("last_snapshot_at", String(Date.now()));
}

function due(store: ReturnType<typeof openStore>, minutes: number): boolean {
  const last = Number(store.getMeta("last_snapshot_at") ?? "0");
  return Date.now() - last >= minutes * 60_000;
}

function monthStart(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function resolveEndpoint(secret: string | undefined, rpcUrl: string): { http: string; ws: string; helius: boolean } {
  if (secret) {
    const query = `api-key=${encodeURIComponent(secret)}`;
    return {
      http: `https://mainnet.helius-rpc.com/?${query}`,
      ws: `wss://mainnet.helius-rpc.com/?${query}`,
      helius: true,
    };
  }
  const http = rpcUrl || "https://api.mainnet-beta.solana.com";
  const ws = http.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  return { http, ws, helius: false };
}

export function defaultRecordOptions(overrides: Partial<RecordOptions> = {}): RecordOptions {
  return {
    dir: resolve(process.cwd(), "data/recorder"),
    refreshPools: false,
    smoke: false,
    smokeSeconds: 360,
    smokePools: 2,
    poolLimit: 160,
    rps: DEFAULT_RPC_RPS,
    snapshotMinutes: 15,
    binsEachSide: 80,
    dailyCap: DEFAULT_DAILY_CREDIT_CAP,
    wsMode: "mentions",
    wsBuckets: undefined,
    wsDropNoisiest: 0,
    backfillPerPool: 15,
    backfillMaxAgeMs: 6 * 60 * 60 * 1000,
    secret: process.env.HELIUS_API_KEY?.trim() || undefined,
    rpcUrl: process.env.RPC_URL?.trim() || "https://api.mainnet-beta.solana.com",
    ...overrides,
  };
}

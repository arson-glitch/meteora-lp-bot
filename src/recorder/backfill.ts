import { PublicKey } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import { decodeDlmmEvents, selectTracked, type DecodedEvent } from "./decode.js";
import { liquidityRow, swapRow, type RecorderStore } from "./store.js";
import type { TrackedPool } from "./pools.js";
import { eventsFromTransaction } from "./txEvents.js";

/**
 * After a restart, pull a short signature window so a disconnect does not
 * leave a silent hole. Capped so a long outage cannot spend the day's credits
 * on getTransaction. Live logsSubscribe does not replay missed slots by itself.
 */
export async function backfillPools(params: {
  connection: Connection;
  pools: TrackedPool[];
  store: RecorderStore;
  tracked: Set<string>;
  perPool: number;
  maxAgeMs: number;
  allow: () => boolean;
  log: (line: string) => void;
}): Promise<number> {
  const last = params.store.lastReceivedAt();
  if (last <= 0) {
    params.log("backfill skipped: no prior events");
    return 0;
  }
  const age = Date.now() - last;
  if (age > params.maxAgeMs) {
    params.log(`backfill skipped: last event is ${Math.round(age / 60_000)} minutes old`);
    return 0;
  }
  let inserted = 0;
  for (const pool of params.pools) {
    if (!params.allow()) {
      params.log("backfill stopped: daily credit cap reached");
      break;
    }
    try {
      const signatures = await params.connection.getSignaturesForAddress(new PublicKey(pool.address), { limit: params.perPool });
      for (const entry of signatures) {
        if (!params.allow()) break;
        if (entry.err || params.store.knownSignature(entry.signature)) continue;
        if (entry.blockTime && entry.blockTime * 1000 < last - 60_000) continue;
        const tx = await params.connection.getTransaction(entry.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 1,
        });
        const logs = tx?.meta?.logMessages ?? [];
        let events: DecodedEvent[] = selectTracked(decodeDlmmEvents(logs), params.tracked);
        if (events.length === 0 && tx) {
          events = selectTracked(eventsFromTransaction(tx as never), params.tracked);
        }
        if (events.length === 0) continue;
        const blockTime = entry.blockTime ?? null;
        const receivedAt = (blockTime ?? Math.floor(Date.now() / 1000)) * 1000;
        for (const event of events) {
          if (event.kind === "swap") {
            if (params.store.insertSwap(swapRow(event, entry.signature, entry.slot, receivedAt, blockTime))) inserted += 1;
          } else if (params.store.insertLiquidity(liquidityRow(event, entry.signature, entry.slot, receivedAt, blockTime))) {
            inserted += 1;
          }
        }
      }
    } catch (error) {
      params.log(`backfill ${pool.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  params.log(`backfill inserted ${inserted}`);
  return inserted;
}

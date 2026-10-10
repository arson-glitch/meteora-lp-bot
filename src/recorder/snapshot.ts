import { PublicKey } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import { loadDlmmSdk } from "../sdk.js";
import type { TrackedPool } from "./pools.js";
import type { RecorderStore } from "./store.js";

interface BinLike {
  binId: number;
  xAmount: { toString(): string };
  yAmount: { toString(): string };
}

export interface SnapshotClient {
  refetchStates: () => Promise<void>;
  getBinsAroundActiveBin: (left: number, right: number) => Promise<{ activeBin: number; bins: BinLike[] }>;
}

/**
 * Read-only. DLMM.create plus getBinsAroundActiveBin never builds a transaction.
 * The client is cached so a later pass is refetchStates (one getMultipleAccounts)
 * plus the bin-array fetch (one getMultipleAccounts).
 */
export async function snapshotPool(params: {
  connection: Connection;
  pool: TrackedPool;
  binsEachSide: number;
  store: RecorderStore;
  cache: Map<string, SnapshotClient>;
  slot: number | null;
  nowMs: number;
  log: (line: string) => void;
}): Promise<number> {
  const client = await clientFor(params.connection, params.pool.address, params.cache);
  try {
    await client.refetchStates();
  } catch {
    /* DLMM.create already loaded the pair. A later pass still tries to refresh. */
  }
  const { activeBin, bins } = await client.getBinsAroundActiveBin(params.binsEachSide, params.binsEachSide);
  const packed = packBins(bins);
  params.store.insertSnapshot(params.pool.address, params.nowMs, params.slot, activeBin, params.pool.binStep, packed);
  const count = JSON.parse(packed) as unknown[];
  params.log(`snapshot ${params.pool.name} active=${activeBin} nonzero_bins=${count.length}`);
  return count.length;
}

export function packBins(bins: BinLike[]): string {
  const rows: Array<[number, string, string]> = [];
  for (const bin of bins) {
    const x = bin.xAmount.toString();
    const y = bin.yAmount.toString();
    if (x === "0" && y === "0") continue;
    rows.push([bin.binId, x, y]);
  }
  return JSON.stringify(rows);
}

async function clientFor(connection: Connection, address: string, cache: Map<string, SnapshotClient>): Promise<SnapshotClient> {
  const cached = cache.get(address);
  if (cached) return cached;
  const sdk = loadDlmmSdk();
  const created = await sdk.create(connection, new PublicKey(address), { cluster: "mainnet-beta" });
  const client = created as unknown as SnapshotClient;
  cache.set(address, client);
  return client;
}

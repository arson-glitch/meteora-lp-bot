import type { CoinType } from "../types.js";
import type { TrackedPool } from "./pools.js";

export const WS_BUCKETS: readonly CoinType[] = [
  "stable",
  "bluechip",
  "fresh-memecoin",
  "high-vol-trending",
  "established-midcap",
  "older-memecoin",
];

const KNOWN = new Set<string>(WS_BUCKETS);

export interface WsBucketFilter {
  /** Null means every tracked pool. An empty set means the flag named nothing known. */
  buckets: Set<CoinType> | null;
  unknown: string[];
}

/** `undefined`, `""`, and `all` subscribe to every pool. Unknown names are returned, not treated as all. */
export function parseWsBuckets(raw: string | undefined): WsBucketFilter {
  if (raw === undefined || raw.trim() === "" || raw.trim().toLowerCase() === "all") {
    return { buckets: null, unknown: [] };
  }
  const buckets = new Set<CoinType>();
  const unknown: string[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (!name) continue;
    if (KNOWN.has(name)) buckets.add(name as CoinType);
    else unknown.push(name);
  }
  return { buckets, unknown };
}

export function poolsForWebsocket(pools: TrackedPool[], filter: WsBucketFilter): TrackedPool[] {
  if (!filter.buckets) return pools;
  return pools.filter((pool) => pool.coinType !== "unclassified" && filter.buckets?.has(pool.coinType) === true);
}

/** Loudest pools this hour. Zero-byte pools are left subscribed. Ties break by address. */
export function noisiestAddresses(
  bytesByAddress: Iterable<[string, number]>,
  n: number,
): Array<{ address: string; bytes: number }> {
  if (n <= 0) return [];
  return [...bytesByAddress]
    .filter(([, bytes]) => bytes > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, n)
    .map(([address, bytes]) => ({ address, bytes }));
}

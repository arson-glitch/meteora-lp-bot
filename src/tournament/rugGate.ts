import { sleep } from "../http.js";
import { evaluatePoolRisk, type RugCheckOptions } from "../rugcheck/checker.js";
import type { DiscoveredPool } from "../types.js";

export interface RugHit {
  name: string;
  address: string;
  coinType: string;
  ok: boolean;
  reasons: string[];
  remote: boolean;
}

/**
 * Walk pools in order. Remote RugCheck calls are spaced about a second apart.
 * A pool that fails is recorded and skipped. This does not send transactions.
 */
export async function rugGatePools(params: {
  pools: DiscoveredPool[];
  coinType: string;
  options: RugCheckOptions;
  accept?: number;
}): Promise<{ passed: DiscoveredPool[]; hits: RugHit[] }> {
  const passed: DiscoveredPool[] = [];
  const hits: RugHit[] = [];
  const accept = params.accept ?? Number.POSITIVE_INFINITY;
  for (const pool of params.pools) {
    if (passed.length >= accept) break;
    const verdict = await evaluatePoolRisk(pool, params.options);
    if (verdict.fetchedRemote) await sleep(1_100);
    hits.push({
      name: pool.name,
      address: pool.address,
      coinType: params.coinType,
      ok: verdict.ok,
      reasons: verdict.reasons,
      remote: verdict.fetchedRemote,
    });
    if (verdict.ok) passed.push(pool);
  }
  return { passed, hits };
}

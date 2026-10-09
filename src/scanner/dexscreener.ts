import { DEXSCREENER_API_BASE } from "../constants.js";
import { getJson } from "../http.js";
import type { MarketContext } from "../types.js";

export interface DexPair {
  dexId?: string;
  pairAddress?: string;
  priceChange?: { h1?: number; h24?: number };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  baseToken?: { address?: string };
  quoteToken?: { address?: string };
}

export function pickDexPair(pairs: DexPair[], tokenMint: string, otherMint?: string): DexPair | null {
  const related = pairs.filter((pair) => {
    const mints = [pair.baseToken?.address, pair.quoteToken?.address];
    return mints.includes(tokenMint);
  });
  if (related.length === 0) return null;
  const ranked = [...related].sort((a, b) => pairRank(b, tokenMint, otherMint) - pairRank(a, tokenMint, otherMint));
  return ranked[0] ?? null;
}

function pairRank(pair: DexPair, tokenMint: string, otherMint?: string): number {
  const mints = [pair.baseToken?.address, pair.quoteToken?.address];
  const both = otherMint && mints.includes(tokenMint) && mints.includes(otherMint) ? 1_000_000 : 0;
  const meteora = (pair.dexId ?? "").toLowerCase().includes("meteora") ? 1_000 : 0;
  return both + meteora + (pair.liquidity?.usd ?? 0);
}

export function marketFromPair(pair: DexPair | null): MarketContext {
  if (!pair) {
    return {
      source: "none",
      dexId: null,
      pairAddress: null,
      priceChangeH1Pct: null,
      priceChangeH24Pct: null,
      volumeH24Usd: null,
      liquidityUsd: null,
    };
  }
  return {
    source: "dexscreener",
    dexId: pair.dexId ?? null,
    pairAddress: pair.pairAddress ?? null,
    priceChangeH1Pct: finite(pair.priceChange?.h1),
    priceChangeH24Pct: finite(pair.priceChange?.h24),
    volumeH24Usd: finite(pair.volume?.h24),
    liquidityUsd: finite(pair.liquidity?.usd),
  };
}

function finite(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function fetchTokenPairs(mint: string): Promise<DexPair[]> {
  const url = `${DEXSCREENER_API_BASE}/token-pairs/v1/solana/${mint}`;
  const body = await getJson<DexPair[] | { pairs?: DexPair[] }>(url);
  if (Array.isArray(body)) return body;
  return body.pairs ?? [];
}

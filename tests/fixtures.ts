import type { DiscoveredPool, MarketContext, PoolToken } from "../src/types.js";

export const SOL = "So11111111111111111111111111111111111111112";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const EMPTY_MARKET: MarketContext = {
  source: "none",
  dexId: null,
  pairAddress: null,
  priceChangeH1Pct: null,
  priceChangeH24Pct: null,
  volumeH24Usd: null,
  liquidityUsd: null,
};

export function token(
  symbol: string,
  address: string,
  priceUsd: number,
  extra: Partial<PoolToken> = {},
): PoolToken {
  return {
    address,
    symbol,
    name: symbol,
    decimals: symbol === "SOL" ? 9 : 6,
    priceUsd,
    holders: 1_000,
    freezeAuthorityDisabled: true,
    isVerified: true,
    marketCapUsd: priceUsd * 1_000_000,
    ...extra,
  };
}

export function pool(over: Partial<DiscoveredPool> & Pick<DiscoveredPool, "name">): DiscoveredPool {
  return {
    product: "dlmm",
    address: over.address ?? `pool-${over.name}`,
    name: over.name,
    tokenX: over.tokenX ?? token("SOL", SOL, 100),
    tokenY: over.tokenY ?? token("USDC", USDC, 1),
    tvlUsd: over.tvlUsd ?? 100_000,
    currentPrice: over.currentPrice ?? 100,
    binStep: over.binStep === undefined ? 10 : over.binStep,
    baseFeePct: over.baseFeePct ?? 0.2,
    dynamicFeePct: over.dynamicFeePct ?? 0,
    protocolFeePct: over.protocolFeePct ?? 10,
    collectFeeMode: over.collectFeeMode === undefined ? 0 : over.collectFeeMode,
    createdAtMs: over.createdAtMs ?? Date.UTC(2026, 0, 1),
    volume: over.volume ?? { "24h": 50_000, "1h": 2_000 },
    fees: over.fees ?? { "24h": 400, "1h": 20 },
    protocolFees: over.protocolFees ?? { "24h": 44, "1h": 2 },
    feeTvlRatio: over.feeTvlRatio ?? { "24h": 0.4 },
    isBlacklisted: over.isBlacklisted ?? false,
    launchpad: over.launchpad ?? "",
    tags: over.tags ?? [],
    listSource: over.listSource ?? "volume",
    market: over.market ?? { ...EMPTY_MARKET },
    score: over.score,
    scoreBreakdown: over.scoreBreakdown,
  };
}

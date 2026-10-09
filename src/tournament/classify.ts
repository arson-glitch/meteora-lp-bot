import { absPriceChangeH24Pct, ageHours, isQuoteToken, isStablePair, isStableSymbol } from "../markets.js";
import type { CoinType, DiscoveredPool, PoolToken } from "../types.js";

/**
 * Coin types are exclusive. The first matching rule wins.
 *
 * | Bucket | Rule |
 * | --- | --- |
 * | stable | Both symbols are stables (USDC, USDT, USD1, PYUSD, USDS, UXD, USDH, EURC, FDUSD, USDe, USDG). |
 * | bluechip | Paired with a quote asset, and the other leg is a named major at any age, or has market cap ≥ $1B after the pool is 72h old. |
 * | fresh-memecoin | Pool age under 24h. Named majors are already bluechip, so a new SOL pool is not a fresh memecoin. |
 * | high-vol-trending | Age at least 24h, and either the absolute 24h price change is ≥ 25% or 24h volume / TVL is ≥ 8. |
 * | established-midcap | Asset market cap ≥ $20M and < $1B, pool age ≥ 7 days, and holder count ≥ 2,000 when the API reports holders. |
 * | older-memecoin | Everything else. |
 *
 * Fresh wins over high-vol, so a coin younger than a day stays in the fresh bucket even if it is already moving. High-vol wins over mid-cap, so a large daily move is not treated as a calm mid-cap. Bin step is not a feature: it is chosen by the pool creator.
 */

export const BLUECHIP_MIN_AGE_HOURS = 72;
export const BLUECHIP_MIN_MARKET_CAP_USD = 1_000_000_000;
export const FRESH_MAX_AGE_HOURS = 24;
export const HIGH_VOL_MIN_ABS_CHANGE_PCT = 25;
export const HIGH_VOL_MIN_TURNOVER = 8;
export const MIDCAP_MIN_MARKET_CAP_USD = 20_000_000;
export const MIDCAP_MIN_AGE_HOURS = 24 * 7;
export const MIDCAP_MIN_HOLDERS = 2_000;

/** Symbols treated as majors or liquid staking wrappers, not memecoins. */
export const MAJOR_SYMBOLS = new Set([
  "SOL",
  "WSOL",
  "BTC",
  "WBTC",
  "CBBTC",
  "TBTC",
  "ETH",
  "WETH",
  "JUP",
  "JITOSOL",
  "MSOL",
  "BSOL",
  "JUPSOL",
  "INF",
]);

export const COIN_TYPES: CoinType[] = [
  "stable",
  "bluechip",
  "fresh-memecoin",
  "high-vol-trending",
  "established-midcap",
  "older-memecoin",
];

export interface CoinFeatures {
  ageHours: number;
  marketCapUsd: number | null;
  holders: number | null;
  tvlUsd: number;
  volume24hUsd: number;
  turnover24h: number | null;
  absPriceChangeH24Pct: number | null;
  major: boolean;
  pairedWithQuote: boolean;
}

export interface Classification {
  type: CoinType;
  reasons: string[];
  features: CoinFeatures;
}

export function classifyPool(pool: DiscoveredPool, nowMs: number): Classification {
  const asset = assetToken(pool);
  const age = ageHours(pool.createdAtMs, nowMs);
  const volume = pool.volume["24h"] ?? 0;
  const turnover = pool.tvlUsd > 0 ? volume / pool.tvlUsd : null;
  const change = absPriceChangeH24Pct(pool);
  const features: CoinFeatures = {
    ageHours: age,
    marketCapUsd: asset.marketCapUsd,
    holders: asset.holders,
    tvlUsd: pool.tvlUsd,
    volume24hUsd: volume,
    turnover24h: turnover,
    absPriceChangeH24Pct: change,
    major: isMajor(asset),
    pairedWithQuote: isQuoteToken(pool.tokenX) || isQuoteToken(pool.tokenY),
  };

  if (isStablePair(pool)) {
    return { type: "stable", reasons: ["both symbols are stablecoins"], features };
  }

  if (features.pairedWithQuote && features.major) {
    return {
      type: "bluechip",
      reasons: [`${asset.symbol} is a named major or liquid staking asset, paired with a quote`],
      features,
    };
  }
  if (
    features.pairedWithQuote &&
    features.marketCapUsd !== null &&
    features.marketCapUsd >= BLUECHIP_MIN_MARKET_CAP_USD &&
    age >= BLUECHIP_MIN_AGE_HOURS
  ) {
    return {
      type: "bluechip",
      reasons: [`market cap $${Math.round(features.marketCapUsd)} ≥ $1B and pool age ≥ 72h`],
      features,
    };
  }

  if (age < FRESH_MAX_AGE_HOURS) {
    return {
      type: "fresh-memecoin",
      reasons: [`pool age ${age.toFixed(1)}h is under 24h`],
      features,
    };
  }

  const hotMove = change !== null && change >= HIGH_VOL_MIN_ABS_CHANGE_PCT;
  const hotTurnover = turnover !== null && turnover >= HIGH_VOL_MIN_TURNOVER;
  if (hotMove || hotTurnover) {
    const reasons: string[] = [];
    if (hotMove) reasons.push(`abs 24h move ${change?.toFixed(1)}% ≥ 25%`);
    if (hotTurnover) reasons.push(`24h volume/TVL ${turnover?.toFixed(2)} ≥ 8`);
    return { type: "high-vol-trending", reasons, features };
  }

  const mcap = features.marketCapUsd;
  const holdersOk = features.holders === null || features.holders >= MIDCAP_MIN_HOLDERS;
  if (
    mcap !== null &&
    mcap >= MIDCAP_MIN_MARKET_CAP_USD &&
    mcap < BLUECHIP_MIN_MARKET_CAP_USD &&
    age >= MIDCAP_MIN_AGE_HOURS &&
    holdersOk
  ) {
    return {
      type: "established-midcap",
      reasons: [
        `market cap $${Math.round(mcap)} is between $20M and $1B`,
        `pool age ≥ 7d`,
        features.holders === null ? "holder count unknown, not used as a fail" : `holders ${features.holders} ≥ 2000`,
      ],
      features,
    };
  }

  return {
    type: "older-memecoin",
    reasons: ["no earlier bucket matched"],
    features,
  };
}

/**
 * One trial per market. Stable pairs collapse both directions (USDC-USDT and
 * USDT-USDC). Every other bucket collapses to the non-quote mint, so three
 * SOL-USDC bin steps are one SOL sample.
 */
export function sampleKey(pool: DiscoveredPool): string {
  if (isStablePair(pool)) {
    return [pool.tokenX.address, pool.tokenY.address].sort().join(":");
  }
  const asset = assetToken(pool);
  return asset.address || pool.address;
}

function assetToken(pool: DiscoveredPool): PoolToken {
  const xQuote = isQuoteToken(pool.tokenX);
  const yQuote = isQuoteToken(pool.tokenY);
  if (xQuote && !yQuote) return pool.tokenY;
  if (yQuote && !xQuote) return pool.tokenX;
  const xStable = isStableSymbol(pool.tokenX.symbol);
  const yStable = isStableSymbol(pool.tokenY.symbol);
  if (xStable && !yStable) return pool.tokenY;
  if (yStable && !xStable) return pool.tokenX;
  return pool.tokenX;
}

function isMajor(token: PoolToken): boolean {
  return MAJOR_SYMBOLS.has(token.symbol.toUpperCase());
}

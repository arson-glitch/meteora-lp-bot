import type { DiscoveredPool, PoolToken } from "./types.js";

/**
 * Quote assets are not rug-checked as the risk mint.
 * USDC's freeze authority is enabled at the mint; that must not fail SOL-USDC.
 * https://docs.meteora.ag/user-guides/staying-safe-on-meteora
 */
const QUOTE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
  "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
]);

const QUOTE_SYMBOLS = new Set(["SOL", "WSOL", "USDC", "USDT", "USD1", "PYUSD", "USDS"]);
const STABLE_SYMBOLS = new Set(["USDC", "USDT", "USD1", "PYUSD", "USDS", "UXD", "USDH", "EURC", "FDUSD"]);

export function isQuoteToken(token: Pick<PoolToken, "address" | "symbol">): boolean {
  if (QUOTE_MINTS.has(token.address)) return true;
  return QUOTE_SYMBOLS.has(token.symbol.toUpperCase());
}

export function isStableSymbol(symbol: string): boolean {
  return STABLE_SYMBOLS.has(symbol.toUpperCase());
}

export function isStablePair(pool: DiscoveredPool): boolean {
  return isStableSymbol(pool.tokenX.symbol) && isStableSymbol(pool.tokenY.symbol);
}

export function riskTokens(pool: DiscoveredPool): PoolToken[] {
  return [pool.tokenX, pool.tokenY].filter((token) => !isQuoteToken(token));
}

export function ageHours(createdAtMs: number, nowMs: number): number {
  if (!createdAtMs) return Number.POSITIVE_INFINITY;
  return Math.max(0, (nowMs - createdAtMs) / 3_600_000);
}

export function absPriceChangeH24Pct(pool: DiscoveredPool): number | null {
  const value = pool.market.priceChangeH24Pct;
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.abs(value);
}

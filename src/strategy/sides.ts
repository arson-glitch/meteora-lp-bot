import { isQuoteToken } from "../markets.js";
import type { StrategyConfig } from "./schema.js";
import type { DiscoveredPool, QuoteSide, Sidedness } from "../types.js";

/**
 * DLMM prices are token Y per token X. The quote leg is Y when Y is a quote
 * asset, when both legs are quotes (SOL-USDC, USDC-USDT), or when neither is.
 * Otherwise the quote leg is the one side that is a quote mint.
 */
export function quoteIsY(pool: DiscoveredPool): boolean {
  const x = isQuoteToken(pool.tokenX);
  const y = isQuoteToken(pool.tokenY);
  if (y && !x) return true;
  if (x && !y) return false;
  return true;
}

export function layoutForStrategy(
  pool: DiscoveredPool,
  strategy: Pick<StrategyConfig, "sidedness" | "quoteSide" | "binsBelow" | "binsAbove">,
): { sidedness: Sidedness; binsBelow: number; binsAbove: number } {
  const side: QuoteSide | null | undefined = strategy.quoteSide;
  if (!side || side === "two-sided") {
    return {
      sidedness: side === "two-sided" ? "two-sided" : strategy.sidedness,
      binsBelow: strategy.binsBelow,
      binsAbove: strategy.binsAbove,
    };
  }
  const width = Math.max(strategy.binsBelow, strategy.binsAbove);
  const depositQuote = side === "quote";
  const depositY = depositQuote ? quoteIsY(pool) : !quoteIsY(pool);
  if (depositY) return { sidedness: "single-sided-y", binsBelow: width, binsAbove: 0 };
  return { sidedness: "single-sided-x", binsBelow: 0, binsAbove: width };
}

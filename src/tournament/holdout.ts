/**
 * Cross-coin holdout. Coins are split by sorted sample key, so the holdout
 * does not depend on who made money. Every pool of a held-out coin stays out
 * of the train window and out of the time-split test.
 */

export function splitCoinKeys(keys: string[]): { trainKeys: string[]; holdoutKeys: string[] } {
  const sorted = [...new Set(keys)].sort();
  const holdoutN = holdoutCount(sorted.length);
  return {
    trainKeys: sorted.slice(0, sorted.length - holdoutN),
    holdoutKeys: sorted.slice(sorted.length - holdoutN),
  };
}

export function holdoutCount(coinCount: number): number {
  if (coinCount <= 1) return 0;
  let count = Math.round(coinCount * 0.3);
  if (coinCount >= 15) count = Math.max(4, count);
  else if (coinCount >= 6) count = Math.max(2, count);
  else count = Math.max(1, count);
  count = Math.min(count, Math.floor(coinCount * 0.4));
  return Math.max(0, Math.min(count, coinCount - 1));
}

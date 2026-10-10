/**
 * Spot DLMM inventory only. Perps, borrowed leverage, margin, and
 * lending are rejected before a strategy can load. The LVR concentration
 * factor ("range leverage") is a formula term in the research math, not a
 * strategy, and it is not a borrowed position.
 */

const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bperps?\b/i, why: "perpetual futures" },
  { pattern: /perpetual/i, why: "perpetual futures" },
  { pattern: /\bleveraged?\b/i, why: "borrowed leverage" },
  { pattern: /\bmargin\b/i, why: "margin" },
  { pattern: /\bborrow(?:ing|ed)?\b/i, why: "borrowing" },
  { pattern: /\blending\b/i, why: "lending" },
  { pattern: /\bmoney[- ]market\b/i, why: "lending" },
  { pattern: /\bderivatives?\b/i, why: "derivatives" },
  { pattern: /\bfutures\b/i, why: "futures" },
  { pattern: /\boptions?\b/i, why: "options" },
  { pattern: /\bhedg(?:e|ing|ed)\b/i, why: "a hedge" },
  { pattern: /funding[- ]rate/i, why: "perp funding" },
];

export function borrowedRiskHit(text: string): string | null {
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(text)) return rule.why;
  }
  return null;
}

export function assertNoBorrowedRisk(text: string, filename: string): void {
  const why = borrowedRiskHit(text);
  if (why) {
    throw new Error(
      `${filename}: rejected because it describes ${why}. Strategies are spot DLMM only: no perps, no borrowed leverage, no margin, and no borrowing or lending.`,
    );
  }
}

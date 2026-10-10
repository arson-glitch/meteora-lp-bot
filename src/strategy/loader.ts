import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseStrategy, type StrategyConfig } from "./schema.js";

/**
 * Loads strategy JSON. `parseStrategy` rejects perps, borrowed leverage,
 * margin, and borrowing or lending. Spot DLMM inventory is the only product.
 */
export function loadStrategies(dir: string): StrategyConfig[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .sort();
  const strategies = files.map((name) => {
    const raw = JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown;
    return parseStrategy(raw, name);
  });
  assertUniqueIds(strategies);
  return strategies;
}

/**
 * Placeholders in `strategies/*.json` plus generated winners in
 * `strategies/winners/*.json`. Winners carry a coin type and a higher
 * priority so they beat placeholders only for that bucket.
 */
export function loadStrategyBundle(dir: string): StrategyConfig[] {
  const base = loadStrategies(dir);
  const winners = loadStrategies(join(dir, "winners"));
  const all = [...winners, ...base];
  assertUniqueIds(all);
  return all;
}

function assertUniqueIds(strategies: StrategyConfig[]): void {
  const ids = new Set<string>();
  for (const strategy of strategies) {
    if (ids.has(strategy.id)) throw new Error(`duplicate strategy id ${strategy.id}`);
    ids.add(strategy.id);
  }
}

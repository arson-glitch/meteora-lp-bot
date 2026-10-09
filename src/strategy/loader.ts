import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseStrategy, type StrategyConfig } from "./schema.js";

export function loadStrategies(dir: string): StrategyConfig[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .sort();
  const strategies = files.map((name) => {
    const raw = JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown;
    return parseStrategy(raw, name);
  });
  const ids = new Set<string>();
  for (const strategy of strategies) {
    if (ids.has(strategy.id)) throw new Error(`duplicate strategy id ${strategy.id}`);
    ids.add(strategy.id);
  }
  return strategies;
}

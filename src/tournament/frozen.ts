import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseStrategy, type StrategyConfig } from "../strategy/schema.js";

/** Economic parameters of the promoted high-vol cell, frozen on 2026-10-09. */
export const FROZEN_STRATEGY_VERSION = "2026-10-09";
export const FROZEN_STRATEGY_FILE = "strategies/frozen/high-vol-2026-10-09.json";

export interface FrozenStrategyFile {
  version: string;
  frozenAt: string;
  sourceStrategyId: string;
  parameterHash: string;
  costModelVersion: string;
  note: string;
  strategy: StrategyConfig;
}

/**
 * Hash of the shape, width, side, and exit. Id and notes are not included,
 * so a rename does not look like a parameter change.
 */
export function canonicalStrategyParameters(strategy: StrategyConfig): string {
  return JSON.stringify({
    binsAbove: strategy.binsAbove,
    binsBelow: strategy.binsBelow,
    coinType: strategy.coinType ?? null,
    exit: {
      maxHoldHours: strategy.exit.maxHoldHours,
      onOutOfRange: strategy.exit.onOutOfRange,
      outOfRangeTimeoutHours: strategy.exit.outOfRangeTimeoutHours ?? null,
      rebalanceEdgeBins: strategy.exit.rebalanceEdgeBins,
      stopLossPct: strategy.exit.stopLossPct,
      takeProfitPct: strategy.exit.takeProfitPct,
    },
    quoteSide: strategy.quoteSide ?? null,
    shape: strategy.shape,
    sidedness: strategy.sidedness,
  });
}

export function parameterHash(strategy: StrategyConfig): string {
  return createHash("sha256").update(canonicalStrategyParameters(strategy)).digest("hex");
}

export function loadFrozenStrategy(path: string): FrozenStrategyFile {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<FrozenStrategyFile> & { strategy?: unknown };
  if (!raw.strategy || typeof raw.parameterHash !== "string" || typeof raw.version !== "string") {
    throw new Error(`${path} is not a frozen strategy file`);
  }
  const strategy = parseStrategy(raw.strategy, path);
  const hash = parameterHash(strategy);
  if (hash !== raw.parameterHash) {
    throw new Error(`${path} parameter hash ${raw.parameterHash} does not match ${hash}`);
  }
  return {
    version: raw.version,
    frozenAt: typeof raw.frozenAt === "string" ? raw.frozenAt : "",
    sourceStrategyId: typeof raw.sourceStrategyId === "string" ? raw.sourceStrategyId : strategy.id,
    parameterHash: hash,
    costModelVersion: typeof raw.costModelVersion === "string" ? raw.costModelVersion : "",
    note: typeof raw.note === "string" ? raw.note : "",
    strategy,
  };
}

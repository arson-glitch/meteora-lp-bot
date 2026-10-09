import { MAX_BINS_PER_POSITION, MAX_BIN_STEP } from "../constants.js";
import type { Sidedness, StrategyShape } from "../types.js";

/**
 * Strategy files are data. Drop a new JSON file in /strategies and the loader
 * picks it up. Shipped files are placeholders derived from Meteora's public
 * strategy guide, not from a private course.
 * https://docs.meteora.ag/core-products/dlmm/strategies-and-use-cases
 */

export interface EntryClause {
  minBinStep?: number;
  maxBinStep?: number;
  minTvlUsd?: number;
  maxTvlUsd?: number;
  minVolume24hUsd?: number;
  maxAbsPriceChangeH24Pct?: number;
  minAbsPriceChangeH24Pct?: number;
  stablePairOnly?: boolean;
  excludeStablePair?: boolean;
  minAgeHours?: number;
  maxAgeHours?: number;
}

export interface StrategyConfig {
  id: string;
  name: string;
  description: string;
  placeholder: boolean;
  placeholderNote: string;
  docs: string[];
  notes: string;
  product: "dlmm";
  shape: StrategyShape;
  binsBelow: number;
  binsAbove: number;
  sidedness: Sidedness;
  priority: number;
  manualOnly: boolean;
  requires: EntryClause;
  when: EntryClause[];
  exit: {
    onOutOfRange: "close" | "rebalance";
    rebalanceEdgeBins: number;
    stopLossPct: number;
    takeProfitPct: number | null;
    maxHoldHours: number | null;
  };
}

const SHAPES = new Set(["Spot", "Curve", "BidAsk"]);
const SIDES = new Set(["two-sided", "single-sided-x", "single-sided-y"]);

export function parseStrategy(raw: unknown, filename: string): StrategyConfig {
  const row = asRecord(raw, filename);
  const id = requireString(row, "id", filename);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`${filename}: id must be lowercase kebab-case`);
  }
  const product = requireString(row, "product", filename);
  if (product !== "dlmm") throw new Error(`${filename}: only product "dlmm" can be executed`);
  const shape = requireString(row, "shape", filename);
  if (!SHAPES.has(shape)) throw new Error(`${filename}: shape must be Spot, Curve, or BidAsk`);
  const sidedness = requireString(row, "sidedness", filename);
  if (!SIDES.has(sidedness)) throw new Error(`${filename}: invalid sidedness`);
  const binsBelow = requireNumber(row, "binsBelow", filename);
  const binsAbove = requireNumber(row, "binsAbove", filename);
  if (binsBelow < 0 || binsAbove < 0) throw new Error(`${filename}: bin counts must be >= 0`);
  const binCount = binsBelow + binsAbove + 1;
  if (binCount > MAX_BINS_PER_POSITION) {
    throw new Error(`${filename}: ${binCount} bins exceeds the ${MAX_BINS_PER_POSITION} position cap`);
  }
  const docs = requireStringArray(row, "docs", filename);
  if (!docs.some((doc) => doc.startsWith("https://docs.meteora.ag/"))) {
    throw new Error(`${filename}: docs must cite at least one https://docs.meteora.ag/ page`);
  }
  const exit = asRecord(row.exit, `${filename} exit`);
  const onOutOfRange = requireString(exit, "onOutOfRange", filename);
  if (onOutOfRange !== "close" && onOutOfRange !== "rebalance") {
    throw new Error(`${filename}: onOutOfRange must be close or rebalance`);
  }
  const stopLossPct = requireNumber(exit, "stopLossPct", filename);
  if (stopLossPct <= 0 || stopLossPct >= 1) {
    throw new Error(`${filename}: stopLossPct must be a fraction between 0 and 1`);
  }
  const requires = parseClause(row.requires ?? {}, `${filename} requires`);
  if (requires.maxBinStep !== undefined && requires.maxBinStep > MAX_BIN_STEP) {
    throw new Error(`${filename}: maxBinStep cannot exceed ${MAX_BIN_STEP}`);
  }
  const whenRaw = row.when ?? [];
  if (!Array.isArray(whenRaw)) throw new Error(`${filename}: when must be an array`);
  return {
    id,
    name: requireString(row, "name", filename),
    description: optionalString(row, "description"),
    placeholder: requireBoolean(row, "placeholder", filename),
    placeholderNote: requireString(row, "placeholderNote", filename),
    docs,
    notes: optionalString(row, "notes"),
    product: "dlmm",
    shape: shape as StrategyShape,
    binsBelow,
    binsAbove,
    sidedness: sidedness as Sidedness,
    priority: requireNumber(row, "priority", filename),
    manualOnly: row.manualOnly === true,
    requires,
    when: whenRaw.map((clause, index) => parseClause(clause, `${filename} when[${index}]`)),
    exit: {
      onOutOfRange,
      rebalanceEdgeBins: optionalNumber(exit, "rebalanceEdgeBins") ?? 0,
      stopLossPct,
      takeProfitPct: exit.takeProfitPct === null || exit.takeProfitPct === undefined
        ? null
        : requireNumber(exit, "takeProfitPct", filename),
      maxHoldHours: exit.maxHoldHours === null || exit.maxHoldHours === undefined
        ? null
        : requireNumber(exit, "maxHoldHours", filename),
    },
  };
}

function parseClause(raw: unknown, label: string): EntryClause {
  const row = asRecord(raw, label);
  return {
    minBinStep: optionalNumber(row, "minBinStep"),
    maxBinStep: optionalNumber(row, "maxBinStep"),
    minTvlUsd: optionalNumber(row, "minTvlUsd"),
    maxTvlUsd: optionalNumber(row, "maxTvlUsd"),
    minVolume24hUsd: optionalNumber(row, "minVolume24hUsd"),
    maxAbsPriceChangeH24Pct: optionalNumber(row, "maxAbsPriceChangeH24Pct"),
    minAbsPriceChangeH24Pct: optionalNumber(row, "minAbsPriceChangeH24Pct"),
    stablePairOnly: row.stablePairOnly === true ? true : undefined,
    excludeStablePair: row.excludeStablePair === true ? true : undefined,
    minAgeHours: optionalNumber(row, "minAgeHours"),
    maxAgeHours: optionalNumber(row, "maxAgeHours"),
  };
}

function asRecord(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}: expected an object`);
  }
  return raw as Record<string, unknown>;
}

function requireString(row: Record<string, unknown>, key: string, filename: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${filename}: ${key} is required`);
  }
  return value.trim();
}

function optionalString(row: Record<string, unknown>, key: string): string {
  return typeof row[key] === "string" ? row[key] : "";
}

function requireNumber(row: Record<string, unknown>, key: string, filename: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${filename}: ${key} must be a number`);
  }
  return value;
}

function optionalNumber(row: Record<string, unknown>, key: string): number | undefined {
  if (row[key] === undefined || row[key] === null) return undefined;
  if (typeof row[key] !== "number" || !Number.isFinite(row[key] as number)) {
    throw new Error(`${key} must be a number`);
  }
  return row[key] as number;
}

function requireBoolean(row: Record<string, unknown>, key: string, filename: string): boolean {
  if (typeof row[key] !== "boolean") throw new Error(`${filename}: ${key} must be a boolean`);
  return row[key] as boolean;
}

function requireStringArray(row: Record<string, unknown>, key: string, filename: string): string[] {
  const value = row[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${filename}: ${key} must be an array of strings`);
  }
  return value;
}

import { MAX_BINS_PER_POSITION, MAX_BIN_STEP } from "../constants.js";
import type { CoinType, QuoteSide, Sidedness, StrategyShape } from "../types.js";
import { assertNoBorrowedRisk } from "./constraints.js";

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
  /**
   * When set, the executor remaps bins onto the pool's quote or base token.
   * Hand-written files leave this empty and use `sidedness` as-is.
   */
  quoteSide?: QuoteSide | null;
  /** When set, the strategy matches only pools in this bucket. */
  coinType?: CoinType | null;
  priority: number;
  manualOnly: boolean;
  /**
   * When true, the open and any recenter are clipped to the active bin's
   * array so the position does not pay for a second bin array.
   */
  stayInBinArray?: boolean;
  requires: EntryClause;
  when: EntryClause[];
  exit: {
    onOutOfRange: "close" | "rebalance";
    rebalanceEdgeBins: number;
    stopLossPct: number;
    takeProfitPct: number | null;
    maxHoldHours: number | null;
    /**
     * While the position is younger than this, an out-of-range close is
     * delayed. Stop-loss and take-profit still fire. Null means no minimum.
     */
    minHoldHours?: number | null;
    /** Null or omitted closes as soon as the active bin leaves the range. */
    outOfRangeTimeoutHours?: number | null;
    /** Close when drawdown and a volume collapse happen together. */
    compositeExit?: boolean;
  };
}

const COIN_TYPES = new Set<CoinType>([
  "stable",
  "bluechip",
  "fresh-memecoin",
  "high-vol-trending",
  "established-midcap",
  "older-memecoin",
]);
const QUOTE_SIDES = new Set<QuoteSide>(["two-sided", "quote", "token"]);

const SHAPES = new Set(["Spot", "Curve", "BidAsk"]);
const SIDES = new Set(["two-sided", "single-sided-x", "single-sided-y"]);

export function parseStrategy(raw: unknown, filename: string): StrategyConfig {
  assertNoBorrowedRisk(JSON.stringify(raw ?? {}), filename);
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
  const outOfRangeTimeoutHours = optionalHours(exit, "outOfRangeTimeoutHours", filename);
  const coinType = optionalEnum(row, "coinType", COIN_TYPES, filename);
  const quoteSide = optionalEnum(row, "quoteSide", QUOTE_SIDES, filename);
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
    quoteSide,
    coinType,
    priority: requireNumber(row, "priority", filename),
    manualOnly: row.manualOnly === true,
    stayInBinArray: row.stayInBinArray === true,
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
      minHoldHours: exit.minHoldHours === null || exit.minHoldHours === undefined
        ? null
        : requireNumber(exit, "minHoldHours", filename),
      outOfRangeTimeoutHours,
      ...(exit.compositeExit === true ? { compositeExit: true } : {}),
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

function optionalHours(row: Record<string, unknown>, key: string, filename: string): number | null {
  if (row[key] === undefined || row[key] === null) return null;
  const value = requireNumber(row, key, filename);
  if (value < 0) throw new Error(`${filename}: ${key} must be >= 0`);
  return value;
}

function optionalEnum<T extends string>(
  row: Record<string, unknown>,
  key: string,
  allowed: Set<T>,
  filename: string,
): T | null {
  if (row[key] === undefined || row[key] === null) return null;
  const value = requireString(row, key, filename);
  if (!allowed.has(value as T)) {
    throw new Error(`${filename}: ${key} must be one of ${[...allowed].join(", ")}`);
  }
  return value as T;
}

function requireStringArray(row: Record<string, unknown>, key: string, filename: string): string[] {
  const value = row[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${filename}: ${key} must be an array of strings`);
  }
  return value;
}

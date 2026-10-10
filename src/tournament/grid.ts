import { DOCS } from "../constants.js";
import type { StrategyConfig } from "../strategy/schema.js";
import type { QuoteSide, StrategyShape } from "../types.js";

/**
 * Classic search: shape × width × side × exit = 108 cells.
 * Cost-aware cells add Spot and Curve at narrow and medium width, clipped to
 * one bin array, with slow out-of-range exits that do not rebalance.
 *
 * Bin step is not a cell. It is a pool parameter (1–400 bps) set by the pool
 * creator. Splitting winners by bin-step band would overfit this sample.
 * https://docs.meteora.ag/core-products/dlmm/formulas
 */

export type WidthName = "narrow" | "medium" | "wide" | "broad";
export type ExitName = "oor" | "timeout" | "rebalance" | "rebalance6" | "tp" | "patient" | "stay" | "guard";

export interface GridCell {
  id: string;
  shape: StrategyShape;
  width: WidthName;
  side: QuoteSide;
  exit: ExitName;
  binsBelow: number;
  binsAbove: number;
  onOutOfRange: "close" | "rebalance";
  outOfRangeTimeoutHours: number | null;
  stopLossPct: number;
  takeProfitPct: number | null;
  stayInBinArray: boolean;
  compositeExit: boolean;
}

const SHAPES: StrategyShape[] = ["Spot", "Curve", "BidAsk"];
const WIDTHS: WidthName[] = ["narrow", "medium", "wide"];
const SIDES: QuoteSide[] = ["two-sided", "quote", "token"];
const EXITS: ExitName[] = ["oor", "timeout", "rebalance", "tp"];

const TWO_SIDED_BINS: Record<WidthName, [number, number]> = {
  narrow: [2, 2],
  medium: [12, 12],
  wide: [30, 30],
  broad: [80, 80],
};

const SINGLE_SIDED_BINS: Record<WidthName, number> = {
  narrow: 5,
  medium: 20,
  wide: 40,
  broad: 150,
};

const NEAR_SHAPES: StrategyShape[] = ["Spot", "Curve"];
const NEAR_WIDTHS: WidthName[] = ["narrow", "medium"];
const PATIENT_EXITS: ExitName[] = ["patient", "stay"];

export function classicGridCells(): GridCell[] {
  const cells: GridCell[] = [];
  for (const shape of SHAPES) {
    for (const width of WIDTHS) {
      for (const side of SIDES) {
        for (const exit of EXITS) {
          cells.push(makeCell(shape, width, side, exit, false));
        }
      }
    }
  }
  return cells;
}

/** Spot and Curve, narrow or medium, one bin array, no rebalance. */
export function costAwareCells(): GridCell[] {
  const cells: GridCell[] = [];
  for (const shape of NEAR_SHAPES) {
    for (const width of NEAR_WIDTHS) {
      for (const side of SIDES) {
        for (const exit of PATIENT_EXITS) {
          cells.push(makeCell(shape, width, side, exit, true));
        }
      }
    }
  }
  return cells;
}

/** Wide Spot holds and a delayed rebalance. Bid-Ask is not in this family. */
export function hypothesisCells(): GridCell[] {
  return [
    makeCell("Spot", "broad", "two-sided", "patient", false),
    makeCell("Spot", "broad", "two-sided", "stay", false),
    makeCell("Spot", "broad", "two-sided", "guard", false),
    makeCell("Spot", "wide", "two-sided", "guard", false),
    makeCell("Spot", "wide", "two-sided", "rebalance6", false),
  ];
}

export function gridCells(): GridCell[] {
  return [...classicGridCells(), ...costAwareCells(), ...hypothesisCells()];
}

export function gridStrategies(): StrategyConfig[] {
  return gridCells().map((cell) => strategyFromCell(cell));
}

export function strategyFromCell(
  cell: GridCell,
  overrides: Partial<Pick<StrategyConfig, "id" | "name" | "priority" | "coinType" | "placeholder" | "placeholderNote" | "notes" | "description">> = {},
): StrategyConfig {
  return {
    id: overrides.id ?? cell.id,
    name: overrides.name ?? cell.id,
    description:
      overrides.description ??
      `${cell.shape} ${cell.width} ${cell.side} with exit ${cell.exit}. Bin step stays the pool's own step.`,
    placeholder: overrides.placeholder ?? false,
    placeholderNote:
      overrides.placeholderNote ??
      "Tournament grid cell. Widths are a search grid, not a Meteora-recommended production setting.",
    docs: [DOCS.strategies, DOCS.formulas, DOCS.whatIsDlmm],
    notes: overrides.notes ?? "",
    product: "dlmm",
    shape: cell.shape,
    binsBelow: cell.binsBelow,
    binsAbove: cell.binsAbove,
    sidedness: cell.side === "two-sided" ? "two-sided" : "single-sided-y",
    quoteSide: cell.side,
    coinType: overrides.coinType ?? null,
    priority: overrides.priority ?? 0,
    manualOnly: false,
    stayInBinArray: cell.stayInBinArray,
    requires: {},
    when: [],
    exit: {
      onOutOfRange: cell.onOutOfRange,
      rebalanceEdgeBins: 0,
      stopLossPct: cell.stopLossPct,
      takeProfitPct: cell.takeProfitPct,
      maxHoldHours: null,
      outOfRangeTimeoutHours: cell.outOfRangeTimeoutHours,
      ...(cell.compositeExit ? { compositeExit: true } : {}),
    },
  };
}

function makeCell(shape: StrategyShape, width: WidthName, side: QuoteSide, exit: ExitName, stayInBinArray: boolean): GridCell {
  const two = TWO_SIDED_BINS[width];
  const single = SINGLE_SIDED_BINS[width];
  const binsBelow = side === "two-sided" ? two[0] : single;
  const binsAbove = side === "two-sided" ? two[1] : 0;
  const exitSpec = exitSpecFor(exit);
  const shapeId = shape === "BidAsk" ? "bidask" : shape.toLowerCase();
  const sideId = side === "two-sided" ? "two" : side;
  const arrayId = stayInBinArray ? "-array" : "";
  return {
    id: `grid-${shapeId}-${width}-${sideId}-${exit}${arrayId}`,
    shape,
    width,
    side,
    exit,
    binsBelow,
    binsAbove,
    stayInBinArray,
    compositeExit: exit === "guard",
    ...exitSpec,
  };
}

function exitSpecFor(exit: ExitName): Pick<GridCell, "onOutOfRange" | "outOfRangeTimeoutHours" | "stopLossPct" | "takeProfitPct"> {
  if (exit === "oor") {
    return { onOutOfRange: "close", outOfRangeTimeoutHours: null, stopLossPct: 0.12, takeProfitPct: null };
  }
  if (exit === "timeout") {
    return { onOutOfRange: "close", outOfRangeTimeoutHours: 12, stopLossPct: 0.12, takeProfitPct: null };
  }
  if (exit === "rebalance") {
    return { onOutOfRange: "rebalance", outOfRangeTimeoutHours: null, stopLossPct: 0.18, takeProfitPct: null };
  }
  if (exit === "patient") {
    return { onOutOfRange: "close", outOfRangeTimeoutHours: 48, stopLossPct: 0.18, takeProfitPct: null };
  }
  if (exit === "stay" || exit === "guard") {
    return { onOutOfRange: "close", outOfRangeTimeoutHours: 96, stopLossPct: 0.18, takeProfitPct: null };
  }
  if (exit === "rebalance6") {
    return { onOutOfRange: "rebalance", outOfRangeTimeoutHours: 6, stopLossPct: 0.18, takeProfitPct: null };
  }
  return { onOutOfRange: "close", outOfRangeTimeoutHours: null, stopLossPct: 0.08, takeProfitPct: 0.15 };
}

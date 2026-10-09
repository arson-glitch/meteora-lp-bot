import { DOCS } from "../constants.js";
import type { StrategyConfig } from "../strategy/schema.js";
import type { QuoteSide, StrategyShape } from "../types.js";

/**
 * Every combination of shape, width, side, and exit.
 * 3 × 3 × 3 × 4 = 108 cells.
 *
 * Bin step is not a cell. It is a pool parameter (1–400 bps) set by the pool
 * creator. Splitting winners by bin-step band would overfit this sample.
 * https://docs.meteora.ag/core-products/dlmm/formulas
 */

export type WidthName = "narrow" | "medium" | "wide";
export type ExitName = "oor" | "timeout" | "rebalance" | "tp";

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
}

const SHAPES: StrategyShape[] = ["Spot", "Curve", "BidAsk"];
const WIDTHS: WidthName[] = ["narrow", "medium", "wide"];
const SIDES: QuoteSide[] = ["two-sided", "quote", "token"];
const EXITS: ExitName[] = ["oor", "timeout", "rebalance", "tp"];

const TWO_SIDED_BINS: Record<WidthName, [number, number]> = {
  narrow: [2, 2],
  medium: [12, 12],
  wide: [30, 30],
};

const SINGLE_SIDED_BINS: Record<WidthName, number> = {
  narrow: 5,
  medium: 20,
  wide: 40,
};

export function gridCells(): GridCell[] {
  const cells: GridCell[] = [];
  for (const shape of SHAPES) {
    for (const width of WIDTHS) {
      for (const side of SIDES) {
        for (const exit of EXITS) {
          cells.push(makeCell(shape, width, side, exit));
        }
      }
    }
  }
  return cells;
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
    requires: {},
    when: [],
    exit: {
      onOutOfRange: cell.onOutOfRange,
      rebalanceEdgeBins: 0,
      stopLossPct: cell.stopLossPct,
      takeProfitPct: cell.takeProfitPct,
      maxHoldHours: null,
      outOfRangeTimeoutHours: cell.outOfRangeTimeoutHours,
    },
  };
}

function makeCell(shape: StrategyShape, width: WidthName, side: QuoteSide, exit: ExitName): GridCell {
  const two = TWO_SIDED_BINS[width];
  const single = SINGLE_SIDED_BINS[width];
  const binsBelow = side === "two-sided" ? two[0] : single;
  const binsAbove = side === "two-sided" ? two[1] : 0;
  const exitSpec = exitSpecFor(exit);
  const shapeId = shape === "BidAsk" ? "bidask" : shape.toLowerCase();
  const sideId = side === "two-sided" ? "two" : side;
  return {
    id: `grid-${shapeId}-${width}-${sideId}-${exit}`,
    shape,
    width,
    side,
    exit,
    binsBelow,
    binsAbove,
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
  return { onOutOfRange: "close", outOfRangeTimeoutHours: null, stopLossPct: 0.08, takeProfitPct: 0.15 };
}

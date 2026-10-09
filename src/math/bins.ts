import { BIN_STEP_BPS_DENOMINATOR, MAX_BIN_STEP } from "../constants.js";

/**
 * P_i = (1 + binStep / 10_000) ^ i
 * https://docs.meteora.ag/core-products/dlmm/formulas
 *
 * The program returns this in Q64.64. This helper uses floating point, which
 * matches @meteora-ag/dlmm getPriceOfBinByBinId within ~1e-9 relative error
 * for the ranges we test.
 */
export function priceFromBinId(binId: number, binStep: number): number {
  assertBinStep(binStep);
  const base = 1 + binStep / BIN_STEP_BPS_DENOMINATOR;
  return base ** binId;
}

/**
 * Inverse of priceFromBinId.
 * `down` matches DLMM.getBinIdFromPrice(price, binStep, true).
 * `up` matches DLMM.getBinIdFromPrice(price, binStep, false).
 * https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/reference
 */
export function binIdFromPrice(
  price: number,
  binStep: number,
  rounding: "down" | "up" | "nearest" = "nearest",
): number {
  assertBinStep(binStep);
  if (!(price > 0)) throw new Error("price must be positive");
  const base = 1 + binStep / BIN_STEP_BPS_DENOMINATOR;
  const raw = Math.log(price) / Math.log(base);
  if (rounding === "down") return Math.floor(raw + 1e-9);
  if (rounding === "up") return Math.ceil(raw - 1e-9);
  return Math.round(raw);
}

export function assertBinStep(binStep: number): void {
  if (!Number.isInteger(binStep) || binStep < 1 || binStep > MAX_BIN_STEP) {
    throw new Error(`bin step ${binStep} is outside DLMM's supported range of 1..${MAX_BIN_STEP} bps`);
  }
}

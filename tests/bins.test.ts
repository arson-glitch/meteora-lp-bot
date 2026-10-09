import { describe, expect, it } from "vitest";
import { binIdFromPrice, priceFromBinId } from "../src/math/bins.js";

describe("bin prices", () => {
  it("follows P_i = (1 + binStep/10000)^i", () => {
    expect(priceFromBinId(0, 25)).toBe(1);
    expect(priceFromBinId(1, 25)).toBeCloseTo(1.0025, 12);
    expect(priceFromBinId(-1, 25)).toBeCloseTo(1 / 1.0025, 12);
    expect(priceFromBinId(2, 25)).toBeCloseTo(1.0025 ** 2, 12);
  });

  it("inverts an exact bin price without rounding drift", () => {
    const price = priceFromBinId(1, 25);
    expect(binIdFromPrice(price, 25, "down")).toBe(1);
    expect(binIdFromPrice(price, 25, "up")).toBe(1);
    expect(binIdFromPrice(price, 25, "nearest")).toBe(1);
  });

  it("rounds a price that sits between two bins", () => {
    expect(binIdFromPrice(110, 4, "down")).toBe(11753);
    expect(binIdFromPrice(110, 4, "up")).toBe(11754);
  });

  it("rejects a bin step outside the program range", () => {
    expect(() => priceFromBinId(1, 401)).toThrow(/400/);
  });
});

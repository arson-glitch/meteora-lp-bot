import { describe, expect, it } from "vitest";
import { binIdFromPrice, priceFromBinId } from "../src/math/bins.js";
import { loadDlmmSdk } from "../src/sdk.js";

describe("SDK bin price parity", () => {
  const sdk = loadDlmmSdk();

  it("matches DLMM.getPriceOfBinByBinId and getBinIdFromPrice", () => {
    const samples: Array<[number, number]> = [
      [0, 25],
      [1, 25],
      [-2, 25],
      [10, 25],
      [11753, 4],
      [-500, 80],
    ];
    for (const [binId, binStep] of samples) {
      const sdkPrice = Number(sdk.getPriceOfBinByBinId(binId, binStep).toString());
      const ours = priceFromBinId(binId, binStep);
      expect(Math.abs(ours - sdkPrice) / Math.abs(sdkPrice)).toBeLessThan(1e-8);
    }
    expect(sdk.getBinIdFromPrice(110, 4, true)).toBe(binIdFromPrice(110, 4, "down"));
    expect(sdk.getBinIdFromPrice(110, 4, false)).toBe(binIdFromPrice(110, 4, "up"));
    expect(sdk.getBinIdFromPrice(1.0025, 25, true)).toBe(1);
    expect(sdk.StrategyType).toMatchObject({ Spot: 0, Curve: 1, BidAsk: 2 });
  });
});

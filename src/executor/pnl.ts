import type { PaperPosition } from "../types.js";

export function inventoryAmounts(position: PaperPosition): { amountX: number; amountY: number } {
  let amountX = 0;
  let amountY = 0;
  for (const bin of position.bins) {
    amountX += bin.amountX;
    amountY += bin.amountY;
  }
  return { amountX, amountY };
}

export function markValueUsd(position: PaperPosition): number {
  const { amountX, amountY } = inventoryAmounts(position);
  return amountX * position.priceXUsd + amountY * position.priceYUsd;
}

export function unrealizedPnlUsd(position: PaperPosition): number {
  if (position.status === "closed") return 0;
  return markValueUsd(position) + position.claimedFeesUsd + position.feesUsd - position.depositedUsd;
}

export function displayPnlUsd(position: PaperPosition): number {
  if (position.status === "closed") return position.realizedPnlUsd;
  return unrealizedPnlUsd(position);
}

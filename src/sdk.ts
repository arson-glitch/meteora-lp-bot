import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * @meteora-ag/dlmm's ESM build currently fails under Node 22 because an Anchor
 * import is a directory. The package's CommonJS entry loads cleanly, and it is
 * what the live executor and the bin-price parity test use.
 * https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/getting-started
 */
export interface DlmmSdk {
  create: (
    connection: unknown,
    pool: unknown,
    opt?: { cluster?: string },
  ) => Promise<DlmmPoolClient>;
  getBinIdFromPrice: (price: number, binStep: number, min: boolean) => number;
  getPriceOfBinByBinId: (binId: number, binStep: number) => { toString(): string };
  StrategyType: { Spot: number; Curve: number; BidAsk: number };
}

export interface DlmmPoolClient {
  getActiveBin: () => Promise<{ binId: number; price: string }>;
  tokenX: { mint: { decimals: number } };
  tokenY: { mint: { decimals: number } };
  initializePositionAndAddLiquidityByStrategy: (params: {
    positionPubKey: unknown;
    user: unknown;
    totalXAmount: unknown;
    totalYAmount: unknown;
    strategy: {
      minBinId: number;
      maxBinId: number;
      strategyType: number;
      singleSidedX?: boolean;
    };
    slippage?: number;
  }) => Promise<unknown>;
  removeLiquidity: (params: {
    user: unknown;
    position: unknown;
    fromBinId: number;
    toBinId: number;
    bps: unknown;
    shouldClaimAndClose?: boolean;
  }) => Promise<unknown[]>;
  claimSwapFee: (params: { owner: unknown; position: unknown }) => Promise<unknown[]>;
}

export function loadDlmmSdk(): DlmmSdk {
  return require("@meteora-ag/dlmm") as DlmmSdk;
}

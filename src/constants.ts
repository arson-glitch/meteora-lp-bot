/**
 * DLMM constants from Meteora's docs.
 *
 * Bin price, fees, and position limits:
 * https://docs.meteora.ag/core-products/dlmm/formulas
 * https://docs.meteora.ag/core-products/dlmm/what-is-dlmm
 * https://docs.meteora.ag/core-products/dlmm/dynamic-positions
 *
 * The on-chain program stores bin price as Q64.64 and fee rates in 1e9
 * precision. Paper math uses IEEE floats and is checked against
 * @meteora-ag/dlmm in tests/sdk-parity.test.ts.
 */

export const DOCS = {
  getStarted: "https://docs.meteora.ag/get-started",
  whatIsDlmm: "https://docs.meteora.ag/core-products/dlmm/what-is-dlmm",
  formulas: "https://docs.meteora.ag/core-products/dlmm/formulas",
  strategies: "https://docs.meteora.ag/core-products/dlmm/strategies-and-use-cases",
  dynamicPositions: "https://docs.meteora.ag/core-products/dlmm/dynamic-positions",
  collectFeeMode: "https://docs.meteora.ag/core-products/dlmm/collect-fee-mode",
  stayingSafe: "https://docs.meteora.ag/user-guides/staying-safe-on-meteora",
  sdkStart: "https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/getting-started",
  sdkExamples: "https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/examples",
  sdkReference: "https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/reference",
  dataApi: "https://docs.meteora.ag/developer-guides/dlmm/api-reference/overview",
  poolsApi: "https://docs.meteora.ag/api-reference/dlmm/pools/pools",
  whatIsDammV2: "https://docs.meteora.ag/core-products/damm-v2/what-is-damm-v2",
  dammSdk: "https://docs.meteora.ag/developer-guides/damm-v2/typescript-sdk/getting-started",
} as const;

export const DLMM_PROGRAM_ID = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
export const DAMM_V2_PROGRAM_ID = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";

/** 10_000 basis points = 100%. */
export const BIN_STEP_BPS_DENOMINATOR = 10_000;

/** Fee rates are stored in 1e9 precision. 10_000_000 = 1%. */
export const FEE_DENOMINATOR = 1_000_000_000;

/** 100_000_000 = 10% total fee cap. */
export const MAX_FEE_RATE = 100_000_000;

/** Standard pool protocol share: 10% (1_000 bps). Launch pools use 2_000 bps. */
export const PROTOCOL_SHARE_STANDARD_BPS = 1_000;
export const PROTOCOL_SHARE_LAUNCH_BPS = 2_000;
export const MAX_PROTOCOL_SHARE_BPS = 2_500;

/** Referral host receives 20% of the applicable protocol fee. */
export const HOST_FEE_BPS = 2_000;

/** Limit-order fee slice is 50/50 participant/protocol, independent of pool type. */
export const LIMIT_ORDER_FEE_SHARE_BPS = 5_000;

export const MAX_BIN_STEP = 400;
export const DEFAULT_BINS_PER_POSITION = 70;
export const MAX_BINS_PER_POSITION = 1_400;
export const BINS_PER_BIN_ARRAY = 70;
export const MAX_BINS_ADDED_PER_RESIZE = 91;

export const DLMM_API_BASE = "https://dlmm.datapi.meteora.ag";
export const DAMM_V2_API_BASE = "https://damm-v2.datapi.meteora.ag";
export const RUGCHECK_API_BASE = "https://api.rugcheck.xyz";
export const DEXSCREENER_API_BASE = "https://api.dexscreener.com";

export const BPS_DENOMINATOR = 10_000;

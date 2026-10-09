import { Keypair, PublicKey, sendAndConfirmTransaction, type Connection } from "@solana/web3.js";
import BN from "bn.js";
import bs58 from "bs58";
import type { AppConfig } from "../config.js";
import type { StrategyConfig } from "../strategy/schema.js";
import { loadDlmmSdk } from "../sdk.js";

/**
 * Live sends are impossible unless MODE=live, WALLET_PRIVATE_KEY is set, and
 * the caller passes confirmLive. The default pipeline never does that.
 * Transactions are built with @meteora-ag/dlmm exactly as the SDK examples show:
 * https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/examples
 */
export class LiveTradingDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveTradingDisabledError";
  }
}

export function assertLiveTradingAllowed(config: AppConfig, confirmLive: boolean): void {
  if (config.mode !== "live" || !confirmLive) {
    throw new LiveTradingDisabledError(
      "Live trading is disabled. Paper mode is the default. Set MODE=live, set WALLET_PRIVATE_KEY, and pass --confirm-live to sign transactions.",
    );
  }
  if (!config.walletPrivateKey) {
    throw new LiveTradingDisabledError(
      "MODE=live and --confirm-live were set, but WALLET_PRIVATE_KEY is empty. Refusing to trade.",
    );
  }
}

export function keypairFromSecret(secret: string): Keypair {
  const trimmed = secret.trim();
  if (!trimmed) throw new Error("WALLET_PRIVATE_KEY is empty");
  try {
    if (trimmed.startsWith("[")) {
      const bytes = JSON.parse(trimmed) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(bytes));
    }
    const bytes = bs58.decode(trimmed);
    if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
    if (bytes.length === 32) return Keypair.fromSeed(bytes);
  } catch {
    throw new Error("WALLET_PRIVATE_KEY could not be decoded. Expected base58 or a JSON byte array.");
  }
  throw new Error("WALLET_PRIVATE_KEY could not be decoded. Expected base58 or a JSON byte array.");
}

export interface LiveOpenResult {
  signature: string;
  positionPubkey: string;
  owner: string;
  minBinId: number;
  maxBinId: number;
  activeBinId: number;
}

export async function openLivePosition(params: {
  config: AppConfig;
  confirmLive: boolean;
  connection: Connection;
  poolAddress: string;
  strategy: StrategyConfig;
  amountX: number;
  amountY: number;
  decimalsX: number;
  decimalsY: number;
}): Promise<LiveOpenResult> {
  assertLiveTradingAllowed(params.config, params.confirmLive);
  const user = keypairFromSecret(params.config.walletPrivateKey as string);
  const sdk = loadDlmmSdk();
  const pool = await sdk.create(params.connection, new PublicKey(params.poolAddress), {
    cluster: params.config.cluster,
  });
  const active = await pool.getActiveBin();
  const minBinId = active.binId - params.strategy.binsBelow;
  const maxBinId = active.binId + params.strategy.binsAbove;
  const position = Keypair.generate();
  const strategyType =
    params.strategy.shape === "Curve"
      ? sdk.StrategyType.Curve
      : params.strategy.shape === "BidAsk"
        ? sdk.StrategyType.BidAsk
        : sdk.StrategyType.Spot;
  const tx = await pool.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: position.publicKey,
    user: user.publicKey,
    totalXAmount: toBaseUnits(params.amountX, params.decimalsX),
    totalYAmount: toBaseUnits(params.amountY, params.decimalsY),
    strategy: {
      minBinId,
      maxBinId,
      strategyType,
      singleSidedX: params.strategy.sidedness === "single-sided-x",
    },
    slippage: 1,
  });
  const signature = await sendAndConfirmTransaction(params.connection, tx as never, [user, position]);
  return {
    signature,
    positionPubkey: position.publicKey.toBase58(),
    owner: user.publicKey.toBase58(),
    minBinId,
    maxBinId,
    activeBinId: active.binId,
  };
}

export async function claimLiveFees(params: {
  config: AppConfig;
  confirmLive: boolean;
  connection: Connection;
  poolAddress: string;
  positionPubkey: string;
}): Promise<string[]> {
  assertLiveTradingAllowed(params.config, params.confirmLive);
  const user = keypairFromSecret(params.config.walletPrivateKey as string);
  const sdk = loadDlmmSdk();
  const pool = await sdk.create(params.connection, new PublicKey(params.poolAddress), {
    cluster: params.config.cluster,
  });
  const txs = await pool.claimSwapFee({
    owner: user.publicKey,
    position: new PublicKey(params.positionPubkey),
  });
  const signatures: string[] = [];
  for (const tx of txs) {
    signatures.push(await sendAndConfirmTransaction(params.connection, tx as never, [user]));
  }
  return signatures;
}

export async function closeLivePosition(params: {
  config: AppConfig;
  confirmLive: boolean;
  connection: Connection;
  poolAddress: string;
  positionPubkey: string;
  minBinId: number;
  maxBinId: number;
}): Promise<string[]> {
  assertLiveTradingAllowed(params.config, params.confirmLive);
  const user = keypairFromSecret(params.config.walletPrivateKey as string);
  const sdk = loadDlmmSdk();
  const pool = await sdk.create(params.connection, new PublicKey(params.poolAddress), {
    cluster: params.config.cluster,
  });
  const txs = await pool.removeLiquidity({
    user: user.publicKey,
    position: new PublicKey(params.positionPubkey),
    fromBinId: params.minBinId,
    toBinId: params.maxBinId,
    bps: new BN(10_000),
    shouldClaimAndClose: true,
  });
  const signatures: string[] = [];
  for (const tx of txs) {
    signatures.push(await sendAndConfirmTransaction(params.connection, tx as never, [user]));
  }
  return signatures;
}

function toBaseUnits(amount: number, decimals: number): BN {
  const factor = 10 ** decimals;
  const scaled = Math.round(amount * factor);
  return new BN(Math.max(0, scaled).toString());
}

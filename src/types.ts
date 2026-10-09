export type Product = "dlmm" | "damm-v2";
export type StrategyShape = "Spot" | "Curve" | "BidAsk";
export type Sidedness = "two-sided" | "single-sided-x" | "single-sided-y";
export type RunMode = "paper" | "live";

export interface PoolToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
  holders: number | null;
  freezeAuthorityDisabled: boolean | null;
  isVerified: boolean;
  marketCapUsd: number | null;
}

export interface MarketContext {
  source: "dexscreener" | "birdeye" | "none";
  dexId: string | null;
  pairAddress: string | null;
  priceChangeH1Pct: number | null;
  priceChangeH24Pct: number | null;
  volumeH24Usd: number | null;
  liquidityUsd: number | null;
}

export interface DiscoveredPool {
  product: Product;
  address: string;
  name: string;
  tokenX: PoolToken;
  tokenY: PoolToken;
  tvlUsd: number;
  currentPrice: number;
  binStep: number | null;
  baseFeePct: number | null;
  dynamicFeePct: number | null;
  protocolFeePct: number | null;
  collectFeeMode: number | null;
  createdAtMs: number;
  volume: Record<string, number>;
  fees: Record<string, number>;
  protocolFees: Record<string, number>;
  feeTvlRatio: Record<string, number>;
  isBlacklisted: boolean;
  launchpad: string;
  tags: string[];
  listSource: "volume" | "new" | "both" | "damm-v2";
  market: MarketContext;
  score?: number;
  scoreBreakdown?: Record<string, number>;
}

export interface SimBin {
  binId: number;
  price: number;
  side: "bid" | "ask" | "empty";
  weight: number;
  amountX: number;
  amountY: number;
}

export interface PaperPosition {
  id: string;
  mode: "paper";
  status: "open" | "closed";
  product: "dlmm";
  poolAddress: string;
  poolName: string;
  strategyId: string;
  strategyName: string;
  placeholderStrategy: boolean;
  shape: StrategyShape;
  sidedness: Sidedness;
  binStep: number;
  binsBelow: number;
  binsAbove: number;
  minBinId: number;
  maxBinId: number;
  activeBinId: number;
  centeredActiveBinId: number;
  entryActiveBinId: number;
  entryPrice: number;
  lastPrice: number;
  priceXUsd: number;
  priceYUsd: number;
  collectFeeMode: number | null;
  dynamicPosition: boolean;
  depositedUsd: number;
  bins: SimBin[];
  feesUsd: number;
  feesX: number;
  feesY: number;
  claimedFeesUsd: number;
  realizedPnlUsd: number;
  openedAt: string;
  updatedAt: string;
  lastFeeMarkAt: string;
  closedAt?: string;
  closeReason?: string;
  rebalanceCount: number;
  stopLossPct: number;
  takeProfitPct: number | null;
  onOutOfRange: "close" | "rebalance";
  rebalanceEdgeBins: number;
  maxHoldHours: number | null;
  tokenX: { address: string; symbol: string; decimals: number };
  tokenY: { address: string; symbol: string; decimals: number };
}

export interface PaperBook {
  version: 1;
  mode: "paper";
  updatedAt: string;
  positions: PaperPosition[];
  events: PnlEvent[];
}

export interface LivePositionRecord {
  id: string;
  poolAddress: string;
  poolName: string;
  positionPubkey: string;
  openSignature: string;
  strategyId: string;
  sizeUsd: number;
  minBinId: number;
  maxBinId: number;
  activeBinId: number;
  openedAt: string;
  status: "open" | "closed";
  closeSignature?: string;
  closedAt?: string;
}

export interface LiveBook {
  version: 1;
  mode: "live";
  updatedAt: string;
  positions: LivePositionRecord[];
}

export interface PnlEvent {
  ts: string;
  mode: RunMode;
  type: "open" | "mark" | "rebalance" | "close" | "skip";
  positionId?: string;
  poolAddress?: string;
  poolName?: string;
  strategyId?: string;
  depositedUsd?: number;
  markValueUsd?: number;
  feesUsd?: number;
  claimedFeesUsd?: number;
  unrealizedPnlUsd?: number;
  realizedPnlUsd?: number;
  detail: string;
}

export interface RugVerdict {
  ok: boolean;
  normalisedScore: number | null;
  reasons: string[];
  warnings: string[];
  sources: string[];
  fetchedRemote: boolean;
}

export interface RiskLimits {
  maxPositionUsd: number;
  maxOpenPositions: number;
  dailyLossCapUsd: number;
  minTvlUsd: number;
  minVolume24hUsd: number;
}

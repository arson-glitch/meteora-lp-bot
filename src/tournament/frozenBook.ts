import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { advancePosition, openPaperPosition } from "../executor/paper.js";
import { displayPnlUsd, inventoryAmounts } from "../executor/pnl.js";
import { assumedLiquidityBins } from "../math/activeBin.js";
import { isSolToken, liquidationCost, tokenLegToSol, type ExitCost } from "../math/costs.js";
import { ageHours, riskTokens } from "../markets.js";
import { fetchDlmmPool } from "../scanner/meteora.js";
import type { StrategyConfig } from "../strategy/schema.js";
import type { DiscoveredPool, PaperPosition } from "../types.js";
import type { RugCheckOptions } from "../rugcheck/checker.js";
import { classifyPool } from "./classify.js";
import { enrichPriceChange } from "./discover.js";
import { loadFrozenStrategy, type FrozenStrategyFile } from "./frozen.js";
import { rugGatePools, type RugHit } from "./rugGate.js";

export const FROZEN_BOOK_KIND = "frozen-high-vol";
export const FROZEN_OPEN_CAP = 200;
const SOL_USDC_POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";

export interface FrozenSlot {
  position: PaperPosition;
}

export interface FrozenForwardBook {
  version: 1;
  mode: "paper";
  kind: typeof FROZEN_BOOK_KIND;
  strategyId: string;
  strategyVersion: string;
  parameterHash: string;
  costModelVersion: string;
  updatedAt: string;
  sizeUsd: number;
  solPriceUsd: number;
  slots: FrozenSlot[];
}

export interface FrozenPoolRow {
  name: string;
  address: string;
  status: "open" | "closed";
  grossPnlUsd: number;
  netPnlUsd: number;
  exitSlippageUsd: number;
  txAndRentUsd: number;
  refundableRentUsd: number;
  closeReason: string | null;
}

export interface FrozenBookStatus {
  strategyId: string;
  strategyVersion: string;
  parameterHash: string;
  solPriceUsd: number;
  positions: number;
  open: number;
  closed: number;
  added: string[];
  deferred: number;
  qualifying: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  pools: FrozenPoolRow[];
  rugs: RugHit[];
}

export function emptyFrozenBook(frozen: FrozenStrategyFile, nowMs: number, sizeUsd: number, solPriceUsd: number): FrozenForwardBook {
  return {
    version: 1,
    mode: "paper",
    kind: FROZEN_BOOK_KIND,
    strategyId: frozen.strategy.id,
    strategyVersion: frozen.version,
    parameterHash: frozen.parameterHash,
    costModelVersion: frozen.costModelVersion,
    updatedAt: new Date(nowMs).toISOString(),
    sizeUsd,
    solPriceUsd,
    slots: [],
  };
}

export function loadFrozenBook(path: string): FrozenForwardBook {
  const raw = JSON.parse(readFileSync(path, "utf8")) as FrozenForwardBook;
  if (raw.kind !== FROZEN_BOOK_KIND || !Array.isArray(raw.slots)) {
    throw new Error(`${path} is not the frozen high-vol paper book`);
  }
  return raw;
}

export function loadFrozenBookIfPresent(path: string, frozen: FrozenStrategyFile, nowMs: number, sizeUsd: number, solPriceUsd: number): FrozenForwardBook {
  if (!existsSync(path)) return emptyFrozenBook(frozen, nowMs, sizeUsd, solPriceUsd);
  return loadFrozenBook(path);
}

export function saveFrozenBook(path: string, book: FrozenForwardBook): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(book));
}

/**
 * High-vol pools in the scanned universe. Pools that can only qualify through
 * a 24h price change are enriched first, up to 80 mints. Turnover of 8 already
 * qualifies without that call.
 */
export async function qualifyingHighVolPools(
  universe: DiscoveredPool[],
  nowMs: number,
  onProgress?: (message: string) => void,
): Promise<DiscoveredPool[]> {
  const tradable = universe.filter((pool) => pool.product === "dlmm" && pool.binStep !== null && pool.binStep > 0 && pool.currentPrice > 0 && pool.tvlUsd >= 1_500 && !pool.isBlacklisted);
  const maybe = tradable.filter((pool) => {
    if (ageHours(pool.createdAtMs, nowMs) < 24) return false;
    const type = classifyPool(pool, nowMs).type;
    return type !== "stable" && type !== "bluechip";
  });
  const needPrice = [];
  const seen = new Set<string>();
  for (const pool of [...maybe].sort((a, b) => (b.volume["24h"] ?? 0) - (a.volume["24h"] ?? 0))) {
    if (pool.market.priceChangeH24Pct !== null) continue;
    const turnover = pool.tvlUsd > 0 ? (pool.volume["24h"] ?? 0) / pool.tvlUsd : 0;
    if (turnover >= 8) continue;
    const token = riskTokens(pool)[0];
    if (!token?.address || seen.has(token.address)) continue;
    seen.add(token.address);
    needPrice.push(pool);
    if (needPrice.length >= 80) break;
  }
  if (needPrice.length > 0) {
    onProgress?.(`Enriching price change for ${needPrice.length} possible high-vol coins`);
    await enrichPriceChange(needPrice);
  }
  return maybe
    .filter((pool) => classifyPool(pool, nowMs).type === "high-vol-trending")
    .sort((a, b) => (b.volume["24h"] ?? 0) - (a.volume["24h"] ?? 0));
}

export function appendFrozenPools(params: {
  book: FrozenForwardBook;
  pools: DiscoveredPool[];
  strategy: StrategyConfig;
  sizeUsd: number;
  nowMs: number;
  cap?: number;
}): { book: FrozenForwardBook; added: string[]; deferred: number } {
  const cap = params.cap ?? FROZEN_OPEN_CAP;
  const have = new Set(params.book.slots.map((slot) => slot.position.poolAddress));
  const added: string[] = [];
  let deferred = 0;
  for (const pool of params.pools) {
    if (have.has(pool.address)) continue;
    if (added.length >= cap) {
      deferred += 1;
      continue;
    }
    params.book.slots.push({
      position: openPaperPosition({
        pool,
        strategy: params.strategy,
        sizeUsd: params.sizeUsd,
        nowMs: params.nowMs,
      }),
    });
    have.add(pool.address);
    added.push(pool.name);
  }
  params.book.updatedAt = new Date(params.nowMs).toISOString();
  params.book.sizeUsd = params.sizeUsd;
  return { book: params.book, added, deferred };
}

export async function markFrozenBook(book: FrozenForwardBook, nowMs: number): Promise<FrozenForwardBook> {
  const open = book.slots.filter((slot) => slot.position.status === "open");
  const addresses = [...new Set(open.map((slot) => slot.position.poolAddress))];
  const pools = new Map<string, DiscoveredPool>();
  for (const address of addresses) {
    const pool = await fetchDlmmPool(address);
    if (pool) pools.set(address, pool);
  }
  for (const slot of book.slots) {
    if (slot.position.status !== "open") continue;
    const pool = pools.get(slot.position.poolAddress);
    if (!pool) continue;
    const stepped = advancePosition({
      position: slot.position,
      pool,
      nowMs,
      feeModel: "active-bin",
      liquidityBins: assumedLiquidityBins(pool),
    });
    slot.position = stepped.position;
  }
  book.updatedAt = new Date(nowMs).toISOString();
  return book;
}

export function frozenBookStatus(book: FrozenForwardBook, pools: Map<string, DiscoveredPool>, added: string[], deferred: number, qualifying: number, rugs: RugHit[] = []): FrozenBookStatus {
  const rows = book.slots.map((slot) => rowForSlot(slot, pools.get(slot.position.poolAddress) ?? null, book.solPriceUsd));
  return {
    strategyId: book.strategyId,
    strategyVersion: book.strategyVersion,
    parameterHash: book.parameterHash,
    solPriceUsd: book.solPriceUsd,
    positions: rows.length,
    open: rows.filter((row) => row.status === "open").length,
    closed: rows.filter((row) => row.status === "closed").length,
    added,
    deferred,
    qualifying,
    grossPnlUsd: rows.reduce((sum, row) => sum + row.grossPnlUsd, 0),
    netPnlUsd: rows.reduce((sum, row) => sum + row.netPnlUsd, 0),
    pools: rows,
    rugs,
  };
}

export function rowForSlot(slot: FrozenSlot, pool: DiscoveredPool | null, solPriceUsd: number): FrozenPoolRow {
  const position = slot.position;
  const gross = displayPnlUsd(position);
  const cost = costOf(position, pool, solPriceUsd);
  return {
    name: position.poolName,
    address: position.poolAddress,
    status: position.status,
    grossPnlUsd: gross,
    netPnlUsd: gross - cost.pnlCostUsd,
    exitSlippageUsd: cost.exitSlippageUsd,
    txAndRentUsd: cost.txFeeUsd + cost.sunkBinArrayUsd,
    refundableRentUsd: cost.refundableRentUsd,
    closeReason: position.closeReason ?? null,
  };
}

export function costOf(position: PaperPosition, pool: DiscoveredPool | null, solPriceUsd: number): ExitCost {
  const leg = tokenLegToSol(position.tokenX, position.tokenY);
  const amounts = inventoryAmounts(position);
  const tokenAmount = leg === "x" ? amounts.amountX + position.feesX : leg === "y" ? amounts.amountY + position.feesY : 0;
  const standIn = pool ?? poolStandIn(position);
  return liquidationCost({
    pool: standIn,
    minBinId: position.minBinId,
    maxBinId: position.maxBinId,
    activeBinId: position.activeBinId,
    binStep: position.binStep,
    rebalanceCount: position.rebalanceCount,
    liquidityBins: assumedLiquidityBins(standIn),
    solPriceUsd,
    tokenLeg: leg,
    tokenAmount,
    tokenPriceUsd: leg === "y" ? position.priceYUsd : position.priceXUsd,
    otherPriceUsd: leg === "y" ? position.priceXUsd : position.priceYUsd,
  });
}

export async function solPriceUsd(pools: DiscoveredPool[]): Promise<number> {
  for (const pool of pools) {
    if (isSolToken(pool.tokenX) && pool.tokenX.priceUsd > 0) return pool.tokenX.priceUsd;
    if (isSolToken(pool.tokenY) && pool.tokenY.priceUsd > 0) return pool.tokenY.priceUsd;
  }
  const sol = await fetchDlmmPool(SOL_USDC_POOL);
  if (sol) {
    if (isSolToken(sol.tokenX) && sol.tokenX.priceUsd > 0) return sol.tokenX.priceUsd;
    if (isSolToken(sol.tokenY) && sol.tokenY.priceUsd > 0) return sol.tokenY.priceUsd;
  }
  return 0;
}

export async function syncFrozenHighVolBook(options: {
  path: string;
  frozenPath: string;
  universe: DiscoveredPool[];
  nowMs: number;
  sizeUsd: number;
  rug?: RugCheckOptions;
  onProgress?: (message: string) => void;
}): Promise<FrozenBookStatus> {
  const frozen = loadFrozenStrategy(options.frozenPath);
  const price = await solPriceUsd(options.universe);
  const book = loadFrozenBookIfPresent(options.path, frozen, options.nowMs, options.sizeUsd, price);
  if (book.parameterHash !== frozen.parameterHash) {
    throw new Error(`Frozen book hash ${book.parameterHash} does not match ${frozen.parameterHash}. Refusing to mix parameter versions.`);
  }
  book.solPriceUsd = price;
  if (book.slots.length > 0) {
    options.onProgress?.(`Marking ${book.slots.length} frozen high-vol positions`);
    await markFrozenBook(book, options.nowMs);
  }
  const qualifying = await qualifyingHighVolPools(options.universe, options.nowMs, options.onProgress);
  const have = new Set(book.slots.map((slot) => slot.position.poolAddress));
  const fresh = qualifying.filter((pool) => !have.has(pool.address));
  let opening = fresh;
  let rugs: RugHit[] = [];
  if (options.rug) {
    options.onProgress?.(`Rug-checking ${fresh.length} new high-vol pools`);
    const gated = await rugGatePools({
      pools: fresh,
      coinType: "high-vol-trending",
      options: options.rug,
      accept: FROZEN_OPEN_CAP,
    });
    opening = gated.passed;
    rugs = gated.hits;
  }
  const appended = appendFrozenPools({
    book,
    pools: opening,
    strategy: frozen.strategy,
    sizeUsd: options.sizeUsd,
    nowMs: options.nowMs,
  });
  saveFrozenBook(options.path, appended.book);
  const byAddress = new Map(options.universe.map((pool) => [pool.address, pool]));
  options.onProgress?.(`Frozen high-vol book: opened ${appended.added.length}, deferred ${appended.deferred}`);
  return frozenBookStatus(appended.book, byAddress, appended.added, appended.deferred, qualifying.length, rugs);
}

function poolStandIn(position: PaperPosition): DiscoveredPool {
  return {
    product: "dlmm",
    address: position.poolAddress,
    name: position.poolName,
    tokenX: {
      address: position.tokenX.address,
      symbol: position.tokenX.symbol,
      name: position.tokenX.symbol,
      decimals: position.tokenX.decimals,
      priceUsd: position.priceXUsd,
      holders: null,
      freezeAuthorityDisabled: null,
      isVerified: false,
      marketCapUsd: null,
    },
    tokenY: {
      address: position.tokenY.address,
      symbol: position.tokenY.symbol,
      name: position.tokenY.symbol,
      decimals: position.tokenY.decimals,
      priceUsd: position.priceYUsd,
      holders: null,
      freezeAuthorityDisabled: null,
      isVerified: false,
      marketCapUsd: null,
    },
    tvlUsd: 0,
    currentPrice: position.lastPrice,
    binStep: position.binStep,
    baseFeePct: 0,
    dynamicFeePct: 0,
    protocolFeePct: null,
    collectFeeMode: position.collectFeeMode,
    createdAtMs: 0,
    volume: {},
    fees: {},
    protocolFees: {},
    feeTvlRatio: {},
    isBlacklisted: false,
    launchpad: "",
    tags: [],
    listSource: "volume",
    market: {
      source: "none",
      dexId: null,
      pairAddress: null,
      priceChangeH1Pct: null,
      priceChangeH24Pct: null,
      volumeH24Usd: null,
      liquidityUsd: null,
    },
  };
}

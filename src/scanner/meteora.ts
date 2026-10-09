import { DAMM_V2_API_BASE, DLMM_API_BASE } from "../constants.js";
import { getJson } from "../http.js";
import type { DiscoveredPool, PoolToken, Product } from "../types.js";

interface TokenRaw {
  address?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  price?: number;
  holders?: number;
  freeze_authority_disabled?: boolean;
  is_verified?: boolean;
  market_cap?: number;
}

interface PoolRaw {
  address?: string;
  pool_address?: string;
  name?: string;
  token_x?: TokenRaw;
  token_y?: TokenRaw;
  tvl?: number;
  current_price?: number;
  created_at?: number;
  pool_config?: {
    bin_step?: number;
    base_fee_pct?: number;
    max_fee_pct?: number;
    protocol_fee_pct?: number;
    collect_fee_mode?: number;
  };
  dynamic_fee_pct?: number;
  volume?: Record<string, number>;
  fees?: Record<string, number>;
  protocol_fees?: Record<string, number>;
  fee_tvl_ratio?: Record<string, number>;
  is_blacklisted?: boolean;
  launchpad?: string;
  tags?: string[];
}

interface ListResponse {
  data?: PoolRaw[];
}

const EMPTY_MARKET = {
  source: "none" as const,
  dexId: null,
  pairAddress: null,
  priceChangeH1Pct: null,
  priceChangeH24Pct: null,
  volumeH24Usd: null,
  liquidityUsd: null,
};

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function windowOf(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) out[key] = num(entry);
  return out;
}

function mapToken(raw: TokenRaw | undefined): PoolToken {
  return {
    address: String(raw?.address ?? ""),
    symbol: String(raw?.symbol ?? "?"),
    name: String(raw?.name ?? ""),
    decimals: num(raw?.decimals),
    priceUsd: num(raw?.price),
    holders: raw?.holders === undefined || raw?.holders === null ? null : num(raw.holders),
    freezeAuthorityDisabled:
      typeof raw?.freeze_authority_disabled === "boolean" ? raw.freeze_authority_disabled : null,
    isVerified: Boolean(raw?.is_verified),
    marketCapUsd: raw?.market_cap === undefined || raw?.market_cap === null ? null : num(raw.market_cap),
  };
}

export function mapPool(
  raw: PoolRaw,
  product: Product,
  listSource: DiscoveredPool["listSource"],
): DiscoveredPool {
  let createdAt = num(raw.created_at);
  if (createdAt > 0 && createdAt < 1e12) createdAt *= 1000;
  const binStep = raw.pool_config?.bin_step;
  return {
    product,
    address: String(raw.address ?? raw.pool_address ?? ""),
    name: String(raw.name ?? "unknown"),
    tokenX: mapToken(raw.token_x),
    tokenY: mapToken(raw.token_y),
    tvlUsd: num(raw.tvl),
    currentPrice: num(raw.current_price),
    binStep: binStep === undefined || binStep === null ? null : num(binStep),
    baseFeePct: raw.pool_config?.base_fee_pct ?? null,
    dynamicFeePct: raw.dynamic_fee_pct ?? null,
    protocolFeePct: raw.pool_config?.protocol_fee_pct ?? null,
    collectFeeMode:
      raw.pool_config?.collect_fee_mode === undefined ? null : num(raw.pool_config.collect_fee_mode),
    createdAtMs: createdAt,
    volume: windowOf(raw.volume),
    fees: windowOf(raw.fees),
    protocolFees: windowOf(raw.protocol_fees),
    feeTvlRatio: windowOf(raw.fee_tvl_ratio),
    isBlacklisted: Boolean(raw.is_blacklisted),
    launchpad: String(raw.launchpad ?? ""),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    listSource,
    market: { ...EMPTY_MARKET },
  };
}

async function fetchList(
  base: string,
  params: Record<string, string>,
): Promise<PoolRaw[]> {
  const query = new URLSearchParams(params);
  const body = await getJson<ListResponse>(`${base}/pools?${query.toString()}`);
  return body.data ?? [];
}

export async function fetchDlmmPools(params: {
  page?: number;
  pageSize: number;
  sortBy: string;
  filterBy?: string;
  listSource: "volume" | "new";
  query?: string;
}): Promise<DiscoveredPool[]> {
  const query: Record<string, string> = {
    page: String(params.page ?? 1),
    page_size: String(params.pageSize),
    sort_by: params.sortBy,
  };
  if (params.filterBy) query.filter_by = params.filterBy;
  if (params.query) query.query = params.query;
  const rows = await fetchList(DLMM_API_BASE, query);
  return rows
    .map((row) => mapPool(row, "dlmm", params.listSource))
    .filter((pool) => pool.address && !pool.isBlacklisted);
}

export async function fetchDlmmPool(address: string): Promise<DiscoveredPool | null> {
  const body = await getJson<PoolRaw & { data?: PoolRaw }>(`${DLMM_API_BASE}/pools/${address}`);
  const raw = body.token_x || body.address ? body : body.data;
  if (!raw) return null;
  const pool = mapPool(raw, "dlmm", "volume");
  return pool.address ? pool : null;
}

export async function fetchDammV2Pools(pageSize: number): Promise<DiscoveredPool[]> {
  const rows = await fetchList(DAMM_V2_API_BASE, {
    page: "1",
    page_size: String(pageSize),
    sort_by: "volume_24h:desc",
    filter_by: "is_blacklisted=false && tvl>=10000",
  });
  return rows
    .map((row) => mapPool(row, "damm-v2", "damm-v2"))
    .filter((pool) => pool.address && !pool.isBlacklisted);
}

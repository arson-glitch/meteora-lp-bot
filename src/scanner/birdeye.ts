import { getJson } from "../http.js";

/**
 * Optional enrichment. Birdeye's public API requires a key, so the scanner
 * skips it unless BIRDEYE_API_KEY is set. DexScreener is the free default.
 */
export async function fetchBirdeyePriceChange(
  mint: string,
  apiKey: string,
): Promise<number | null> {
  const url = `https://public-api.birdeye.so/defi/token_overview?address=${mint}`;
  const body = await getJson<{
    data?: { priceChange24hPercent?: number; v24hChangePercent?: number };
    priceChange24hPercent?: number;
  }>(url, {
    headers: { "X-API-KEY": apiKey, "x-chain": "solana" },
  });
  const value =
    body.data?.priceChange24hPercent ??
    body.data?.v24hChangePercent ??
    body.priceChange24hPercent;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

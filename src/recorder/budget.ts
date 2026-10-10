/** Helius free-plan figures, checked against the public pricing docs on 2026-10-10. */
export const HELIUS_FREE_MONTHLY_CREDITS = 1_000_000;
export const HELIUS_FREE_RPC_RPS = 10;
export const HELIUS_FREE_WS_CONNECTIONS = 5;
export const HELIUS_FREE_SUBSCRIPTIONS_PER_CONNECTION = 1_000;

/**
 * LaserStream standard WebSocket billing: 2 credits per 0.1 MB of uncompressed
 * bytes. 100_000 bytes => 2 credits.
 */
export const WS_BYTES_PER_CREDIT = 50_000;

/** Stay under the free 10 req/s limit. */
export const DEFAULT_RPC_RPS = 8;

/**
 * 150 pools × 96 snapshots × ~2 RPC calls is about 28,800 credits/day.
 * A 32,000 cap leaves a little room for log bytes and keeps 30 days under 1M.
 */
export const DEFAULT_DAILY_CREDIT_CAP = 32_000;

export function wsCredits(bytes: number): number {
  if (bytes <= 0) return 0;
  return bytes / WS_BYTES_PER_CREDIT;
}

export function hourStartMs(nowMs: number): number {
  return Math.floor(nowMs / 3_600_000) * 3_600_000;
}

export function utcDayStartMs(nowMs: number): number {
  const date = new Date(nowMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function rpcCreditsForMethod(method: string): number {
  if (method === "getProgramAccounts") return 10;
  return 1;
}

export function creditsFromRpcBody(body: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return 1;
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  let credits = 0;
  for (const call of calls) {
    const method = call && typeof call === "object" && "method" in call ? String((call as { method: unknown }).method) : "rpc";
    credits += rpcCreditsForMethod(method);
  }
  return credits || 1;
}

/**
 * Credits to leave untouched so the remaining 15-minute snapshots still fit
 * before more swap fetches are issued.
 */
export function reservedSnapshotCredits(params: {
  pools: number;
  snapshotMinutes: number;
  rpcPerSnapshot: number;
  nowMs: number;
}): number {
  const dayEnd = utcDayStartMs(params.nowMs) + 86_400_000;
  const roundsLeft = Math.ceil(Math.max(0, dayEnd - params.nowMs) / (params.snapshotMinutes * 60_000));
  return roundsLeft * params.pools * params.rpcPerSnapshot;
}

export function projectedMonthCredits(monthToDate: number, nowMs: number): number {
  const day = new Date(nowMs).getUTCDate();
  const elapsed = Math.max(1, day);
  return (monthToDate / elapsed) * 30;
}

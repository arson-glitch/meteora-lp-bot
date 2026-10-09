import { RUGCHECK_API_BASE } from "../constants.js";
import { getJson } from "../http.js";
import { isQuoteToken, riskTokens } from "../markets.js";
import type { DiscoveredPool, RugVerdict } from "../types.js";

/**
 * Token risk gate.
 * Remote source: RugCheck summary (free, unauthenticated, about 1 request/second).
 * https://api.rugcheck.xyz/v1/tokens/{mint}/report/summary
 * Local checks follow Meteora's safety guide: freeze authority, blacklist,
 * thin liquidity, and holder count.
 * https://docs.meteora.ag/user-guides/staying-safe-on-meteora
 */

export interface RugRiskItem {
  name?: string;
  description?: string;
  score?: number;
  level?: string;
  value?: string;
}

export interface RugSummary {
  score?: number;
  score_normalised?: number;
  lpLockedPct?: number;
  risks?: RugRiskItem[];
}

export interface RugCheckOptions {
  failScore: number;
  minHolders: number;
  minTvlUsd: number;
  failClosed: boolean;
  fetchSummary?: (mint: string) => Promise<RugSummary>;
}

export async function fetchRugcheckSummary(mint: string): Promise<RugSummary> {
  return getJson<RugSummary>(`${RUGCHECK_API_BASE}/v1/tokens/${mint}/report/summary`);
}

export async function evaluatePoolRisk(
  pool: DiscoveredPool,
  options: RugCheckOptions,
): Promise<RugVerdict> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const sources = ["meteora-pool"];
  let fetchedRemote = false;
  let normalisedScore: number | null = null;

  if (pool.isBlacklisted) reasons.push("Meteora marks this pool as blacklisted");
  if (pool.tvlUsd < options.minTvlUsd) {
    reasons.push(`TVL $${pool.tvlUsd.toFixed(0)} is below the $${options.minTvlUsd} floor`);
  }

  for (const token of [pool.tokenX, pool.tokenY]) {
    if (isQuoteToken(token)) {
      warnings.push(`${token.symbol} is a quote asset; mint and freeze checks skipped`);
      continue;
    }
    if (token.freezeAuthorityDisabled === false) {
      reasons.push(`${token.symbol} freeze authority is enabled`);
    }
    if (token.holders !== null && token.holders < options.minHolders) {
      reasons.push(`${token.symbol} has ${token.holders} holders, below ${options.minHolders}`);
    }
    if (!token.isVerified) warnings.push(`${token.symbol} is not marked verified by Meteora`);
  }

  const risky = riskTokens(pool);
  if (risky.length === 0) {
    return {
      ok: reasons.length === 0,
      normalisedScore,
      reasons,
      warnings,
      sources,
      fetchedRemote,
    };
  }

  const fetchSummary = options.fetchSummary ?? fetchRugcheckSummary;
  for (const token of risky) {
    try {
      const summary = await fetchSummary(token.address);
      fetchedRemote = true;
      sources.push("rugcheck");
      const verdict = applySummary(token.symbol, summary, options.failScore);
      if (verdict.score !== null) normalisedScore = Math.max(normalisedScore ?? 0, verdict.score);
      reasons.push(...verdict.reasons);
      warnings.push(...verdict.warnings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.failClosed) {
        reasons.push(`RugCheck request failed for ${token.symbol} (${message})`);
      } else {
        warnings.push(`RugCheck request failed for ${token.symbol} (${message})`);
      }
    }
  }

  return {
    ok: reasons.length === 0,
    normalisedScore,
    reasons,
    warnings,
    sources: [...new Set(sources)],
    fetchedRemote,
  };
}

function applySummary(
  symbol: string,
  summary: RugSummary,
  failScore: number,
): { score: number | null; reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const score =
    typeof summary.score_normalised === "number" && Number.isFinite(summary.score_normalised)
      ? summary.score_normalised
      : null;
  if (score !== null && score >= failScore) {
    reasons.push(`${symbol} RugCheck normalised score ${score} is at or above ${failScore}`);
  }
  for (const risk of summary.risks ?? []) {
    const name = risk.name ?? "unnamed risk";
    const level = (risk.level ?? "").toLowerCase();
    const line = `${symbol}: ${name}${risk.value ? ` (${risk.value})` : ""}`;
    if (level === "danger" || /mint authority|freeze authority/i.test(name)) {
      reasons.push(line);
    } else {
      warnings.push(line);
    }
  }
  if (typeof summary.lpLockedPct === "number" && summary.lpLockedPct > 0 && summary.lpLockedPct < 80) {
    warnings.push(`${symbol} RugCheck lpLockedPct is ${summary.lpLockedPct}`);
  }
  return { score, reasons, warnings };
}

import { riskTokens } from "./markets.js";
import type { PipelineReport } from "./pipeline.js";
import type { DiscoveredPool, PaperBook, PaperPosition } from "./types.js";
import { displayPnlUsd, markValueUsd } from "./executor/pnl.js";

export function renderScan(ranked: DiscoveredPool[], nowMs: number, top: number): string {
  const lines = [`Scanned ${ranked.length} pools`, ""];
  const dlmm = ranked.filter((pool) => pool.product === "dlmm").slice(0, top);
  lines.push("DLMM ranking");
  if (dlmm.length === 0) lines.push("  none");
  dlmm.forEach((pool, index) => lines.push(formatPool(pool, index + 1, nowMs)));
  const damm = ranked.filter((pool) => pool.product === "damm-v2").slice(0, 5);
  if (damm.length > 0) {
    lines.push("", "DAMM v2 discovery only (not executed)");
    damm.forEach((pool, index) => lines.push(formatPool(pool, index + 1, nowMs)));
  }
  return lines.join("\n");
}

export function renderReport(report: PipelineReport, nowMs: number, top: number): string {
  const lines = [
    `Meteora LP bot — ${report.mode} mode${report.mode === "paper" ? " (no transactions signed)" : ""}`,
    renderScan(report.ranked, nowMs, top),
    "",
    "Decisions",
  ];
  if (report.decisions.length === 0) lines.push("  no candidates");
  for (const decision of report.decisions) {
    const rug = decision.rug ? (decision.rug.ok ? "pass" : "fail") : "n/a";
    lines.push(
      `  ${decision.poolName}  score ${decision.score.toFixed(1)}  rug ${rug}  ${decision.action}` +
        `${decision.strategyId ? `  strategy ${decision.strategyId}` : ""}`,
    );
    lines.push(`    ${decision.reason}`);
    if (decision.rug && decision.rug.warnings.length > 0) {
      lines.push(`    warnings: ${decision.rug.warnings.slice(0, 3).join("; ")}`);
    }
  }
  lines.push("", renderBook(report.book));
  if (report.liveSignatures.length > 0) {
    lines.push("", `Live signatures: ${report.liveSignatures.join(", ")}`);
  }
  return lines.join("\n");
}

export function renderBook(book: PaperBook): string {
  const open = book.positions.filter((position) => position.status === "open");
  const lines = [`Paper book: ${open.length} open, ${book.positions.length - open.length} closed`];
  if (book.positions.length === 0) {
    lines.push("  empty");
    return lines.join("\n");
  }
  for (const position of book.positions) {
    lines.push(formatPosition(position));
  }
  return lines.join("\n");
}

function formatPool(pool: DiscoveredPool, index: number, nowMs: number): string {
  const change = pool.market.priceChangeH24Pct;
  const risk = riskTokens(pool).map((token) => token.symbol).join(",") || "quote";
  return (
    `  ${index}. ${pool.name}  score ${(pool.score ?? 0).toFixed(1)}` +
    `  vol24 ${usd(pool.volume["24h"] ?? 0)}  fees24 ${usd(pool.fees["24h"] ?? 0)}` +
    `  tvl ${usd(pool.tvlUsd)}  bin ${pool.binStep ?? "-"}  age ${formatAge(pool.createdAtMs, nowMs)}` +
    `  h24 ${change === null ? "n/a" : `${change.toFixed(1)}%`}  risk ${risk}`
  );
}

function formatPosition(position: PaperPosition): string {
  const pnl = displayPnlUsd(position);
  const mark = position.status === "closed" ? position.depositedUsd + position.realizedPnlUsd : markValueUsd(position);
  return (
    `  ${position.status} ${position.poolName}  ${position.strategyId}` +
    `  deposited ${usd(position.depositedUsd)}  mark ${usd(mark)}` +
    `  fees ${usd(position.feesUsd)}  claimed ${usd(position.claimedFeesUsd)}` +
    `  pnl ${usd(pnl)}  bins ${position.minBinId}..${position.maxBinId}` +
    `  active ${position.activeBinId}  rebalances ${position.rebalanceCount}` +
    `${position.closeReason ? `  closed:${position.closeReason}` : ""}` +
    `${position.placeholderStrategy ? "  placeholder-strategy" : ""}`
  );
}

function formatAge(createdAtMs: number, nowMs: number): string {
  if (!createdAtMs) return "n/a";
  const hours = Math.max(0, (nowMs - createdAtMs) / 3_600_000);
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function usd(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4;
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${value < 0 ? "-" : ""}$${formatted}`;
}

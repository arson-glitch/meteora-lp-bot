import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openPaperPosition } from "../executor/paper.js";
import type { RugCheckOptions } from "../rugcheck/checker.js";
import { fetchDlmmPool } from "../scanner/meteora.js";
import type { DiscoveredPool } from "../types.js";
import { classifyPool } from "./classify.js";
import {
  emptyH12Book,
  h12MarkRow,
  h12TpLabel,
  h12TpTrialPath,
  H12_TP_LEVELS,
  H12_TRIAL_FILE,
  H12_TRIAL_OPEN_CAP,
  loadH12DailySeries,
  loadH12TpTrial,
  loadH12Trial,
  markH12Book,
  rankH12Candidates,
  saveH12Book,
  strategyForWidth,
  type H12TrialBook,
  type H12TrialFile,
  type H12TrialRow,
} from "./h12trial.js";
import { rugGatePools, type RugHit } from "./rugGate.js";

export const H12_MATCHED_IDS = ["base", "tp10", "tp15", "tp25", "tp40"] as const;
export type H12MatchedId = (typeof H12_MATCHED_IDS)[number];

export function h12MatchedBookPath(id: H12MatchedId, root = process.cwd()): string {
  return join(root, "data", `h12-matched-${id}-forward.json`);
}

export interface H12MatchedSync {
  id: H12MatchedId;
  book: H12TrialBook;
  rows: H12TrialRow[];
  added: string[];
  aligned: boolean;
}

/**
 * One entry decision for five books. A pool is opened in every book at this
 * mark, or in none of them. The original H12 and take-profit books are not
 * read or written.
 */
export async function syncH12MatchedBooks(options: {
  root?: string;
  cacheDir: string;
  universe: DiscoveredPool[];
  nowMs: number;
  solPriceUsd: number;
  rug?: RugCheckOptions;
  onProgress?: (message: string) => void;
}): Promise<{ books: H12MatchedSync[]; rugs: RugHit[]; scored: number; passed: number; withdrew: number; note: string }> {
  const log = options.onProgress ?? (() => {});
  const root = options.root ?? process.cwd();
  const loaded = H12_MATCHED_IDS.map((id) => {
    const trial = trialFor(id, root);
    const path = h12MatchedBookPath(id, root);
    const book = loadMatched(path, trial, id, options.nowMs, options.solPriceUsd);
    book.solPriceUsd = options.solPriceUsd;
    return { id, trial, path, book };
  });
  for (const row of loaded) {
    const open = row.book.slots.filter((slot) => slot.position.status === "open").length;
    if (open > 0) {
      log(`Marking ${open} matched H12 ${row.id} positions`);
      await markH12Book(row.book, options.nowMs, fetchDlmmPool);
    }
  }
  const addressSets = loaded.map((row) => new Set(row.book.slots.map((slot) => slot.position.poolAddress)));
  const aligned = addressSets.every((set) => sameSet(set, addressSets[0] ?? new Set()));
  const have = new Set<string>();
  for (const set of addressSets) for (const address of set) have.add(address);
  let note = aligned
    ? "The five matched books hold the same pool addresses."
    : "The five matched books have diverged. This run marks them and does not open a pool that is missing from one of them.";
  log("Scoring one H12 quintile for the matched books");
  const series = await loadH12DailySeries(options.universe, options.cacheDir, options.nowMs, log);
  const ranked = rankH12Candidates(series, options.nowMs, loaded[0]?.trial.rule);
  const fresh = ranked.passed
    .filter((row) => !have.has(row.pool.address))
    .sort((a, b) => b.score - a.score);
  let opening = aligned ? fresh : [];
  if (!aligned) note += " No new pool was opened.";
  let rugs: RugHit[] = [];
  if (options.rug && opening.length > 0) {
    log(`Rug-checking ${opening.length} matched H12 candidates once`);
    const gated = await rugGatePools({
      pools: opening.map((row) => row.pool),
      coinType: "h12-matched",
      options: options.rug,
      accept: H12_TRIAL_OPEN_CAP,
    });
    const allowed = new Set(gated.passed.map((pool) => pool.address));
    opening = opening.filter((row) => allowed.has(row.pool.address));
    rugs = gated.hits;
  }
  const added: string[] = [];
  for (const candidate of opening) {
    const bins = candidate.bins;
    if (bins === null) continue;
    if (added.length >= H12_TRIAL_OPEN_CAP) break;
    appendMatchedSlots(loaded, { ...candidate, bins }, options.nowMs);
    added.push(candidate.pool.name);
  }
  const poolMap = new Map(options.universe.map((pool) => [pool.address, pool]));
  const books: H12MatchedSync[] = [];
  for (const row of loaded) {
    row.book.updatedAt = new Date(options.nowMs).toISOString();
    row.book.sizeUsd = row.trial.rule.sizeUsd;
    row.book.kind = "h12-matched";
    saveH12Book(row.path, row.book);
    books.push({
      id: row.id,
      book: row.book,
      rows: row.book.slots.map((slot) => h12MarkRow(slot, poolMap.get(slot.position.poolAddress) ?? null, row.book.solPriceUsd)),
      added,
      aligned,
    });
  }
  log(`Matched H12: opened ${added.length} pool${added.length === 1 ? "" : "s"} in all five books`);
  return {
    books,
    rugs,
    scored: ranked.candidates.length,
    passed: ranked.passed.length,
    withdrew: ranked.withdrew,
    note,
  };
}

export function renderH12Matched(result: {
  books: H12MatchedSync[];
  rugs: RugHit[];
  scored: number;
  passed: number;
  withdrew: number;
  note: string;
}): string {
  const lines: string[] = [];
  lines.push("## H12 matched books");
  lines.push("");
  lines.push("Separate from the original H12 trial and its take-profit books, which keep running. These five open a pool only when every book opens it, at the same mark, after one shared rug check. Take-profit exits swap back to SOL. Not promoted. The frozen rule hashes are unchanged.");
  lines.push("");
  lines.push(result.note);
  lines.push("");
  lines.push(`Scored ${result.scored}. Passed the pre-entry top 20% with a usable width: ${result.passed}. Cartea withdrawals ${result.withdrew}.`);
  lines.push("");
  lines.push("| Book | Hash | Positions | Open | Closed | Net | Vs hold | Opened now |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const row of result.books) {
    const net = row.rows.reduce((sum, item) => sum + item.netPnlUsd, 0);
    const hold = row.rows.reduce((sum, item) => sum + item.vsHoldUsd, 0);
    const open = row.rows.filter((item) => item.status === "open").length;
    lines.push(`| \`h12-matched-${row.id}\` | \`${row.book.parameterHash.slice(0, 12)}\` | ${row.rows.length} | ${open} | ${row.rows.length - open} | $${net.toFixed(2)} | $${hold.toFixed(2)} | ${row.added.length ? row.added.join(", ") : "none"} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function matchedAddresses(books: H12TrialBook[]): { aligned: boolean; addresses: string[] } {
  const sets = books.map((book) => new Set(book.slots.map((slot) => slot.position.poolAddress)));
  const aligned = sets.every((set) => sameSet(set, sets[0] ?? new Set()));
  const addresses = [...(sets[0] ?? new Set<string>())].sort();
  return { aligned, addresses };
}

function trialFor(id: H12MatchedId, root: string): H12TrialFile {
  if (id === "base") return loadH12Trial(join(root, H12_TRIAL_FILE));
  const level = H12_TP_LEVELS.find((item) => h12TpLabel(item) === id);
  if (level === undefined) throw new Error(`Unknown matched book ${id}`);
  return loadH12TpTrial(h12TpTrialPath(level, root));
}

function loadMatched(path: string, trial: H12TrialFile, id: H12MatchedId, nowMs: number, solPriceUsd: number): H12TrialBook {
  if (!existsSync(path)) {
    const book = emptyH12Book(trial, nowMs, solPriceUsd);
    book.kind = "h12-matched";
    book.strategyId = `h12-matched-${id}`;
    return book;
  }
  const book = JSON.parse(readFileSync(path, "utf8")) as H12TrialBook;
  if (book.kind !== "h12-matched" || !Array.isArray(book.slots)) {
    throw new Error(`${path} is not an H12 matched paper book`);
  }
  if (book.parameterHash !== trial.parameterHash) {
    throw new Error(`Matched book hash ${book.parameterHash} does not match ${trial.parameterHash}`);
  }
  return book;
}

/** Opens one pool in every matched book at the same mark. */
export function appendMatchedSlots(
  rows: Array<{ book: H12TrialBook; trial: H12TrialFile }>,
  candidate: { pool: DiscoveredPool; bins: number; score: number; sigma: number; feeYield: number },
  nowMs: number,
): void {
  for (const row of rows) {
    row.book.slots.push({
      position: openAt(row.trial, candidate.pool, candidate.bins, nowMs),
      coinType: classifyPool(candidate.pool, nowMs).type,
      binsEachSide: candidate.bins,
      entryScore: candidate.score,
      entrySigma: candidate.sigma,
      entryFeeYield: candidate.feeYield,
      entryTvlUsd: candidate.pool.tvlUsd,
      crossedBinFeesUsd: 0,
      activeBinFeesUsd: 0,
    });
  }
}

function openAt(trial: H12TrialFile, pool: DiscoveredPool, bins: number, nowMs: number) {
  return openPaperPosition({
    pool,
    strategy: strategyForWidth(trial.strategy, bins),
    sizeUsd: trial.rule.sizeUsd,
    nowMs,
  });
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

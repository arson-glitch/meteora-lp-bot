import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { displayPnlUsd } from "../executor/pnl.js";
import { isSolToken } from "../math/costs.js";
import { isQuoteToken } from "../markets.js";
import { wsCredits } from "../recorder/budget.js";
import { fetchDlmmPool } from "../scanner/meteora.js";
import type { DiscoveredPool, PaperPosition } from "../types.js";
import { costOf } from "./frozenBook.js";
import { H12_TRIAL_BOOK } from "./h12trial.js";

export const DASHBOARD_FILE = "reports/dashboard/index.html";

export interface EquityPoint {
  t: number;
  equityUsd: number;
  pnlUsd: number;
  deployedUsd: number;
}

export interface EquityLeg {
  openMs: number;
  markMs: number;
  deposit: number;
  net: number;
}

export interface BookCard {
  id: string;
  title: string;
  subtitle: string;
  updatedAt: string | null;
  missing: string | null;
  positions: number;
  open: number;
  closed: number;
  depositedUsd: number;
  grossPnlUsd: number;
  vsCashUsd: number;
  vsHoldUsd: number;
  winRate: number | null;
  wins: number;
  closedWins: number;
  closedDecided: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  equity: EquityPoint[];
}

export interface H12DashRow {
  pool: string;
  coinType: string;
  entry: string;
  width: number;
  status: "open" | "closed";
  crossedPnlUsd: number;
  activePnlUsd: number;
  costsUsd: number;
  exitReason: string;
}

export interface CoinBreakdown {
  book: string;
  coinType: string;
  positions: number;
  open: number;
  closed: number;
  vsCashUsd: number;
  vsHoldUsd: number;
  wins: number;
}

export interface LeaderRow {
  coinType: string;
  strategyId: string;
  trainMedian: number;
  testMedian: number;
  holdoutN: number;
  holdoutMedian: number;
  holdoutVsHold: number;
  promoted: boolean;
  note: string;
}

export interface RugRow {
  source: string;
  pool: string;
  bucket: string;
  kind: string;
  reasons: string;
}

export interface RecorderHealth {
  present: boolean;
  path: string | null;
  note: string;
  pools: number | null;
  swaps: number | null;
  snapshots: number | null;
  liquidity: number | null;
  drops: number | null;
  credits: number | null;
  rpcCredits: number | null;
  wsCredits: number | null;
  creditHours: number | null;
  lastSwapAt: string | null;
  lastSnapshotAt: string | null;
}

export interface PoolQuoteNote {
  quoted: number;
  fallback: number;
  fetchedAt: string | null;
}

export interface DashboardModel {
  generatedAt: string;
  books: BookCard[];
  h12Rows: H12DashRow[];
  coins: CoinBreakdown[];
  leaderboardGeneratedAt: string | null;
  leaderboard: LeaderRow[];
  rugs: RugRow[];
  recorder: RecorderHealth;
  quotes: PoolQuoteNote;
}

interface Measured {
  coinType: string;
  openMs: number;
  markMs: number;
  deposit: number;
  gross: number;
  costs: number;
  vsCash: number;
  vsHold: number;
  status: "open" | "closed";
}

export function equityCurve(legs: EquityLeg[]): EquityPoint[] {
  const events: Array<{ t: number; order: number; deposit: number; net: number }> = [];
  for (const leg of legs) {
    events.push({ t: leg.openMs, order: 1, deposit: leg.deposit, net: 0 });
    const sameBar = !(leg.markMs > leg.openMs);
    events.push({
      t: sameBar ? leg.openMs : leg.markMs,
      order: sameBar ? 2 : 0,
      deposit: 0,
      net: leg.net,
    });
  }
  events.sort((a, b) => a.t - b.t || a.order - b.order);
  let deployed = 0;
  let pnl = 0;
  const points: EquityPoint[] = [];
  for (let index = 0; index < events.length;) {
    const t = events[index]?.t ?? 0;
    const order = events[index]?.order ?? 0;
    while (index < events.length && events[index]?.t === t && events[index]?.order === order) {
      deployed += events[index]?.deposit ?? 0;
      pnl += events[index]?.net ?? 0;
      index += 1;
    }
    points.push({ t, equityUsd: deployed + pnl, pnlUsd: pnl, deployedUsd: deployed });
  }
  return points;
}

export function drawdownOf(points: EquityPoint[]): { usd: number; pct: number } {
  let peak = 0;
  let usd = 0;
  let pct = 0;
  for (const point of points) {
    peak = Math.max(peak, point.equityUsd);
    const drop = peak - point.equityUsd;
    if (drop > usd) {
      usd = drop;
      pct = peak > 0 ? drop / peak : 0;
    }
  }
  return { usd, pct };
}

export function parseRugRejects(markdown: string, source: string): RugRow[] {
  const rows: RugRow[] = [];
  let section = "";
  let headers: string[] = [];
  let inTable = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      section = line.slice(3).trim();
      headers = [];
      inTable = false;
      continue;
    }
    if (!section.toLowerCase().includes("rug")) continue;
    if (line.startsWith("|") && line.toLowerCase().includes("pool") && line.toLowerCase().includes("reason")) {
      headers = splitTable(line).map((cell) => cell.toLowerCase());
      inTable = true;
      continue;
    }
    if (!inTable || !line.startsWith("|") || line.includes("---")) continue;
    const cells = splitTable(line);
    const record = new Map(headers.map((header, index) => [header, cells[index] ?? ""]));
    const kind = record.get("kind") ?? "";
    if (!/reject|api-failure|api failure/i.test(kind)) continue;
    rows.push({
      source: `${source}: ${section}`,
      pool: record.get("pool") ?? "",
      bucket: record.get("bucket") ?? "",
      kind,
      reasons: record.get("reasons") ?? "",
    });
  }
  return rows;
}

export function readRecorderHealth(dbPath: string | undefined): RecorderHealth {
  if (!dbPath) {
    return emptyRecorder(null, "No recorder sqlite was passed. Run npm run dashboard -- --db <recorder.sqlite>.");
  }
  if (!existsSync(dbPath)) {
    return emptyRecorder(dbPath, `Database not found at ${dbPath}.`);
  }
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const swaps = count(db, "swaps");
    const snapshots = count(db, "snapshots");
    const liquidity = count(db, "liquidity");
    const pools = count(db, "pools");
    const credits = db.prepare(`
      SELECT COALESCE(SUM(rpc_credits), 0) AS rpc, COALESCE(SUM(ws_bytes), 0) AS bytes, COUNT(*) AS hours
      FROM credit_hours
    `).get() as { rpc: number; bytes: number; hours: number };
    const lastSwap = scalar(db, `SELECT MAX(received_at) AS t FROM swaps`);
    const lastSnap = scalar(db, `SELECT MAX(taken_at) AS t FROM snapshots`);
    const meta = db.prepare(`SELECT key, value FROM meta`).all() as Array<{ key: string; value: string }>;
    const dropRow = meta.find((row) => /drop/i.test(row.key));
    const drops = dropRow && Number.isFinite(Number(dropRow.value)) ? Number(dropRow.value) : null;
    return {
      present: true,
      path: dbPath,
      note: drops === null
        ? "Drops are counted in the recorder process log and are not written to this sqlite."
        : `Drops read from meta.${dropRow?.key}.`,
      pools,
      swaps,
      snapshots,
      liquidity,
      drops,
      credits: credits.rpc + wsCredits(credits.bytes),
      rpcCredits: credits.rpc,
      wsCredits: wsCredits(credits.bytes),
      creditHours: credits.hours,
      lastSwapAt: lastSwap ? new Date(lastSwap).toISOString() : null,
      lastSnapshotAt: lastSnap ? new Date(lastSnap).toISOString() : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyRecorder(dbPath, `Could not read ${dbPath}: ${message}`);
  } finally {
    db?.close();
  }
}

export interface DashboardPaths {
  reportsDir: string;
  h12BookPath: string;
  frozenBookPath: string;
  forwardPath: string;
  recorderDb?: string;
  nowMs?: number;
  /** Pools already in memory, for example the daily scan. */
  pools?: DiscoveredPool[];
  /** Skip network quotes. Costs then use stored TVL and no pool fee. */
  offline?: boolean;
}

export async function buildDashboard(paths: DashboardPaths): Promise<DashboardModel> {
  const nowMs = paths.nowMs ?? Date.now();
  const h12 = loadH12(paths.h12BookPath);
  const frozen = loadFrozen(paths.frozenBookPath);
  const forward = loadForward(paths.forwardPath);
  const solFallback = h12.sol ?? frozen.sol ?? solFromPositions([...forward.positions, ...frozen.positions, ...h12.positions]);
  const gridSol = solFallback;
  const addresses = [
    ...h12.positions.map((position) => position.poolAddress),
    ...frozen.positions.map((position) => position.poolAddress),
    ...forward.positions.map((position) => position.poolAddress),
  ];
  const quotes = await resolveQuotes(addresses, paths.pools, paths.offline === true, nowMs);
  const h12Measured = h12.slots.map((slot) => measure(slot.position, slot.coinType, h12.sol ?? solFallback, quotes.map.get(slot.position.poolAddress) ?? null, slot.entryTvlUsd ?? 0));
  const frozenMeasured = frozen.positions.map((position) => measure(position, "high-vol-trending", frozen.sol ?? solFallback, quotes.map.get(position.poolAddress) ?? null, 0));
  const poolTypes = forward.poolTypes;
  const forwardMeasured = forward.positions.map((position) => measure(position, poolTypes.get(position.poolAddress) ?? "unknown", gridSol, quotes.map.get(position.poolAddress) ?? null, 0));
  const h12Card = card("h12", "H12 trial", h12.subtitle, h12.updatedAt, h12.missing, h12Measured);
  const frozenCard = card("frozen", "Frozen high-vol", frozen.subtitle, frozen.updatedAt, frozen.missing, frozenMeasured);
  const forwardCard = card("grid", "108-cell tournament grid", forward.subtitle, forward.updatedAt, forward.missing, forwardMeasured);
  return {
    generatedAt: new Date(nowMs).toISOString(),
    books: [h12Card, frozenCard, forwardCard],
    h12Rows: h12Rows(h12.slots, h12Measured),
    coins: [
      ...coinsOf("H12 trial", h12Measured),
      ...coinsOf("Frozen high-vol", frozenMeasured),
      ...coinsOf("108-cell grid", forwardMeasured),
    ],
    leaderboardGeneratedAt: leaderboardStamp(paths.reportsDir),
    leaderboard: leaderboardRows(paths.reportsDir),
    rugs: rugRows(paths.reportsDir),
    recorder: readRecorderHealth(paths.recorderDb),
    quotes: { quoted: quotes.quoted, fallback: quotes.fallback, fetchedAt: quotes.fetchedAt },
  };
}

export function renderDashboardHtml(model: DashboardModel): string {
  const h12 = model.books.find((book) => book.id === "h12");
  const frozen = model.books.find((book) => book.id === "frozen");
  const grid = model.books.find((book) => book.id === "grid");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paper trading dashboard</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0c1016;
    --card: #151b24;
    --line: #2a3544;
    --text: #e8eef6;
    --muted: #93a0b0;
    --green: #3ecf8e;
    --red: #ff6d7a;
    --amber: #f0c14d;
    --blue: #8eb4ff;
    --gold: #e2b15a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 15px/1.45 "Segoe UI", system-ui, sans-serif;
  }
  .banner {
    position: sticky;
    top: 0;
    z-index: 5;
    background: #3a2c12;
    color: #ffe3a3;
    text-align: center;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 10px 14px;
    border-bottom: 1px solid #8d6b2c;
  }
  main { max-width: 1180px; margin: 0 auto; padding: 20px 16px 48px; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; }
  h2 { font-size: 1.05rem; margin: 28px 0 10px; }
  p, .meta { color: var(--muted); }
  .meta { margin: 0 0 18px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
  .card, .panel {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 14px 16px;
  }
  .kicker { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
  .tag { display: inline-block; margin-top: 4px; color: var(--amber); font-size: 12px; }
  .pnl { font-size: 1.8rem; font-weight: 720; font-variant-numeric: tabular-nums; margin: 8px 0 0; }
  .pos { color: var(--green); }
  .neg { color: var(--red); }
  .flat { color: var(--text); }
  dl { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; margin: 12px 0 0; }
  dt { color: var(--muted); }
  dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
  .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  svg { width: 100%; height: auto; display: block; }
  .scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
  th { color: var(--muted); font-weight: 600; background: #121820; position: sticky; top: 0; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .pill { border-radius: 999px; padding: 1px 8px; font-size: 12px; }
  .pill.open { background: #163326; color: var(--green); }
  .pill.closed { background: #2a2030; color: #d7c4de; }
  .filter { margin: 0 0 8px; }
  input[type="search"] {
    width: min(100%, 320px);
    background: #0f141c;
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
  }
  .note { font-size: 13px; }
  .empty { color: var(--muted); padding: 8px 0; }
  @media (max-width: 640px) {
    h1 { font-size: 1.3rem; }
    .pnl { font-size: 1.45rem; }
    .banner { letter-spacing: 0.04em; font-size: 13px; }
  }
</style>
</head>
<body>
<div class="banner">PAPER TRADING - NOT REAL MONEY</div>
<main>
  <h1>Paper trading dashboard</h1>
  <p class="meta">Last updated ${esc(stamp(model.generatedAt))}. Separate books. Do not add them into one account. Versus cash is net PnL after exit slippage, transaction fees, and non-refundable bin-array rent. Versus hold is that equity minus buying the volatile token at entry. A quote-only pair, or a volatile token on the Y side, has no token hold, so versus hold equals versus cash. ${esc(quoteSentence(model.quotes))}</p>
  <h2>Books</h2>
  <div class="cards">
    ${model.books.map(renderCard).join("\n")}
  </div>
  <h2>Equity</h2>
  <p class="note">Each line books the deposit at entry and applies that position's latest net at its mark or close. When a new deposit shares a timestamp with an older mark, the mark is drawn first so new capital does not hide the loss. This is not a bar-by-bar path.</p>
  <div class="charts">
    ${renderLineChart("H12 trial", "#8eb4ff", h12)}
    ${renderLineChart("Frozen high-vol", "#e2b15a", frozen)}
    ${renderLineChart("108-cell grid", "#3ecf8e", grid)}
  </div>
  <h2>H12 trial positions</h2>
  <p class="note">Trial, not promoted. Crossed-bin PnL is the position mark. Active-bin PnL swaps in the parallel fee estimate and does not add it on top. Width is bins each side.</p>
  ${renderH12Table(model.h12Rows)}
  <h2>Per coin type</h2>
  ${renderCoinChart(model.coins)}
  ${renderCoinTable(model.coins)}
  <h2>Leaderboard snapshot</h2>
  <p class="note">Top three train rows from the cost-adjusted candle tournament${model.leaderboardGeneratedAt ? `, generated ${esc(stamp(model.leaderboardGeneratedAt))}` : ""}. This is not the forward book.</p>
  ${renderLeaders(model.leaderboard)}
  <h2>Rug-checker rejects</h2>
  <p class="note">Taken from the written daily and H12 trial reports. Thin TVL is a gate, not by itself a confirmed rug.</p>
  ${renderRugs(model.rugs)}
  <h2>Recorder</h2>
  ${renderRecorder(model.recorder)}
</main>
<script>
document.querySelectorAll("[data-filter]").forEach((input) => {
  const table = document.getElementById(input.getAttribute("data-filter") || "");
  if (!table) return;
  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    table.querySelectorAll("tbody tr").forEach((row) => {
      row.hidden = query.length > 0 && !row.textContent.toLowerCase().includes(query);
    });
  });
});
</script>
</body>
</html>
`;
}

export async function writeDashboard(paths: DashboardPaths): Promise<string> {
  const html = renderDashboardHtml(await buildDashboard(paths));
  const file = join(paths.reportsDir, "dashboard", "index.html");
  mkdirSync(join(paths.reportsDir, "dashboard"), { recursive: true });
  writeFileSync(file, html);
  return file;
}

function card(id: string, title: string, subtitle: string, updatedAt: string | null, missing: string | null, rows: Measured[]): BookCard {
  const equity = equityCurve(rows.map((row) => ({ openMs: row.openMs, markMs: row.markMs, deposit: row.deposit, net: row.vsCash })));
  const dd = drawdownOf(equity);
  const closed = rows.filter((row) => row.status === "closed");
  const wins = rows.filter((row) => row.vsCash > 0).length;
  return {
    id,
    title,
    subtitle,
    updatedAt,
    missing,
    positions: rows.length,
    open: rows.filter((row) => row.status === "open").length,
    closed: closed.length,
    depositedUsd: rows.reduce((sum, row) => sum + row.deposit, 0),
    grossPnlUsd: rows.reduce((sum, row) => sum + row.gross, 0),
    vsCashUsd: rows.reduce((sum, row) => sum + row.vsCash, 0),
    vsHoldUsd: rows.reduce((sum, row) => sum + row.vsHold, 0),
    winRate: rows.length === 0 ? null : wins / rows.length,
    wins,
    closedWins: closed.filter((row) => row.vsCash > 0).length,
    closedDecided: closed.length,
    maxDrawdownUsd: dd.usd,
    maxDrawdownPct: dd.pct,
    equity,
  };
}

function measure(position: PaperPosition, coinType: string, sol: number, pool: DiscoveredPool | null, fallbackTvl: number): Measured {
  const gross = displayPnlUsd(position);
  const cost = costOf(position, poolForCost(position, pool, fallbackTvl), sol);
  const vsCash = gross - cost.pnlCostUsd;
  return {
    coinType,
    openMs: Date.parse(position.openedAt),
    markMs: Date.parse(position.closedAt ?? position.updatedAt),
    deposit: position.depositedUsd,
    gross,
    costs: cost.pnlCostUsd,
    vsCash,
    vsHold: position.depositedUsd + vsCash - holdUsd(position),
    status: position.status,
  };
}

function h12Rows(slots: H12Slot[], measured: Measured[]): H12DashRow[] {
  return slots.map((slot, index) => {
    const row = measured[index];
    const gross = row?.gross ?? 0;
    const costs = row?.costs ?? 0;
    const crossed = gross - costs;
    const active = gross - slot.crossedBinFeesUsd + slot.activeBinFeesUsd - costs;
    return {
      pool: slot.position.poolName,
      coinType: slot.coinType,
      entry: slot.position.openedAt,
      width: slot.binsEachSide,
      status: slot.position.status,
      crossedPnlUsd: crossed,
      activePnlUsd: active,
      costsUsd: costs,
      exitReason: slot.position.closeReason ?? "",
    };
  }).sort((a, b) => a.crossedPnlUsd - b.crossedPnlUsd);
}

function coinsOf(book: string, rows: Measured[]): CoinBreakdown[] {
  const byType = new Map<string, CoinBreakdown>();
  for (const row of rows) {
    const current = byType.get(row.coinType) ?? {
      book,
      coinType: row.coinType,
      positions: 0,
      open: 0,
      closed: 0,
      vsCashUsd: 0,
      vsHoldUsd: 0,
      wins: 0,
    };
    current.positions += 1;
    current.open += row.status === "open" ? 1 : 0;
    current.closed += row.status === "closed" ? 1 : 0;
    current.vsCashUsd += row.vsCash;
    current.vsHoldUsd += row.vsHold;
    current.wins += row.vsCash > 0 ? 1 : 0;
    byType.set(row.coinType, current);
  }
  return [...byType.values()].sort((a, b) => a.vsCashUsd - b.vsCashUsd);
}

function holdUsd(position: PaperPosition): number {
  const xQuote = isQuoteToken(position.tokenX);
  const yQuote = isQuoteToken(position.tokenY);
  if (!xQuote && yQuote && position.entryPrice > 0 && position.lastPrice > 0) {
    return position.depositedUsd * (position.lastPrice / position.entryPrice);
  }
  return position.depositedUsd;
}

interface H12Slot {
  position: PaperPosition;
  coinType: string;
  binsEachSide: number;
  crossedBinFeesUsd: number;
  activeBinFeesUsd: number;
  entryTvlUsd?: number;
}

function loadH12(path: string): { slots: H12Slot[]; updatedAt: string | null; subtitle: string; missing: string | null; sol: number | null; positions: PaperPosition[] } {
  const raw = readJson(path);
  if (raw === undefined) return { slots: [], updatedAt: null, subtitle: "Book file is not on disk.", missing: path, sol: null, positions: [] };
  const book = raw as { updatedAt?: string; status?: string; parameterHash?: string; solPriceUsd?: number; slots?: H12Slot[] };
  const slots = Array.isArray(book.slots) ? book.slots : [];
  const hash = typeof book.parameterHash === "string" ? book.parameterHash.slice(0, 12) : "—";
  return {
    slots,
    updatedAt: book.updatedAt ?? null,
    subtitle: `${book.status ?? "trial, not promoted"} · rule ${hash}`,
    missing: null,
    sol: typeof book.solPriceUsd === "number" ? book.solPriceUsd : null,
    positions: slots.map((slot) => slot.position),
  };
}

function loadFrozen(path: string): { positions: PaperPosition[]; updatedAt: string | null; subtitle: string; missing: string | null; sol: number | null } {
  const raw = readJson(path);
  if (raw === undefined) return { positions: [], updatedAt: null, subtitle: "Book file is not on disk.", missing: path, sol: null };
  const book = raw as { updatedAt?: string; strategyId?: string; parameterHash?: string; solPriceUsd?: number; slots?: Array<{ position: PaperPosition }> };
  const positions = Array.isArray(book.slots) ? book.slots.map((slot) => slot.position) : [];
  const hash = typeof book.parameterHash === "string" ? book.parameterHash.slice(0, 12) : "—";
  return {
    positions,
    updatedAt: book.updatedAt ?? null,
    subtitle: `${book.strategyId ?? "frozen"} · ${hash}`,
    missing: null,
    sol: typeof book.solPriceUsd === "number" ? book.solPriceUsd : null,
  };
}

function loadForward(path: string): { positions: PaperPosition[]; poolTypes: Map<string, string>; updatedAt: string | null; subtitle: string; missing: string | null } {
  const raw = readJson(path);
  if (raw === undefined) return { positions: [], poolTypes: new Map(), updatedAt: null, subtitle: "Book file is not on disk.", missing: path };
  const book = raw as { updatedAt?: string; pools?: Array<{ address: string; coinType: string }>; positions?: PaperPosition[] };
  const positions = Array.isArray(book.positions) ? book.positions : [];
  const pools = Array.isArray(book.pools) ? book.pools : [];
  const strategies = new Set(positions.map((position) => position.strategyId));
  return {
    positions,
    poolTypes: new Map(pools.map((pool) => [pool.address, pool.coinType])),
    updatedAt: book.updatedAt ?? null,
    subtitle: `${strategies.size} strategies · ${pools.length} pools`,
    missing: null,
  };
}

function readJson(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function poolForCost(position: PaperPosition, pool: DiscoveredPool | null, fallbackTvl: number): DiscoveredPool {
  if (pool && pool.tvlUsd > 0) return pool;
  const tvl = fallbackTvl > 0 ? fallbackTvl : 1_000_000_000;
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
    tvlUsd: tvl,
    currentPrice: position.lastPrice,
    binStep: position.binStep,
    baseFeePct: pool?.baseFeePct ?? 0,
    dynamicFeePct: pool?.dynamicFeePct ?? 0,
    protocolFeePct: pool?.protocolFeePct ?? null,
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
    market: pool?.market ?? {
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

const QUOTE_TTL_MS = 6 * 60 * 60 * 1000;

async function resolveQuotes(
  addresses: string[],
  provided: DiscoveredPool[] | undefined,
  offline: boolean,
  nowMs: number,
): Promise<{ map: Map<string, DiscoveredPool>; quoted: number; fallback: number; fetchedAt: string | null }> {
  const map = new Map<string, DiscoveredPool>();
  for (const pool of provided ?? []) {
    if (pool.address && pool.tvlUsd > 0) map.set(pool.address, pool);
  }
  const unique = [...new Set(addresses.filter(Boolean))];
  const cachePath = join(process.cwd(), "data", "dashboard-pools.json");
  const cache = readQuoteCache(cachePath);
  let fetched = 0;
  const missing = unique.filter((address) => !map.has(address) && !fresh(cache.get(address), nowMs));
  if (!offline && missing.length > 0) {
    await mapLimit(missing, 8, async (address) => {
      try {
        const pool = await fetchDlmmPool(address);
        if (pool && pool.tvlUsd > 0) {
          pool.market = pool.market ?? {
            source: "none",
            dexId: null,
            pairAddress: null,
            priceChangeH1Pct: null,
            priceChangeH24Pct: null,
            volumeH24Usd: null,
            liquidityUsd: null,
          };
          cache.set(address, { fetchedAt: nowMs, pool });
          fetched += 1;
        }
      } catch {
        // A missed quote falls back to stored TVL.
      }
    });
    if (fetched > 0) writeQuoteCache(cachePath, cache);
  }
  let quoted = 0;
  for (const address of unique) {
    if (map.has(address)) {
      quoted += 1;
      continue;
    }
    const hit = cache.get(address);
    if (hit && hit.pool.tvlUsd > 0) {
      map.set(address, hit.pool);
      quoted += 1;
    }
  }
  const newest = [...cache.values()].reduce((max, row) => Math.max(max, row.fetchedAt), 0);
  return {
    map,
    quoted,
    fallback: unique.length - quoted,
    fetchedAt: newest > 0 ? new Date(newest).toISOString() : null,
  };
}

function fresh(row: { fetchedAt: number } | undefined, nowMs: number): boolean {
  return !!row && nowMs - row.fetchedAt < QUOTE_TTL_MS;
}

function readQuoteCache(path: string): Map<string, { fetchedAt: number; pool: DiscoveredPool }> {
  const out = new Map<string, { fetchedAt: number; pool: DiscoveredPool }>();
  if (!existsSync(path)) return out;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { pools?: Array<{ fetchedAt: number; pool: DiscoveredPool }> };
    for (const row of raw.pools ?? []) {
      if (row.pool?.address) out.set(row.pool.address, row);
    }
  } catch {
    return out;
  }
  return out;
}

function writeQuoteCache(path: string, cache: Map<string, { fetchedAt: number; pool: DiscoveredPool }>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ pools: [...cache.values()] }));
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      if (current !== undefined) await fn(current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

function quoteSentence(quotes: PoolQuoteNote): string {
  if (quotes.quoted === 0 && quotes.fallback === 0) return "No open pools to quote.";
  const when = quotes.fetchedAt ? ` Quotes cached ${stamp(quotes.fetchedAt)}.` : "";
  if (quotes.fallback === 0) return `Exit slippage uses public pool TVL and the pool fee for ${quotes.quoted} pools.${when}`;
  return `Exit slippage uses a live pool quote for ${quotes.quoted} pools. ${quotes.fallback} pools had no quote, so their slippage uses stored TVL without the pool fee.${when}`;
}

function solFromPositions(positions: PaperPosition[]): number {
  for (const position of positions) {
    if (isSolToken(position.tokenX) && position.priceXUsd > 0) return position.priceXUsd;
    if (isSolToken(position.tokenY) && position.priceYUsd > 0) return position.priceYUsd;
  }
  return 0;
}

function leaderboardStamp(reportsDir: string): string | null {
  const path = join(reportsDir, "leaderboard.md");
  if (!existsSync(path)) return null;
  const head = readFileSync(path, "utf8").slice(0, 400);
  const match = head.match(/Generated ([0-9T:.\-]+Z)/);
  return match?.[1] ?? null;
}

function leaderboardRows(reportsDir: string): LeaderRow[] {
  const csvPath = join(reportsDir, "leaderboard.csv");
  if (!existsSync(csvPath)) return [];
  const lines = readFileSync(csvPath, "utf8").trim().split("\n");
  const header = lines[0]?.split(",") ?? [];
  const notes = promotionNotes(reportsDir);
  const grouped = new Map<string, LeaderRow[]>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(",");
    const row = new Map(header.map((name, index) => [name, cells[index] ?? ""]));
    const coin = row.get("coin_type") ?? "";
    const list = grouped.get(coin) ?? [];
    if (list.length >= 3) continue;
    list.push({
      coinType: coin,
      strategyId: row.get("strategy_id") ?? "",
      trainMedian: num(row.get("train_median_return")),
      testMedian: num(row.get("test_median_return")),
      holdoutN: num(row.get("holdout_n")),
      holdoutMedian: num(row.get("holdout_median_return")),
      holdoutVsHold: num(row.get("holdout_mean_vs_hodl_usd")),
      promoted: row.get("promoted") === "true",
      note: list.length === 0 ? notes.get(coin) ?? "" : "",
    });
    grouped.set(coin, list);
  }
  return [...grouped.values()].flat();
}

function promotionNotes(reportsDir: string): Map<string, string> {
  const path = join(reportsDir, "leaderboard.md");
  const notes = new Map<string, string>();
  if (!existsSync(path)) return notes;
  let coin = "";
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.startsWith("## ") && !line.includes("How a winner") && !line.includes("Caveats") && !line.includes("Samples")) {
      coin = line.slice(3).trim();
      continue;
    }
    if (!coin || notes.has(coin) || !line.trim() || line.startsWith("|") || line.startsWith("#")) continue;
    notes.set(coin, line.trim());
  }
  return notes;
}

function rugRows(reportsDir: string): RugRow[] {
  const files: string[] = [];
  const dailyDir = join(reportsDir, "daily");
  if (existsSync(dailyDir)) {
    for (const name of readdirSync(dailyDir)) {
      if (name.endsWith(".md")) files.push(join(dailyDir, name));
    }
  }
  if (existsSync(reportsDir)) {
    for (const name of readdirSync(reportsDir)) {
      if (name.startsWith("h12-trial-") && name.endsWith(".md")) files.push(join(reportsDir, name));
    }
  }
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const seen = new Set<string>();
  const rows: RugRow[] = [];
  for (const file of files) {
    const source = file.replace(reportsDir, "").replace(/^\//, "");
    for (const row of parseRugRejects(readFileSync(file, "utf8"), source)) {
      const key = `${row.pool}|${row.reasons}|${row.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return rows;
}

function renderCard(book: BookCard): string {
  if (book.missing) {
    return `<article class="card"><div class="kicker">${esc(book.title)}</div><p class="empty">No book at ${esc(book.missing)}.</p></article>`;
  }
  const rate = book.winRate === null ? "—" : `${pct(book.winRate)} (${book.wins}/${book.positions})`;
  const closedRate = book.closedDecided === 0 ? "—" : `${book.closedWins}/${book.closedDecided}`;
  return `<article class="card">
    <div class="kicker">${esc(book.title)}</div>
    <div class="tag">${esc(book.subtitle)}</div>
    <div class="pnl ${tone(book.vsCashUsd)}">${usd(book.vsCashUsd)}</div>
    <div class="kicker">vs cash</div>
    <dl>
      <dt>vs hold</dt><dd class="${tone(book.vsHoldUsd)}">${usd(book.vsHoldUsd)}</dd>
      <dt>gross PnL</dt><dd class="${tone(book.grossPnlUsd)}">${usd(book.grossPnlUsd)}</dd>
      <dt>open / closed</dt><dd>${book.open} / ${book.closed}</dd>
      <dt>win rate vs cash</dt><dd>${rate}</dd>
      <dt>closed wins</dt><dd>${closedRate}</dd>
      <dt>max drawdown</dt><dd>${pct(book.maxDrawdownPct)} (${usd(-book.maxDrawdownUsd)})</dd>
      <dt>deposited</dt><dd>${usd(book.depositedUsd)}</dd>
      <dt>book updated</dt><dd>${book.updatedAt ? esc(stamp(book.updatedAt)) : "—"}</dd>
    </dl>
  </article>`;
}

function renderLineChart(title: string, color: string, book: BookCard | undefined): string {
  const raw = book?.equity ?? [];
  const points = raw.map((point, index) => ({ ...point, t: point.t + (index > 0 && point.t === raw[index - 1]?.t ? index : 0) }));
  if (points.length === 0) {
    return `<article class="panel"><div class="kicker">${esc(title)}</div><p class="empty">No positions to plot.</p></article>`;
  }
  const width = 640;
  const height = 220;
  const left = 58;
  const right = 12;
  const top = 16;
  const bottom = 28;
  const minY = Math.min(...points.map((point) => point.equityUsd));
  const maxY = Math.max(...points.map((point) => point.equityUsd));
  const pad = Math.max((maxY - minY) * 0.12, Math.max(Math.abs(maxY), 1) * 0.02);
  const y0 = minY - pad;
  const y1 = maxY + pad;
  const x0 = points[0]?.t ?? 0;
  const x1 = points[points.length - 1]?.t ?? x0 + 1;
  const sx = (t: number) => left + ((t - x0) / Math.max(x1 - x0, 1)) * (width - left - right);
  const sy = (value: number) => top + (1 - (value - y0) / Math.max(y1 - y0, 1e-9)) * (height - top - bottom);
  const line = points.map((point) => `${sx(point.t).toFixed(1)},${sy(point.equityUsd).toFixed(1)}`).join(" ");
  const ticks = [y1 - pad, (y0 + y1) / 2, y0 + pad];
  const grid = ticks.map((value) => {
    const y = sy(value);
    return `<line x1="${left}" y1="${y.toFixed(1)}" x2="${width - right}" y2="${y.toFixed(1)}" stroke="#2a3544" stroke-width="1"/><text x="${left - 6}" y="${(y + 4).toFixed(1)}" fill="#93a0b0" font-size="11" text-anchor="end">${esc(compactUsd(value))}</text>`;
  }).join("");
  const dots = points.map((point) => `<circle cx="${sx(point.t).toFixed(1)}" cy="${sy(point.equityUsd).toFixed(1)}" r="3.5" fill="${color}"><title>${esc(stampMs(point.t))}: equity ${usd(point.equityUsd)}, pnl ${usd(point.pnlUsd)}</title></circle>`).join("");
  const start = stampMs(x0);
  const end = stampMs(x1);
  return `<article class="panel"><div class="kicker">${esc(title)}</div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)} equity">
      ${grid}
      <polyline fill="none" stroke="${color}" stroke-width="2" points="${line}"/>
      ${dots}
      <text x="${left}" y="${height - 8}" fill="#93a0b0" font-size="11">${esc(start)}</text>
      <text x="${width - right}" y="${height - 8}" fill="#93a0b0" font-size="11" text-anchor="end">${esc(end)}</text>
    </svg>
  </article>`;
}

function renderCoinChart(rows: CoinBreakdown[]): string {
  const shown = rows.filter((row) => row.positions > 0);
  if (shown.length === 0) return `<p class="empty">No coin-type rows.</p>`;
  const width = 720;
  const rowH = 28;
  const height = 36 + shown.length * rowH;
  const left = 210;
  const right = 16;
  const max = Math.max(...shown.map((row) => Math.abs(row.vsCashUsd)), 1);
  const mid = left + (width - left - right) / 2;
  const scale = (width - left - right) / 2 / max;
  const bars = shown.map((row, index) => {
    const y = 28 + index * rowH;
    const w = Math.abs(row.vsCashUsd) * scale;
    const x = row.vsCashUsd >= 0 ? mid : mid - w;
    const color = row.vsCashUsd >= 0 ? "#3ecf8e" : "#ff6d7a";
    const label = `${row.book} · ${row.coinType}`;
    return `<text x="${left - 8}" y="${y + 12}" fill="#93a0b0" font-size="11" text-anchor="end">${esc(label)}</text><rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(w, 1).toFixed(1)}" height="16" fill="${color}" rx="3"><title>${esc(label)} ${usd(row.vsCashUsd)}</title></rect>`;
  }).join("");
  return `<div class="panel" style="margin-bottom:12px"><div class="kicker">Versus cash</div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Versus cash by coin type">${bars}<line x1="${mid}" y1="20" x2="${mid}" y2="${height - 8}" stroke="#2a3544"/></svg></div>`;
}

function renderCoinTable(rows: CoinBreakdown[]): string {
  if (rows.length === 0) return `<p class="empty">No positions.</p>`;
  const body = rows.map((row) => `<tr><td>${esc(row.book)}</td><td>${esc(row.coinType)}</td><td class="num">${row.positions}</td><td class="num">${row.open}</td><td class="num">${row.closed}</td><td class="num ${tone(row.vsCashUsd)}">${usd(row.vsCashUsd)}</td><td class="num ${tone(row.vsHoldUsd)}">${usd(row.vsHoldUsd)}</td><td class="num">${row.positions === 0 ? "—" : pct(row.wins / row.positions)}</td></tr>`).join("");
  return `<div class="scroll"><table><thead><tr><th>Book</th><th>Coin type</th><th class="num">Positions</th><th class="num">Open</th><th class="num">Closed</th><th class="num">Vs cash</th><th class="num">Vs hold</th><th class="num">Win rate</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderH12Table(rows: H12DashRow[]): string {
  if (rows.length === 0) return `<p class="empty">No H12 trial positions.</p>`;
  const body = rows.map((row) => `<tr><td>${esc(row.pool)}</td><td>${esc(row.coinType)}</td><td>${esc(stamp(row.entry))}</td><td class="num">${row.width}</td><td><span class="pill ${row.status}">${row.status}</span></td><td class="num ${tone(row.crossedPnlUsd)}">${usd(row.crossedPnlUsd)}</td><td class="num ${tone(row.activePnlUsd)}">${usd(row.activePnlUsd)}</td><td class="num">${usd(row.costsUsd)}</td><td>${esc(row.exitReason || "—")}</td></tr>`).join("");
  return `<label class="filter">Filter <input type="search" data-filter="h12-table" placeholder="Pool or coin type"></label><div class="scroll"><table id="h12-table"><thead><tr><th>Pool</th><th>Coin type</th><th>Entry</th><th class="num">Width</th><th>Status</th><th class="num">PnL crossed-bin</th><th class="num">PnL active-bin</th><th class="num">Costs</th><th>Exit reason</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderLeaders(rows: LeaderRow[]): string {
  if (rows.length === 0) return `<p class="empty">No leaderboard.csv next to the reports directory.</p>`;
  const body = rows.map((row) => `<tr><td>${esc(row.coinType)}</td><td><code>${esc(row.strategyId)}</code></td><td class="num">${pct(row.trainMedian)}</td><td class="num">${pct(row.testMedian)}</td><td class="num">${row.holdoutN}</td><td class="num">${pct(row.holdoutMedian)}</td><td class="num ${tone(row.holdoutVsHold)}">${usd(row.holdoutVsHold)}</td><td>${row.promoted ? "yes" : ""}</td></tr>${row.note ? `<tr><td colspan="8" style="color:#93a0b0;white-space:normal">${esc(row.note)}</td></tr>` : ""}`).join("");
  return `<div class="scroll"><table><thead><tr><th>Coin type</th><th>Strategy</th><th class="num">Train median</th><th class="num">Time-test median</th><th class="num">Holdout n</th><th class="num">Holdout median</th><th class="num">Holdout vs hold</th><th>Promoted</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderRugs(rows: RugRow[]): string {
  if (rows.length === 0) return `<p class="empty">No rug rejects in the daily or H12 reports.</p>`;
  const body = rows.map((row) => `<tr><td>${esc(row.pool)}</td><td>${esc(row.bucket || "—")}</td><td>${esc(row.kind)}</td><td style="white-space:normal">${esc(row.reasons)}</td><td>${esc(row.source)}</td></tr>`).join("");
  return `<label class="filter">Filter <input type="search" data-filter="rug-table" placeholder="Pool or reason"></label><div class="scroll"><table id="rug-table"><thead><tr><th>Pool</th><th>Coin type</th><th>Kind</th><th>Reasons</th><th>Source</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderRecorder(health: RecorderHealth): string {
  if (!health.present) {
    return `<article class="panel"><p class="empty">${esc(health.note)}</p></article>`;
  }
  return `<article class="panel"><p class="note">${esc(health.path ?? "")}</p><p class="note">${esc(health.note)}</p>
    <dl>
      <dt>swaps</dt><dd>${health.swaps ?? "—"}</dd>
      <dt>snapshots</dt><dd>${health.snapshots ?? "—"}</dd>
      <dt>liquidity events</dt><dd>${health.liquidity ?? "—"}</dd>
      <dt>pools</dt><dd>${health.pools ?? "—"}</dd>
      <dt>drops</dt><dd>${health.drops === null ? "not stored" : health.drops}</dd>
      <dt>credits</dt><dd>${health.credits === null ? "—" : health.credits.toFixed(1)}</dd>
      <dt>rpc / websocket credits</dt><dd>${health.rpcCredits ?? "—"} / ${health.wsCredits === null ? "—" : health.wsCredits.toFixed(1)}</dd>
      <dt>credit hours</dt><dd>${health.creditHours ?? "—"}</dd>
      <dt>last swap</dt><dd>${health.lastSwapAt ? esc(stamp(health.lastSwapAt)) : "—"}</dd>
      <dt>last snapshot</dt><dd>${health.lastSnapshotAt ? esc(stamp(health.lastSnapshotAt)) : "—"}</dd>
    </dl></article>`;
}

function emptyRecorder(path: string | null, note: string): RecorderHealth {
  return {
    present: false,
    path,
    note,
    pools: null,
    swaps: null,
    snapshots: null,
    liquidity: null,
    drops: null,
    credits: null,
    rpcCredits: null,
    wsCredits: null,
    creditHours: null,
    lastSwapAt: null,
    lastSnapshotAt: null,
  };
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

function scalar(db: DatabaseSync, sql: string): number | null {
  const row = db.prepare(sql).get() as { t: number | null };
  return row.t ?? null;
}

function splitTable(line: string): string[] {
  return line.split("|").slice(1, -1).map((cell) => cell.trim());
}

function num(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function usd(value: number): string {
  const sign = value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compactUsd(value: number): string {
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(0)}k`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function tone(value: number): string {
  if (value > 0.005) return "pos";
  if (value < -0.005) return "neg";
  return "flat";
}

function stamp(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return stampMs(parsed);
}

function stampMs(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function defaultDashboardPaths(reportsDir: string, recorderDb?: string, nowMs?: number): DashboardPaths {
  return {
    reportsDir,
    h12BookPath: join(process.cwd(), H12_TRIAL_BOOK),
    frozenBookPath: join(process.cwd(), "data/frozen-high-vol-forward.json"),
    forwardPath: join(process.cwd(), "data/tournament-forward.json"),
    recorderDb,
    nowMs,
  };
}

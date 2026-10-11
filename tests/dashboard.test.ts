import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openPaperPosition } from "../src/executor/paper.js";
import {
  buildDashboard,
  drawdownOf,
  equityCurve,
  parseRugRejects,
  readRecorderHealth,
  renderDashboardHtml,
  writeDashboard,
} from "../src/tournament/dashboard.js";
import { archiveClosedGridPositions, emptyForwardBook, saveForwardBook } from "../src/tournament/forward.js";
import { pool } from "./fixtures.js";

const strategy = {
  id: "grid-spot",
  name: "Spot",
  description: "paper",
  placeholder: false,
  placeholderNote: "",
  docs: [],
  notes: "",
  product: "dlmm" as const,
  shape: "Spot" as const,
  binsBelow: 2,
  binsAbove: 2,
  sidedness: "two-sided" as const,
  quoteSide: "two-sided" as const,
  coinType: null,
  priority: 0,
  manualOnly: true,
  requires: {},
  when: [],
  exit: {
    onOutOfRange: "close" as const,
    rebalanceEdgeBins: 0,
    stopLossPct: 0.18,
    takeProfitPct: null,
    maxHoldHours: null,
    outOfRangeTimeoutHours: 96,
  },
};

describe("dashboard equity", () => {
  it("books deposits at entry and nets at the mark, then measures the drop", () => {
    const points = equityCurve([
      { openMs: 0, markMs: 10_000, deposit: 100, net: -20 },
      { openMs: 5_000, markMs: 5_000, deposit: 100, net: 10 },
    ]);
    expect(points.map((point) => point.equityUsd)).toEqual([100, 200, 210, 190]);
    expect(drawdownOf(points)).toEqual({ usd: 20, pct: 20 / 210 });
  });
});

describe("dashboard page", () => {
  it("writes a self-contained paper page and escapes pool names", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dash-"));
    const market = pool({ name: "<script>", binStep: 20, currentPrice: 2, tvlUsd: 50_000, address: "pool-a" });
    const opened = openPaperPosition({ pool: market, strategy, sizeUsd: 250, nowMs: Date.UTC(2026, 9, 10, 15) });
    opened.updatedAt = new Date(Date.UTC(2026, 9, 10, 16)).toISOString();
    const reports = join(dir, "reports");
    mkdirSync(reports, { recursive: true });
    writeFileSync(join(dir, "h12.json"), JSON.stringify({
      updatedAt: opened.updatedAt,
      status: "trial, not promoted",
      parameterHash: "abc123abc123abc123",
      solPriceUsd: 100,
      slots: [{
        position: opened,
        coinType: "older-memecoin",
        binsEachSide: 4,
        crossedBinFeesUsd: 1,
        activeBinFeesUsd: 3,
        entryScore: 1,
        entrySigma: 0.1,
        entryFeeYield: 0.01,
        entryTvlUsd: 50_000,
      }],
    }));
    writeFileSync(join(reports, "leaderboard.csv"), [
      "coin_type,strategy_id,train_median_return,test_median_return,holdout_n,holdout_median_return,holdout_mean_vs_hodl_usd,promoted",
      "stable,grid-spot,0.01,0.02,4,0.03,1.5,false",
    ].join("\n"));
    writeFileSync(join(reports, "leaderboard.md"), "Generated 2026-10-10T12:00:00.000Z.\n\n## stable\n\nNothing promoted.\n\n| Rank |\n");
    writeFileSync(join(reports, "h12-trial-2026-10-10.md"), [
      "## Rug checker: H12 trial opens",
      "",
      "| Pool | Kind | Reasons |",
      "| --- | --- | --- |",
      "| BAD-SOL | rejected | TVL is below the floor |",
      "| OK-SOL | passed | |",
    ].join("\n"));
    const dbPath = join(dir, "recorder.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE pools (address TEXT);
      CREATE TABLE swaps (received_at INTEGER);
      CREATE TABLE snapshots (taken_at INTEGER);
      CREATE TABLE liquidity (received_at INTEGER);
      CREATE TABLE credit_hours (rpc_credits INTEGER, ws_bytes INTEGER);
      CREATE TABLE meta (key TEXT, value TEXT);
      INSERT INTO pools VALUES ('p');
      INSERT INTO swaps VALUES (1790000000000);
      INSERT INTO snapshots VALUES (1790000001000);
      INSERT INTO credit_hours VALUES (10, 50000);
      INSERT INTO meta VALUES ('dropped_messages', '4');
    `);
    db.close();
    const file = await writeDashboard({
      reportsDir: reports,
      h12BookPath: join(dir, "h12.json"),
      frozenBookPath: join(dir, "missing-frozen.json"),
      forwardPath: join(dir, "missing-forward.json"),
      recorderDb: dbPath,
      nowMs: Date.UTC(2026, 9, 10, 18),
      offline: true,
    });
    const html = readFileSync(file, "utf8");
    expect(html).toContain("PAPER TRADING - NOT REAL MONEY");
    expect(html).toContain("Last updated 2026-10-10 18:00 UTC");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("trial, not promoted");
    expect(html.toLowerCase().includes("cdn.")).toBe(false);
    expect(html.includes("https://")).toBe(false);
    expect(html).toContain("BAD-SOL");
    expect(html).not.toContain("OK-SOL");
    expect(html).toContain("grid-spot");
    expect(html).toContain("drops");
    expect(html).toContain(">4<");
    const health = readRecorderHealth(join(dir, "nope.sqlite"));
    expect(health.present).toBe(false);
  });

  it("parses rug tables and keeps api failures", () => {
    const rows = parseRugRejects([
      "## Rug checker: New challenger pools",
      "| Pool | Bucket | Kind | Reasons |",
      "| --- | --- | --- | --- |",
      "| cbBTC-SOL | bluechip | rejected | freeze authority |",
      "| PYUSD-USDC | stable | passed | |",
    ].join("\n"), "daily/2026-10-10.md");
    expect(rows).toEqual([{
      source: "daily/2026-10-10.md: Rug checker: New challenger pools",
      pool: "cbBTC-SOL",
      bucket: "bluechip",
      kind: "rejected",
      reasons: "freeze authority",
    }]);
  });
});

describe("dashboard archive", () => {
  it("keeps archived closed grid positions in the book totals", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dash-archive-"));
    const market = pool({ name: "ARCHIVED-COIN", binStep: 20, currentPrice: 2, tvlUsd: 50_000, address: "pool-arch" });
    const opened = openPaperPosition({ pool: market, strategy, sizeUsd: 250, nowMs: Date.UTC(2026, 9, 10, 15) });
    opened.status = "closed";
    opened.closeReason = "stop-loss";
    const book = emptyForwardBook(Date.UTC(2026, 9, 11), 250);
    book.pools.push({ coinType: "fresh-memecoin", address: market.address, name: market.name });
    book.positions.push(opened);
    const archiveDir = join(dir, "archive");
    archiveClosedGridPositions(book, archiveDir, Date.UTC(2026, 9, 11));
    const forwardPath = join(dir, "forward.json");
    saveForwardBook(forwardPath, book);
    const reports = join(dir, "reports");
    mkdirSync(reports, { recursive: true });
    const model = await buildDashboard({
      reportsDir: reports,
      h12BookPath: join(dir, "missing-h12.json"),
      frozenBookPath: join(dir, "missing-frozen.json"),
      forwardPath,
      nowMs: Date.UTC(2026, 9, 11, 8),
      offline: true,
    });
    const grid = model.books.find((item) => item.id === "grid");
    expect(grid?.positions).toBe(1);
    expect(grid?.closed).toBe(1);
    expect(grid?.open).toBe(0);
    expect(grid?.depositedUsd).toBe(250);
    expect(book.positions).toHaveLength(0);
  });
});

describe("dashboard render", () => {
  it("shows an empty recorder when no path is given", () => {
    const html = renderDashboardHtml({
      generatedAt: "2026-10-10T00:00:00.000Z",
      books: [],
      h12Rows: [],
      coins: [],
      leaderboardGeneratedAt: null,
      leaderboard: [],
      rugs: [],
      recorder: readRecorderHealth(undefined),
      quotes: { quoted: 0, fallback: 0, fetchedAt: null },
    });
    expect(html).toContain("No recorder sqlite");
    expect(html).toContain("PAPER TRADING - NOT REAL MONEY");
  });
});

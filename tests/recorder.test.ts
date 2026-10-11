import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DLMM_PROGRAM_ID } from "../src/constants.js";
import { creditsFromRpcBody, DEFAULT_RPC_RPS, projectedMonthCredits, reservedSnapshotCredits, wsCredits } from "../src/recorder/budget.js";
import { ANCHOR_EVENT_CPI, decodeDlmmEvents, decodeEventBytes, selectTracked } from "../src/recorder/decode.js";
import { eventsFromTransaction } from "../src/recorder/txEvents.js";
import { exportRecorder } from "../src/recorder/export.js";
import { CreditMeter, formatHour } from "../src/recorder/meter.js";
import { humanPrice, swapsToCandles } from "../src/recorder/prices.js";
import type { TrackedPool } from "../src/recorder/pools.js";
import { redact } from "../src/recorder/redact.js";
import { nextWebsocketAddresses, noisiestAddresses, parseWsBuckets, poolsForWebsocket } from "../src/recorder/wsFilter.js";
import { addressesFromText, loadWsAddresses, loadWsTracked } from "../src/recorder/wsPools.js";
import { packBins } from "../src/recorder/snapshot.js";
import { liquidityRow, openStore, swapRow } from "../src/recorder/store.js";

const require = createRequire(import.meta.url);

function encodeEvent(name: string, fields: Record<string, unknown>): string {
  const anchor = require("@coral-xyz/anchor") as { BorshCoder: new (idl: unknown) => { events: { layouts: Map<string, { discriminator: number[]; layout: { encode: (value: unknown, buffer: Buffer) => number; span: number } }> } } };
  const { IDL } = require("@meteora-ag/dlmm") as { IDL: unknown };
  const coder = new anchor.BorshCoder(IDL);
  const layout = coder.events.layouts.get(name);
  if (!layout) throw new Error(`missing ${name}`);
  const body = Buffer.alloc(layout.layout.span);
  layout.layout.encode(fields, body);
  return Buffer.concat([Buffer.from(layout.discriminator), body]).toString("base64");
}

function logsFor(base64: string): string[] {
  return [
    `Program ${DLMM_PROGRAM_ID} invoke [1]`,
    `Program data: ${base64}`,
    `Program ${DLMM_PROGRAM_ID} success`,
  ];
}

const POOL = "11111111111111111111111111111111";
const TRADER = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

describe("recorder decode", () => {
  it("reads Swap2Evt trader, bins, amounts, and the LP fee token", () => {
    const { PublicKey } = require("@solana/web3.js") as { PublicKey: new (value: string) => unknown };
    const BN = require("bn.js") as new (value: number) => unknown;
    const events = decodeDlmmEvents(logsFor(encodeEvent("Swap2Evt", {
      lb_pair: new PublicKey(POOL),
      from: new PublicKey(TRADER),
      start_bin_id: -4,
      end_bin_id: 6,
      swap_for_y: true,
      fee_bps: new BN(100),
      amount_in: new BN(5_000),
      amount_left: new BN(20),
      amount_out: new BN(4_800),
      mm_fee: new BN(50),
      protocol_fee: new BN(5),
      limit_order_fee: new BN(1),
      host_fee: new BN(0),
      fees_on_input: true,
      fees_on_token_x: true,
    })));
    expect(events).toHaveLength(1);
    const swap = events[0];
    expect(swap?.kind).toBe("swap");
    if (swap?.kind !== "swap") return;
    expect(swap.trader).toBe(TRADER);
    expect(swap.startBin).toBe(-4);
    expect(swap.endBin).toBe(6);
    expect(swap.amountIn).toBe("5000");
    expect(swap.amountOut).toBe("4800");
    expect(swap.fee).toBe("50");
    expect(swap.protocolFee).toBe("5");
    expect(swap.feeToken).toBe("x");
    expect(selectTracked(events, new Set([POOL]))).toHaveLength(1);
    expect(selectTracked(events, new Set(["other"]))).toHaveLength(0);
  });

  it("skips a Program success log that empties Anchor's stack", () => {
    expect(decodeDlmmEvents(["Program 11111111111111111111111111111111 success"])).toEqual([]);
  });

  it("keeps the LP slice of a legacy Swap and decodes add liquidity", () => {
    const { PublicKey } = require("@solana/web3.js") as { PublicKey: new (value: string) => unknown };
    const BN = require("bn.js") as new (value: number) => unknown;
    const swap = decodeDlmmEvents(logsFor(encodeEvent("Swap", {
      lb_pair: new PublicKey(POOL),
      from: new PublicKey(TRADER),
      start_bin_id: 1,
      end_bin_id: 2,
      amount_in: new BN(10),
      amount_out: new BN(9),
      swap_for_y: false,
      fee: new BN(100),
      protocol_fee: new BN(10),
      fee_bps: new BN(25),
      host_fee: new BN(2),
    })));
    expect(swap[0]?.kind).toBe("swap");
    if (swap[0]?.kind === "swap") expect(swap[0].fee).toBe("90");
    const add = decodeDlmmEvents(logsFor(encodeEvent("AddLiquidity", {
      lb_pair: new PublicKey(POOL),
      from: new PublicKey(TRADER),
      position: new PublicKey(POOL),
      amounts: [new BN(3), new BN(4)],
      active_bin_id: 8,
    })));
    expect(add[0]?.kind).toBe("liquidity");
    if (add[0]?.kind === "liquidity") {
      expect(add[0].action).toBe("add");
      expect(add[0].amountX).toBe("3");
      expect(add[0].amountY).toBe("4");
      expect(add[0].activeBin).toBe(8);
    }
  });
});

describe("cpi event bytes", () => {
  it("decodes Swap2 after the Anchor event CPI prefix", () => {
    const { PublicKey } = require("@solana/web3.js") as { PublicKey: new (value: string) => unknown };
    const BN = require("bn.js") as new (value: number) => unknown;
    const body = Buffer.from(encodeEvent("Swap2Evt", {
      lb_pair: new PublicKey(POOL),
      from: new PublicKey(TRADER),
      start_bin_id: 4,
      end_bin_id: 9,
      swap_for_y: false,
      fee_bps: new BN(10),
      amount_in: new BN(7),
      amount_left: new BN(0),
      amount_out: new BN(6),
      mm_fee: new BN(2),
      protocol_fee: new BN(1),
      limit_order_fee: new BN(0),
      host_fee: new BN(0),
      fees_on_input: false,
      fees_on_token_x: false,
    }), "base64");
    const wrapped = Buffer.concat([ANCHOR_EVENT_CPI, body]);
    const event = decodeEventBytes(wrapped);
    expect(event?.name).toBe("Swap2Evt");
    const decoded = eventsFromTransaction({
      meta: { innerInstructions: [{ instructions: [{ programIdIndex: 0, data: wrapped }] }] },
      transaction: {
        message: {
          getAccountKeys: () => ({ get: (index: number) => index === 0 ? { toBase58: () => "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo" } : undefined }),
          compiledInstructions: [],
        },
      },
    });
    expect(decoded[0]?.kind).toBe("swap");
    if (decoded[0]?.kind === "swap") expect(decoded[0].endBin).toBe(9);
  });
});

describe("recorder budget", () => {
  it("bills websocket bytes at 2 credits per 0.1 MB and getProgramAccounts at 10", () => {
    expect(wsCredits(100_000)).toBe(2);
    expect(wsCredits(0)).toBe(0);
    expect(creditsFromRpcBody(JSON.stringify({ method: "getAccountInfo" }))).toBe(1);
    expect(creditsFromRpcBody(JSON.stringify([{ method: "getProgramAccounts" }, { method: "getSlot" }]))).toBe(11);
    const noon = Date.UTC(2026, 9, 10);
    expect(projectedMonthCredits(100, noon, noon - 10 * 86_400_000)).toBeCloseTo(300);
    const reserved = reservedSnapshotCredits({
      pools: 2,
      snapshotMinutes: 15,
      rpcPerSnapshot: 2,
      nowMs: Date.UTC(2026, 9, 10, 23, 50),
    });
    expect(reserved).toBeGreaterThan(0);
    expect(reserved).toBeLessThan(20);
  });

  it("redacts an api key and does not require the secret to be printed", () => {
    const secret = "11111111-2222-3333-4444-555555555555";
    const line = redact(`wss://mainnet.helius-rpc.com/?api-key=${secret}`, secret);
    expect(line).not.toContain(secret);
    expect(line).toContain("api-key=REDACTED");
  });
});

describe("recorder store and export", () => {
  it("dedupes a swap and folds two hours into candles", () => {
    const dir = mkdtempSync(join(tmpdir(), "recorder-"));
    const store = openStore(join(dir, "recorder.sqlite"));
    const pool = samplePool();
    store.upsertPools([pool]);
    const event = {
      kind: "swap" as const,
      index: 0,
      event: "Swap2Evt" as const,
      pool: pool.address,
      trader: TRADER,
      startBin: 100,
      endBin: 110,
      swapForY: false,
      amountIn: "2000000",
      amountOut: "1000",
      amountLeft: "0",
      fee: "1000000",
      protocolFee: "100000",
      limitOrderFee: "0",
      hostFee: "0",
      feeBps: "100",
      feesOnInput: true,
      feesOnTokenX: false,
      feeToken: "y" as const,
    };
    const first = swapRow(event, "sig", 10, 1_700_000_000_000, 1_700_000_000);
    const again = swapRow(event, "sig", 10, 1_700_000_000_000, 1_700_000_000);
    expect(store.insertSwap(first)).toBe(true);
    expect(store.insertSwap(again)).toBe(false);
    const later = swapRow({ ...event, index: 0, endBin: 90, fee: "500000" }, "sig-2", 11, 1_700_003_600_000, 1_700_003_600);
    expect(store.insertSwap(later)).toBe(true);
    store.insertLiquidity(liquidityRow({
      kind: "liquidity",
      index: 0,
      action: "remove",
      pool: pool.address,
      trader: TRADER,
      position: POOL,
      amountX: "1",
      amountY: "2",
      activeBin: 100,
    }, "sig-liq", 12, 1_700_000_100_000, 1_700_000_100));
    store.insertSnapshot(pool.address, 1_700_000_000_000, 10, 100, pool.binStep, packBins([
      { binId: 100, xAmount: { toString: () => "5" }, yAmount: { toString: () => "0" } },
      { binId: 101, xAmount: { toString: () => "0" }, yAmount: { toString: () => "0" } },
    ]));
    const candles = swapsToCandles(store.swapsFor(pool.address).map((row) => ({
      timeSec: row.blockTime ?? 0,
      startBin: row.startBin,
      endBin: row.endBin,
      swapForY: row.swapForY,
      amountIn: row.amountIn,
      fee: row.fee,
      feeToken: row.feeToken,
    })), pool);
    expect(candles).toHaveLength(2);
    expect(candles[0]?.lpFeesUsd).toBeCloseTo(1);
    expect(candles[0]?.volumeUsd).toBeCloseTo(2);
    expect(candles[1]?.lpFeesUsd).toBeCloseTo(0.5);
    expect(candles[0]?.high).toBeGreaterThan(candles[0]?.low ?? 0);
    store.close();
    const files = exportRecorder(join(dir, "recorder.sqlite"), join(dir, "export"));
    expect(files).toHaveLength(1);
  });
});

describe("credit hour line", () => {
  it("includes rpc credits and websocket credits", () => {
    const now = Date.UTC(2026, 9, 10, 13);
    const line = formatHour({
      hourStart: Date.UTC(2026, 9, 10, 13),
      rpcCalls: 4,
      rpcCredits: 4,
      wsMessages: 2,
      wsBytes: 100_000,
    }, 10, 32_000, now, now - 10 * 86_400_000);
    expect(line).toContain("rpc_credits=4");
    expect(line).toContain("ws_credits=2.00");
    expect(line).toContain("daily_cap=32000");
    expect(line).toContain("monthly_cap=1000000");
    expect(line).toContain("projected_month=30");
    expect(line).toContain("projected_from_hour=4320");
    expect(DEFAULT_RPC_RPS).toBe(4);
  });

  it("projects the month from the recording span, not the calendar day", () => {
    const now = Date.UTC(2026, 9, 11, 8);
    const since = Date.UTC(2026, 9, 10, 0);
    expect(projectedMonthCredits(36_000, now, since)).toBeCloseTo(810_000);
    expect(projectedMonthCredits(36_000, now)).not.toBeCloseTo((36_000 / 11) * 30);
  });

  it("labels the daily cap separately from month-to-date", () => {
    const dir = mkdtempSync(join(tmpdir(), "credits-"));
    const store = openStore(join(dir, "recorder.sqlite"));
    const since = Date.UTC(2026, 9, 10, 0);
    store.saveHour({ hourStart: since, rpcCalls: 36_000, rpcCredits: 36_000, wsMessages: 0, wsBytes: 0 });
    const now = Date.UTC(2026, 9, 11, 8);
    const meter = new CreditMeter(store, 32_000, () => undefined, now);
    const line = meter.snapshotLine(now);
    expect(line).toContain("daily_cap=32000");
    expect(line).toContain("month_to_date=36000.0");
    expect(line).toContain("monthly_cap=1000000");
    expect(line).toContain("projected_month=810000");
    expect(line.includes(" cap=")).toBe(false);
    expect(line.includes(" month=")).toBe(false);
    store.setDroppedCount(7);
    expect(store.droppedCount()).toBe(7);
    store.close();
  });
});

describe("websocket volume", () => {
  it("streams the H12 book's open pools and refreshes that set", () => {
    const open = "So11111111111111111111111111111111111111112";
    const closed = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const extra = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
    const book = {
      kind: "h12-trial",
      slots: [
        { coinType: "older-memecoin", position: { status: "open", poolAddress: open, poolName: "OPEN-SOL", binStep: 80 } },
        { coinType: "older-memecoin", position: { status: "closed", poolAddress: closed, poolName: "CLOSED-SOL", binStep: 80 } },
      ],
    };
    expect(addressesFromText(JSON.stringify(book))).toEqual([open]);
    expect(addressesFromText(`${open},${extra}`)).toEqual([open, extra]);
    const dir = mkdtempSync(join(tmpdir(), "ws-pools-"));
    const path = join(dir, "h12.json");
    writeFileSync(path, JSON.stringify(book));
    expect(loadWsAddresses(path)).toEqual([open]);
    expect(loadWsTracked(path).map((pool) => pool.name)).toEqual(["OPEN-SOL"]);
    const tracked = ["snap-only", open];
    expect(nextWebsocketAddresses({
      mode: "mentions",
      all: tracked,
      bucketFiltered: tracked,
      explicit: loadWsAddresses(path),
      dropped: new Set(),
    })).toEqual([open]);
    writeFileSync(path, JSON.stringify({
      ...book,
      slots: [...book.slots, { coinType: "bluechip", position: { status: "open", poolAddress: extra, poolName: "NEW-SOL", binStep: 10 } }],
    }));
    expect(nextWebsocketAddresses({
      mode: "mentions",
      all: tracked,
      bucketFiltered: tracked,
      explicit: loadWsAddresses(path),
      dropped: new Set([open]),
    })).toEqual([extra]);
  });

  it("keeps only named buckets and ranks the loudest pools", () => {
    const parsed = parseWsBuckets("stable, no-such, bluechip");
    expect(parsed.unknown).toEqual(["no-such"]);
    expect(parseWsBuckets(undefined).buckets).toBeNull();
    expect(parseWsBuckets("all").buckets).toBeNull();
    const stable = samplePool();
    const meme = { ...samplePool(), address: TRADER, name: "MEME-SOL", coinType: "fresh-memecoin" as const };
    const streamed = poolsForWebsocket([stable, meme], parsed);
    expect(streamed.map((pool) => pool.address)).toEqual([POOL]);
    const loud = noisiestAddresses([
      [POOL, 100],
      [TRADER, 5_000],
      ["quiet", 0],
    ], 1);
    expect(loud).toEqual([{ address: TRADER, bytes: 5_000 }]);
  });
});

function samplePool(): TrackedPool {
  return {
    address: POOL,
    name: "USDC-USDT",
    coinType: "stable",
    binStep: 1,
    mintX: "x",
    mintY: "y",
    symbolX: "USDC",
    symbolY: "USDT",
    decimalsX: 6,
    decimalsY: 6,
    priceUsdX: 1,
    priceUsdY: 1,
    tvlUsd: 10_000,
    baseFeePct: 0.01,
    dynamicFeePct: 0,
    protocolFeePct: 10,
    currentPrice: 1,
    addedAtMs: 0,
  };
}

describe("human price", () => {
  it("scales the raw bin price by token decimals", () => {
    expect(humanPrice(0, 1, 9, 6)).toBeCloseTo(1000);
  });
});

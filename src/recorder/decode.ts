import { createRequire } from "node:module";
import { DLMM_PROGRAM_ID } from "../constants.js";

const require = createRequire(import.meta.url);

export interface DecodedSwap {
  kind: "swap";
  index: number;
  event: "Swap" | "Swap2Evt";
  pool: string;
  trader: string;
  startBin: number;
  endBin: number;
  swapForY: boolean;
  amountIn: string;
  amountOut: string;
  amountLeft: string | null;
  fee: string;
  protocolFee: string;
  limitOrderFee: string | null;
  hostFee: string | null;
  feeBps: string | null;
  feesOnInput: boolean | null;
  feesOnTokenX: boolean | null;
  /** Token the LP fee amount is denominated in. */
  feeToken: "x" | "y";
}

export interface DecodedLiquidity {
  kind: "liquidity";
  index: number;
  action: "add" | "remove";
  pool: string;
  trader: string;
  position: string;
  amountX: string;
  amountY: string;
  activeBin: number;
}

export type DecodedEvent = DecodedSwap | DecodedLiquidity;

interface AnchorEvent {
  name: string;
  data: Record<string, unknown>;
}

interface EventParserLike {
  parseLogs: (logs: string[]) => Iterable<AnchorEvent | null>;
}

/** Anchor `emit_cpi!` prefixes the event with this 8-byte instruction discriminator. */
export const ANCHOR_EVENT_CPI = Buffer.from([228, 69, 165, 46, 81, 203, 154, 29]);

interface EventCoder {
  events: { decode: (log: string) => AnchorEvent | null };
}

let parser: EventParserLike | null = null;
let coder: EventCoder | null = null;

function loadAnchor(): { coder: EventCoder; parser: EventParserLike } {
  if (parser && coder) return { coder, parser };
  const anchor = require("@coral-xyz/anchor") as {
    BorshCoder: new (idl: unknown) => EventCoder;
    EventParser: new (programId: unknown, coder: unknown) => EventParserLike;
    web3: { PublicKey: new (value: string) => unknown };
  };
  const dlmm = require("@meteora-ag/dlmm") as { IDL: unknown };
  coder = new anchor.BorshCoder(dlmm.IDL);
  parser = new anchor.EventParser(new anchor.web3.PublicKey(DLMM_PROGRAM_ID), coder);
  return { coder, parser };
}

function eventParser(): EventParserLike {
  return loadAnchor().parser;
}

/**
 * Decode one DLMM event blob. Swap2 is emitted with `emit_cpi!`, so the
 * event bytes sit after the Anchor CPI discriminator inside the inner instruction.
 */
export function decodeEventBytes(bytes: Buffer): AnchorEvent | null {
  const events = loadAnchor().coder.events;
  const direct = events.decode(bytes.toString("base64"));
  if (direct) return direct;
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(ANCHOR_EVENT_CPI)) {
    return events.decode(bytes.subarray(8).toString("base64"));
  }
  return null;
}

const KEPT = new Set(["Swap", "Swap2Evt", "AddLiquidity", "RemoveLiquidity"]);

/**
 * Decode Anchor `Program data:` events emitted by the DLMM program.
 * The coder is the SDK's IDL, so Swap2Evt field names match the program.
 */
export function decodeDlmmEvents(logs: string[]): DecodedEvent[] {
  if (logs.length === 0) return [];
  const out: DecodedEvent[] = [];
  let index = 0;
  for (const event of eventParser().parseLogs(logs)) {
    if (!event || !KEPT.has(event.name)) continue;
    const decoded = normalize(event, index);
    if (decoded) {
      out.push(decoded);
      index += 1;
    }
  }
  return out;
}

export function selectTracked(events: DecodedEvent[], tracked: Set<string>): DecodedEvent[] {
  return events.filter((event) => tracked.has(event.pool));
}

export function eventFromAnchor(event: AnchorEvent, index: number): DecodedEvent | null {
  return normalize(event, index);
}

function normalize(event: AnchorEvent, index: number): DecodedEvent | null {
  const data = event.data;
  if (event.name === "Swap" || event.name === "Swap2Evt") return normalizeSwap(event.name, data, index);
  if (event.name === "AddLiquidity" || event.name === "RemoveLiquidity") {
    const amounts = asPair(data.amounts);
    return {
      kind: "liquidity",
      index,
      action: event.name === "AddLiquidity" ? "add" : "remove",
      pool: pubkey(data.lb_pair),
      trader: pubkey(data.from),
      position: pubkey(data.position),
      amountX: amounts[0],
      amountY: amounts[1],
      activeBin: asInt(data.active_bin_id),
    };
  }
  return null;
}

function normalizeSwap(name: "Swap" | "Swap2Evt", data: Record<string, unknown>, index: number): DecodedSwap {
  const swapForY = data.swap_for_y === true;
  if (name === "Swap2Evt") {
    const feesOnTokenX = data.fees_on_token_x === true;
    return {
      kind: "swap",
      index,
      event: name,
      pool: pubkey(data.lb_pair),
      trader: pubkey(data.from),
      startBin: asInt(data.start_bin_id),
      endBin: asInt(data.end_bin_id),
      swapForY,
      amountIn: bn(data.amount_in),
      amountOut: bn(data.amount_out),
      amountLeft: bn(data.amount_left),
      fee: bn(data.mm_fee),
      protocolFee: bn(data.protocol_fee),
      limitOrderFee: bn(data.limit_order_fee),
      hostFee: bn(data.host_fee),
      feeBps: bn(data.fee_bps),
      feesOnInput: data.fees_on_input === true,
      feesOnTokenX: feesOnTokenX,
      feeToken: feesOnTokenX ? "x" : "y",
    };
  }
  const fee = BigInt(bn(data.fee));
  const protocol = BigInt(bn(data.protocol_fee));
  const lp = fee >= protocol ? fee - protocol : fee;
  return {
    kind: "swap",
    index,
    event: name,
    pool: pubkey(data.lb_pair),
    trader: pubkey(data.from),
    startBin: asInt(data.start_bin_id),
    endBin: asInt(data.end_bin_id),
    swapForY,
    amountIn: bn(data.amount_in),
    amountOut: bn(data.amount_out),
    amountLeft: null,
    fee: lp.toString(),
    protocolFee: protocol.toString(),
    limitOrderFee: null,
    hostFee: bn(data.host_fee),
    feeBps: bn(data.fee_bps),
    feesOnInput: null,
    feesOnTokenX: null,
    feeToken: swapForY ? "x" : "y",
  };
}

function pubkey(value: unknown): string {
  if (value && typeof value === "object" && "toBase58" in value) {
    return (value as { toBase58: () => string }).toBase58();
  }
  return String(value ?? "");
}

function bn(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "toString" in value) {
    return (value as { toString: (radix?: number) => string }).toString(10);
  }
  return "0";
}

function asInt(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asPair(value: unknown): [string, string] {
  if (Array.isArray(value)) return [bn(value[0]), bn(value[1])];
  return ["0", "0"];
}

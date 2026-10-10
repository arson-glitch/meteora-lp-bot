import bs58 from "bs58";
import { DLMM_PROGRAM_ID } from "../constants.js";
import { decodeEventBytes, eventFromAnchor, type DecodedEvent } from "./decode.js";

interface InstructionLike {
  programIdIndex: number;
  data: Uint8Array | string;
}

interface AccountKeys {
  get: (index: number) => { toBase58: () => string } | undefined;
}

/**
 * Walk outer and inner instructions. Meteora's current Swap2 path does not
 * write `Program data:` into the log; the event is the self-CPI instruction.
 */
export function eventsFromTransaction(tx: {
  meta?: {
    innerInstructions?: Array<{ instructions: InstructionLike[] }> | null;
    loadedAddresses?: unknown;
  } | null;
  transaction: {
    message: {
      getAccountKeys: (args: { accountKeysFromLookups?: unknown }) => AccountKeys;
      compiledInstructions: InstructionLike[];
    };
  };
} | null): DecodedEvent[] {
  if (!tx?.meta) return [];
  let keys: AccountKeys;
  try {
    keys = tx.transaction.message.getAccountKeys({
      accountKeysFromLookups: tx.meta.loadedAddresses,
    });
  } catch {
    return [];
  }
  const found: DecodedEvent[] = [];
  const take = (ix: InstructionLike) => {
    const program = keys.get(ix.programIdIndex)?.toBase58();
    if (program !== DLMM_PROGRAM_ID) return;
    const bytes = instructionBytes(ix.data);
    if (!bytes) return;
    const event = decodeEventBytes(bytes);
    if (!event) return;
    const decoded = eventFromAnchor(event, found.length);
    if (decoded) found.push(decoded);
  };
  for (const ix of tx.transaction.message.compiledInstructions) take(ix);
  for (const group of tx.meta.innerInstructions ?? []) {
    for (const ix of group.instructions) take(ix);
  }
  return found;
}

function instructionBytes(data: Uint8Array | string): Buffer | null {
  if (typeof data === "string") {
    try {
      return Buffer.from(bs58.decode(data));
    } catch {
      return null;
    }
  }
  return Buffer.from(data);
}

import { resolve } from "node:path";
import { DEFAULT_RPC_RPS } from "./budget.js";
import { exportRecorder } from "./export.js";
import { defaultRecordOptions, runRecord, type RecordOptions } from "./run.js";
import type { WsMode } from "./subscribe.js";
import { redact } from "./redact.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "record";
  const flags = parseFlags(command === argv[0] ? argv.slice(1) : argv);
  if (command === "export") {
    const dir = flagString(flags, "dir") ?? resolve(process.cwd(), "data/recorder");
    const out = flagString(flags, "out") ?? resolve(dir, "export");
    const written = exportRecorder(resolve(dir, "recorder.sqlite"), out);
    console.log(`exported ${written.length} pools to ${out}`);
    return;
  }
  if (command !== "record") {
    console.error(`Unknown recorder command ${command}.\n${help()}`);
    process.exitCode = 1;
    return;
  }
  const smoke = flags.has("smoke");
  const options: RecordOptions = defaultRecordOptions({
    dir: flagString(flags, "dir") ?? (smoke ? resolve(process.cwd(), "data/recorder-smoke") : resolve(process.cwd(), "data/recorder")),
    refreshPools: flags.has("refresh-pools"),
    smoke,
    smokeSeconds: flagNumber(flags, "seconds") ?? 360,
    smokePools: flagNumber(flags, "smoke-pools") ?? 2,
    poolLimit: flagNumber(flags, "pools") ?? 160,
    rps: flagNumber(flags, "rps") ?? DEFAULT_RPC_RPS,
    snapshotMinutes: flagNumber(flags, "snapshot-minutes") ?? 15,
    binsEachSide: flagNumber(flags, "bins") ?? 80,
    dailyCap: flagNumber(flags, "daily-credit-cap") ?? 32_000,
    wsMode: flagString(flags, "ws") === "program" ? "program" : "mentions" satisfies WsMode,
    wsBuckets: flagString(flags, "ws-buckets"),
    wsDropNoisiest: flagNumber(flags, "ws-drop-noisiest") ?? 0,
    wsPools: flagString(flags, "ws-pools"),
    wsFromBook: flagString(flags, "ws-from-book"),
    backfillPerPool: flagNumber(flags, "backfill") ?? 15,
  });
  const counts = await runRecord(options);
  if (smoke) console.log(`smoke counts swaps=${counts.swaps} liquidity=${counts.liquidity} snapshots=${counts.snapshots}`);
}

function parseFlags(argv: string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags.set(key, true);
    else {
      flags.set(key, next);
      i += 1;
    }
  }
  return flags;
}

function flagString(flags: Map<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

function flagNumber(flags: Map<string, string | true>, key: string): number | undefined {
  const value = flagString(flags, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function help(): string {
  return [
    "Usage: tsx src/recorder/cli.ts record [flags]",
    "       tsx src/recorder/cli.ts export [flags]",
    "",
    "Read-only. Does not sign or send transactions.",
    "HELIUS_API_KEY is read from the environment and is never logged.",
    "",
    "Flags:",
    "  --refresh-pools          Rebuild data/recorder/pools.json from the tournament universe",
    "  --smoke                  Two busy pools, one snapshot, then exit",
    "  --seconds <n>            Smoke listen time (default 360)",
    "  --pools <n>              Max tracked pools (default 160)",
    "  --rps <n>                RPC cap, kept under the free 10/s (default 4)",
    "  --snapshot-minutes <n>   Bin snapshot interval (default 15)",
    "  --bins <n>               Bins each side of the active bin (default 80)",
    "  --daily-credit-cap <n>   Stop RPC and the socket at this estimate (default 32000)",
    "  --ws mentions|program    Per-pool logsSubscribe, or the whole DLMM program",
    "  --ws-buckets <list>      Coin types for the socket only (default all). Snapshots stay on every pool",
    "  --ws-pools <file|list>   Socket addresses. A path, or comma-separated pool addresses",
    "  --ws-from-book <path>    Socket = open pools in an H12 trial book. Reread each UTC hour",
    "  --ws-drop-noisiest <n>   Each UTC hour, unsubscribe the n loudest pools (default 0)",
    "  --dir <path>             Data directory",
    "  --out <path>             Export directory",
  ].join("\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redact(message, process.env.HELIUS_API_KEY));
  process.exitCode = 1;
});

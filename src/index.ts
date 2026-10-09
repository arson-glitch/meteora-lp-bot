import { resolve } from "node:path";
import { loadConfig, loadEnvFile } from "./config.js";
import { FileBookStore, emptyPaperBook } from "./executor/book.js";
import { createLogger } from "./logger.js";
import { createDefaultDeps, monitorPositions, runPipeline, type RunOptions } from "./pipeline.js";
import { renderBook, renderReport, renderScan } from "./report.js";
import { scanPools } from "./scanner/scanner.js";
import { loadStrategyBundle } from "./strategy/loader.js";
import { markForwardBook, summarizeForward } from "./tournament/forward.js";
import { runTournament } from "./tournament/run.js";
import type { PaperBook } from "./types.js";

interface Cli {
  command: string;
  fresh: boolean;
  horizonHours?: number;
  consider?: number;
  includeDamm: boolean;
  strategyId?: string;
  forceStrategy: boolean;
  confirmLive: boolean;
  scanLimit?: number;
  top: number;
  verbose: boolean;
  poolsPerBucket?: number;
  sizeUsd?: number;
  skipForward: boolean;
}

async function main(): Promise<void> {
  loadEnvFile();
  const cli = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const log = createLogger({ verbose: cli.verbose, pnlPath: config.pnlPath });
  const strategies = loadStrategyBundle(config.strategiesDir);
  const deps = createDefaultDeps(config, log, strategies);
  const bookStore = new FileBookStore<PaperBook>(config.bookPath, () => emptyPaperBook());

  if (cli.command === "help") {
    console.log(helpText());
    return;
  }
  if (cli.command === "book") {
    console.log(renderBook(bookStore.load()));
    return;
  }
  if (cli.command === "scan") {
    const ranked = await scanPools({
      scanLimit: cli.scanLimit ?? config.scanLimit,
      includeDamm: cli.includeDamm,
      enrichLimit: 12,
      birdeyeApiKey: config.birdeyeApiKey,
      nowMs: Date.now(),
      log,
    });
    console.log(renderScan(ranked, Date.now(), cli.top));
    return;
  }
  if (cli.command === "tournament") {
    const forwardPath = resolve(process.cwd(), "data/tournament-forward.json");
    const reportsDir = resolve(process.cwd(), "reports");
    const result = await runTournament({
      poolsPerBucket: cli.poolsPerBucket,
      sizeUsd: cli.sizeUsd,
      reportsDir,
      strategiesDir: config.strategiesDir,
      forwardPath,
      writeForward: !cli.skipForward,
      onProgress: (message) => console.log(message),
    });
    console.log("");
    for (const board of result.boards) {
      const winner = board.winner ? board.winner.strategyId : "not promoted";
      console.log(`${board.coinType}: ${winner}. ${board.promotionNote}`);
    }
    console.log(`\nTrials: ${result.trials}`);
    console.log(`Leaderboard: ${result.markdownPath}`);
    if (result.forward) console.log(summarizeForward(result.forward));
    return;
  }
  if (cli.command === "tournament-mark") {
    const forwardPath = resolve(process.cwd(), "data/tournament-forward.json");
    const book = await markForwardBook(forwardPath, Date.now());
    console.log(summarizeForward(book));
    console.log(`Forward book: ${forwardPath}`);
    return;
  }
  if (cli.command === "monitor") {
    const book = await monitorPositions(config, bookStore, deps, cli.horizonHours);
    console.log(renderBook(book));
    console.log(`\nPnL log: ${config.pnlPath}`);
    return;
  }
  if (cli.command !== "run") {
    console.error(`Unknown command ${cli.command}.\n${helpText()}`);
    process.exitCode = 1;
    return;
  }

  const options: RunOptions = {
    fresh: cli.fresh,
    horizonHours: cli.horizonHours ?? config.horizonHours,
    consider: cli.consider ?? config.consider,
    includeDamm: cli.includeDamm,
    strategyId: cli.strategyId,
    forceStrategy: cli.forceStrategy,
    confirmLive: cli.confirmLive,
    scanLimit: cli.scanLimit ?? config.scanLimit,
    enrichLimit: 12,
  };
  const report = await runPipeline(config, options, bookStore, deps);
  console.log(renderReport(report, Date.now(), cli.top));
  console.log(`\nStrategies loaded from ${config.strategiesDir}`);
  console.log(`Paper book: ${config.bookPath}`);
  console.log(`PnL log: ${resolve(config.pnlPath)}`);
}

function parseArgs(argv: string[]): Cli {
  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "run";
  const rest = argv[0] && !argv[0].startsWith("--") ? argv.slice(1) : argv;
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) flags.set(key, true);
    else {
      flags.set(key, next);
      i += 1;
    }
  }
  const num = (key: string): number | undefined => {
    const value = flags.get(key);
    if (typeof value !== "string") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    command,
    fresh: flags.get("fresh") === true,
    horizonHours: num("horizon-hours"),
    consider: num("consider"),
    includeDamm: flags.get("include-damm") === true,
    strategyId: typeof flags.get("strategy") === "string" ? String(flags.get("strategy")) : undefined,
    forceStrategy: flags.get("force-strategy") === true,
    confirmLive: flags.get("confirm-live") === true,
    scanLimit: num("scan-limit"),
    top: num("top") ?? 8,
    verbose: flags.get("verbose") === true,
    poolsPerBucket: num("pools-per-bucket"),
    sizeUsd: num("size-usd"),
    skipForward: flags.get("skip-forward") === true,
  };
}

function helpText(): string {
  return [
    "Usage: tsx src/index.ts <command> [flags]",
    "",
    "Commands:",
    "  run       Scan, rug-check, pick a strategy, paper-trade (default)",
    "  scan      Rank live DLMM pools and exit",
    "  monitor   Mark open paper positions against fresh pool data",
    "  book      Print the paper book",
    "  tournament       Backtest the strategy grid and open the forward paper book",
    "  tournament-mark  Mark the forward paper book against live pools",
    "",
    "Flags:",
    "  --fresh                 Replace the paper book before running",
    "  --horizon-hours <n>     Simulate n hours of fee accrual at the current fee rate",
    "  --consider <n>          How many ranked pools to try to open",
    "  --scan-limit <n>        Page size for each Meteora list",
    "  --include-damm          Also list DAMM v2 pools (discovery only)",
    "  --strategy <id>         Prefer one strategy file",
    "  --force-strategy        Use --strategy even when its entry rules miss",
    "  --confirm-live          Required together with MODE=live and WALLET_PRIVATE_KEY",
    "  --top <n>               How many ranked pools to print",
    "  --pools-per-bucket <n>  Pools replayed per coin type (default 4)",
    "  --size-usd <n>          Simulated deposit per trial (default 250)",
    "  --skip-forward          Skip the forward paper book",
    "  --verbose",
    "",
    "Paper mode is the default. No wallet is required.",
  ].join("\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

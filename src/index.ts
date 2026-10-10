import { resolve } from "node:path";
import { discoverTournamentPools } from "./tournament/discover.js";
import { runHighVolEdge } from "./tournament/edge.js";
import { FROZEN_STRATEGY_FILE, loadFrozenStrategy } from "./tournament/frozen.js";
import { solPriceUsd, syncFrozenHighVolBook } from "./tournament/frozenBook.js";
import { loadConfig, loadEnvFile } from "./config.js";
import { FileBookStore, emptyPaperBook } from "./executor/book.js";
import { createLogger } from "./logger.js";
import { createDefaultDeps, monitorPositions, runPipeline, type RunOptions } from "./pipeline.js";
import { renderBook, renderReport, renderScan } from "./report.js";
import { scanPools } from "./scanner/scanner.js";
import { loadStrategyBundle } from "./strategy/loader.js";
import { runDaily } from "./tournament/daily.js";
import { markForwardBook, summarizeForward } from "./tournament/forward.js";
import { runBrief3 } from "./tournament/brief3.js";
import { runH12Stress } from "./tournament/h12stress.js";
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
  if (cli.command === "high-vol-edge") {
    const frozen = loadFrozenStrategy(resolve(process.cwd(), FROZEN_STRATEGY_FILE));
    const price = await solPriceUsd([]);
    const outPath = resolve(process.cwd(), "reports/high-vol-winner-edge.md");
    await runHighVolEdge({
      leaderboardPath: resolve(process.cwd(), "reports/leaderboard.json"),
      strategy: frozen.strategy,
      nowMs: Date.now(),
      sizeUsd: cli.sizeUsd,
      solPriceUsd: price,
      outPath,
      onProgress: (message) => console.log(message),
    });
    console.log(`\nEdge report: ${outPath}`);
    return;
  }
  if (cli.command === "frozen-book") {
    const nowMs = Date.now();
    console.log("Scanning for high-vol pools");
    const universe = await discoverTournamentPools(nowMs);
    const status = await syncFrozenHighVolBook({
      path: resolve(process.cwd(), "data/frozen-high-vol-forward.json"),
      frozenPath: resolve(process.cwd(), FROZEN_STRATEGY_FILE),
      universe,
      nowMs,
      sizeUsd: cli.sizeUsd ?? 250,
      onProgress: (message) => console.log(message),
    });
    console.log(`Frozen book: ${status.positions} positions (${status.open} open, ${status.closed} closed).`);
    console.log(`Gross PnL $${status.grossPnlUsd.toFixed(2)}. Net of costs $${status.netPnlUsd.toFixed(2)}.`);
    console.log(`Opened ${status.added.length}. Deferred ${status.deferred}. Qualifying ${status.qualifying}.`);
    console.log(`Hash ${status.parameterHash}.`);
    return;
  }
  if (cli.command === "daily") {
    const forwardPath = resolve(process.cwd(), "data/tournament-forward.json");
    const reportsDir = resolve(process.cwd(), "reports");
    const dailyPath = await runDaily({
      reportsDir,
      strategiesDir: config.strategiesDir,
      forwardPath,
      sizeUsd: cli.sizeUsd,
      poolsPerBucket: cli.poolsPerBucket,
      frozenPath: resolve(process.cwd(), FROZEN_STRATEGY_FILE),
      frozenBookPath: resolve(process.cwd(), "data/frozen-high-vol-forward.json"),
      rug: {
        failScore: config.rugFailScore,
        minHolders: config.rugMinHolders,
        minTvlUsd: config.limits.minTvlUsd,
        failClosed: config.rugFailClosed,
      },
      onProgress: (message) => console.log(message),
    });
    console.log(`\nDaily summary: ${dailyPath}`);
    return;
  }
  if (cli.command === "h12-stress") {
    const path = await runH12Stress({
      reportsDir: resolve(process.cwd(), "reports"),
      cacheDir: resolve(process.cwd(), "data/h12"),
      onProgress: (message) => console.log(message),
    });
    console.log(path);
    return;
  }
  if (cli.command === "brief3") {
    const path = await runBrief3({
      reportsDir: resolve(process.cwd(), "reports"),
      cacheDir: resolve(process.cwd(), "data/brief3"),
      onProgress: (message) => console.log(message),
    });
    console.log(path);
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
    "  tournament       Backtest the strategy grid. Creates the forward book only if it is missing",
    "  tournament-mark  Mark the forward paper book against live pools",
    "  daily            Mark forward positions, open new paper trials, rerun the tournament",
    "  high-vol-edge    Reprice the frozen high-vol strategy with costs and active-bin fees",
    "  frozen-book      Open the frozen strategy on newly qualifying high-vol pools",
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

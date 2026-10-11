import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { sleep } from "../http.js";
import { assumedLiquidityBins } from "../math/activeBin.js";
import { binsForSpread, carteaSpread, CARTEA_GAMMA_FIGURE } from "../math/lvr.js";
import type { StrategyConfig } from "../strategy/schema.js";
import type { CoinType, DiscoveredPool } from "../types.js";
import { replayStrategy, type TrialResult } from "./backtest.js";
import { fetchCandleWindow, type Candle, type CandleSeries } from "./candles.js";
import { classifyPool, COIN_TYPES, sampleKey } from "./classify.js";
import { discoverTournamentPools, enrichPriceChange } from "./discover.js";
import { withCosts } from "./edge.js";
import { solPriceUsd } from "./frozenBook.js";
import { gridStrategies } from "./grid.js";
import { splitCoinKeys } from "./holdout.js";
import { tokenHoldUsd } from "./leaderStudy.js";
import { scoreTrials } from "./score.js";
import { H12_TP_LEVELS } from "./h12trial.js";
import { quantile } from "./stats.js";
import {
  activeBinTvlShare,
  binStepBand,
  calendarCut,
  clusterBootstrapCoinMean,
  coinEqualMean,
  entryFeatures,
  featureIsCausal,
  h2Score,
  H12_HORIZON_DAYS,
  H12_LOOKBACK_DAYS,
  H12_MIN_DAY_SAMPLE,
  H12_STEP_DAYS,
  liquidityBinsFromMove,
  passingIds,
  perCoinNets,
  rollingWindows,
  trialMean,
  withoutTopCoins,
  type RankRow,
  type WalkSpec,
} from "./h12walk.js";

const PRIMARY_GAMMA = CARTEA_GAMMA_FIGURE;
const PRIMARY_TOP = 0.2;
const PRIMARY_SIZE = 250;
const WIDTHS = [2, 12, 30, 80];
const GAMMAS = [5e-7, 1e-4, 5e-4, 1e-3, 5e-3, 1e-2];
const TOPS = [0.1, 0.2, 0.3];
const SIZES = [50, 250, 1000];
const SCALES = [1, 1.5, 2];

const MAIN_SPEC: WalkSpec = {
  stepDays: H12_STEP_DAYS,
  lookbackDays: H12_LOOKBACK_DAYS,
  horizonDays: H12_HORIZON_DAYS,
};

interface Ready {
  pool: DiscoveredPool;
  coinType: CoinType;
  key: string;
  daily: CandleSeries;
  h4: CandleSeries;
  h1: CandleSeries;
}

interface Prepared {
  id: string;
  pool: DiscoveredPool;
  coinType: CoinType;
  key: string;
  holdout: boolean;
  split: "train" | "test" | "holdout";
  entryTs: number;
  day: number;
  feature: Candle[];
  forward: Candle[];
  candleHours: number;
  sigma: number;
  feeYield: number;
  absChange: number;
  feePerVolume: number;
  h2: number;
  volumeScore: number;
  liquidityBins: number;
  binStep: number;
}

interface Outcome {
  entry: Prepared;
  net: number;
  vsToken: number;
  bins: number | null;
  withdrew: boolean;
  trial: TrialResult;
}

interface BookStats {
  trials: number;
  coins: number;
  withdrew: number;
  trialNet: number | null;
  coinNet: number | null;
  coinVsToken: number | null;
  meanBins: number | null;
}

/**
 * Point-in-time walk-forward of H12. Writes a report. Does not freeze a
 * strategy and does not touch the forward books.
 */
export async function runH12Stress(options: {
  reportsDir: string;
  cacheDir: string;
  nowMs?: number;
  onProgress?: (message: string) => void;
}): Promise<string> {
  const nowMs = options.nowMs ?? Date.now();
  const log = options.onProgress ?? (() => {});
  const end = Math.floor(nowMs / 1000);
  log("Discovering the tournament universe");
  const universe = await discoverTournamentPools(nowMs);
  const missingPrice = universe.filter((pool) => pool.market.priceChangeH24Pct === null);
  const enrich = missingPrice.slice(0, 150);
  if (enrich.length > 0) {
    log(`Enriching price change for ${enrich.length} of ${missingPrice.length} pools that lack one`);
    await enrichPriceChange(enrich);
  }
  const sol = await solPriceUsd(universe);
  log(`SOL $${sol.toFixed(2)}. Universe ${universe.length}. Fetching free Meteora candles`);
  const ready = await loadReady(universe, options.cacheDir, end, nowMs, log);
  const studied = ready.filter((row) => row.daily.candles.length >= H12_LOOKBACK_DAYS + H12_HORIZON_DAYS);
  const entries = prepare(studied, (row) => row.daily, MAIN_SPEC);
  log(`Walk-forward entries ${entries.length} on ${new Set(entries.map((row) => row.key)).size} coins`);
  const base = mustStrategy("grid-spot-broad-two-stay");
  const cache = new Map<string, TrialResult | null>();
  const play = makePlayer(base, sol, cache, log);

  const causalFails = entries.filter((row) => !featureIsCausal(row.feature, row.entryTs)).length;
  const primaryIds = passSet(entries, PRIMARY_TOP, "h2");
  const primary = play(entries, primaryIds, {
    gamma: PRIMARY_GAMMA,
    size: PRIMARY_SIZE,
    feeModel: "crossed-bins",
    path: "wick",
    costScale: 1,
    label: "primary",
  });
  const oos = primary.filter(isOos);
  const train = primary.filter((row) => row.entry.split === "train");

  const fixedByWidth = new Map<number, Outcome[]>();
  for (const width of WIDTHS) {
    fixedByWidth.set(width, play(entries, primaryIds, {
      bins: width,
      size: PRIMARY_SIZE,
      feeModel: "crossed-bins",
      path: "wick",
      costScale: 1,
      label: `fixed-${width}`,
    }));
  }
  const bestWidth = chooseWidth(fixedByWidth, "train");
  const oracleWidth = chooseWidth(fixedByWidth, "oos");
  const fixed = fixedByWidth.get(bestWidth) ?? [];

  const gammas = GAMMAS.map((gamma) => ({
    gamma,
    book: gamma === PRIMARY_GAMMA ? primary : play(entries, primaryIds, {
      gamma,
      size: PRIMARY_SIZE,
      feeModel: "crossed-bins",
      path: "wick",
      costScale: 1,
      label: `gamma-${gamma}`,
    }),
  }));

  const tops = TOPS.map((top) => {
    const ids = passSet(entries, top, "h2");
    return {
      top,
      ids: ids.size,
      book: top === PRIMARY_TOP ? primary : play(entries, ids, {
        gamma: PRIMARY_GAMMA,
        size: PRIMARY_SIZE,
        feeModel: "crossed-bins",
        path: "wick",
        costScale: 1,
        label: `top-${top}`,
      }),
    };
  });

  const sizes = SIZES.map((size) => ({
    size,
    book: size === PRIMARY_SIZE ? primary : play(entries, primaryIds, {
      gamma: PRIMARY_GAMMA,
      size,
      feeModel: "crossed-bins",
      path: "wick",
      costScale: 1,
      label: `size-${size}`,
    }),
  }));

  const scales = SCALES.map((costScale) => ({
    costScale,
    book: costScale === 1 ? primary : play(entries, primaryIds, {
      gamma: PRIMARY_GAMMA,
      size: PRIMARY_SIZE,
      feeModel: "crossed-bins",
      path: "wick",
      costScale,
      label: `cost-${costScale}`,
    }),
  }));

  const active = play(entries, primaryIds, {
    gamma: PRIMARY_GAMMA,
    size: PRIMARY_SIZE,
    feeModel: "active-bin",
    path: "wick",
    costScale: 1,
    label: "active-bin",
  });
  const closePath = play(entries, primaryIds, {
    gamma: PRIMARY_GAMMA,
    size: PRIMARY_SIZE,
    feeModel: "crossed-bins",
    path: "close",
    costScale: 1,
    label: "close-path",
  });

  const volumeIds = passSet(entries, PRIMARY_TOP, "volume");
  const volumeBook = play(entries, volumeIds, {
    gamma: PRIMARY_GAMMA,
    size: PRIMARY_SIZE,
    feeModel: "crossed-bins",
    path: "wick",
    costScale: 1,
    label: "fee-volume",
  });
  const leakedSelect = passSet(entries, PRIMARY_TOP, "forward-h2");
  const leakedSelectBook = play(entries, leakedSelect, {
    gamma: PRIMARY_GAMMA,
    size: PRIMARY_SIZE,
    feeModel: "crossed-bins",
    path: "wick",
    costScale: 1,
    label: "leak-select",
  });
  const leakedBoth = play(entries, leakedSelect, {
    gamma: PRIMARY_GAMMA,
    size: PRIMARY_SIZE,
    feeModel: "crossed-bins",
    path: "wick",
    costScale: 1,
    label: "leak-both",
    features: "forward",
  });

  const resolution = resolutionBooks(studied, base, sol, cache, log);
  const paired = pairedFourHour(studied, oos.filter((row) => !row.withdrew), base, sol, cache, log);
  const recorder = recorderCheck(ready, [join(process.cwd(), "data/recorder/recorder.sqlite")]);

  const collapsed = collapseCoins(primary);
  const boards = scoreTrials(collapsed, []);
  const promoted = boards.filter((board) => board.winner).map((board) => board.coinType);

  const markdown = render({
    nowMs,
    sol,
    universe: universe.length,
    missingPrice: missingPrice.length,
    enriched: enrich.length,
    ready,
    entries,
    causalFails,
    primary,
    oos,
    train,
    fixed,
    bestWidth,
    oracleWidth,
    gammas,
    tops,
    sizes,
    scales,
    active,
    closePath,
    volumeIds,
    volumeBook,
    leakedSelect,
    leakedSelectBook,
    leakedBoth,
    primaryIds,
    resolution,
    paired,
    recorder,
    boards,
    promoted,
    cacheSize: cache.size,
  });
  mkdirSync(options.reportsDir, { recursive: true });
  const path = join(options.reportsDir, `h12-stress-${new Date(nowMs).toISOString().slice(0, 10)}.md`);
  writeFileSync(path, markdown);
  log(`Wrote ${path}`);
  return path;
}

/**
 * Same walk, same top-20% entries, and the same width rule as the H12 stress
 * test. The only change is an after-cost take-profit. Does not promote and
 * does not write a winner file.
 */
export async function runH12TakeProfit(options: {
  reportsDir: string;
  cacheDir: string;
  nowMs?: number;
  onProgress?: (message: string) => void;
}): Promise<string> {
  const nowMs = options.nowMs ?? Date.now();
  const log = options.onProgress ?? (() => {});
  const end = Math.floor(nowMs / 1000);
  log("Discovering the tournament universe");
  const universe = await discoverTournamentPools(nowMs);
  const missingPrice = universe.filter((pool) => pool.market.priceChangeH24Pct === null);
  const enrich = missingPrice.slice(0, 150);
  if (enrich.length > 0) {
    log(`Enriching price change for ${enrich.length} of ${missingPrice.length} pools that lack one`);
    await enrichPriceChange(enrich);
  }
  const sol = await solPriceUsd(universe);
  log(`SOL $${sol.toFixed(2)}. Universe ${universe.length}. Reading free Meteora candles`);
  const ready = await loadReady(universe, options.cacheDir, end, nowMs, log);
  const studied = ready.filter((row) => row.daily.candles.length >= H12_LOOKBACK_DAYS + H12_HORIZON_DAYS);
  const entries = prepare(studied, (row) => row.daily, MAIN_SPEC);
  log(`Walk-forward entries ${entries.length} on ${new Set(entries.map((row) => row.key)).size} coins`);
  const base = mustStrategy("grid-spot-broad-two-stay");
  const cache = new Map<string, TrialResult | null>();
  const play = makePlayer(base, sol, cache, log);
  const primaryIds = passSet(entries, PRIMARY_TOP, "h2");
  const levels: Array<number | null> = [null, ...H12_TP_LEVELS];
  const books: Array<{ level: number | null; feeModel: "crossed-bins" | "active-bin"; book: Outcome[] }> = [];
  for (const level of levels) {
    for (const feeModel of ["crossed-bins", "active-bin"] as const) {
      const label = level === null ? "h12" : `h12-tp${Math.round(level * 100)}`;
      log(`Replaying ${label} ${feeModel}`);
      books.push({
        level,
        feeModel,
        book: play(entries, primaryIds, {
          gamma: PRIMARY_GAMMA,
          size: PRIMARY_SIZE,
          feeModel,
          path: "wick",
          costScale: 1,
          label,
          takeProfitPct: level,
          swap: "all-non-sol",
        }),
      });
    }
  }
  const markdown = renderTakeProfit({ nowMs, sol, universe: universe.length, entries, primaryIds, books });
  mkdirSync(options.reportsDir, { recursive: true });
  const path = join(options.reportsDir, `h12-tp-${new Date(nowMs).toISOString().slice(0, 10)}.md`);
  writeFileSync(path, markdown);
  log(`Wrote ${path}`);
  return path;
}

function renderTakeProfit(input: {
  nowMs: number;
  sol: number;
  universe: number;
  entries: Prepared[];
  primaryIds: Set<string>;
  books: Array<{ level: number | null; feeModel: "crossed-bins" | "active-bin"; book: Outcome[] }>;
}): string {
  const lines: string[] = [];
  const holdRows = (book: Outcome[]) => book.filter(isOos).filter((row) => !row.withdrew).map((row) => {
    const hold = tokenHoldUsd(row.entry.pool, row.entry.forward, PRIMARY_SIZE);
    return { key: row.entry.key, net: hold.usd - PRIMARY_SIZE };
  });
  lines.push(`# H12 take-profit variants ${new Date(input.nowMs).toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push(`Paper only. Spot DLMM inventory. No perps, no borrowed leverage, no lending. Deposit $${PRIMARY_SIZE}. SOL $${input.sol.toFixed(2)}.`);
  lines.push("");
  lines.push("These variants keep the pre-registered H12 rule: γ=0.001, top 20% of that day's train-coin fee/TVL over absolute price change, two-sided Spot, 96-hour out-of-range timeout, 18% stop. The stop is still mark-to-market. The only added exit is a take-profit at 10%, 15%, 25%, or 40% of the deposit, measured on position value after exit slippage, transaction fees, and non-refundable bin-array rent. On that exit every non-SOL balance, including unclaimed fees in that token, is swapped to SOL. A SOL balance is not swapped. When neither leg is SOL, the pool walk sells the non-quote inventory and the quote inventory is then sold to SOL at 4 bps against a $10M reserve. On a SOL pair the swap matches the stress-test liquidation. The no-take-profit row uses that same all-non-SOL exit cost so the comparison is the exit, not a second cost model.");
  lines.push("");
  lines.push(`Walk-forward matches the stress test. Daily bars, lookback ${H12_LOOKBACK_DAYS} days, hold ${H12_HORIZON_DAYS} days, step ${H12_STEP_DAYS} days. ${input.entries.length} entries, ${new Set(input.entries.map((row) => row.key)).size} coins. Train is the first 70% of train-coin calendar days. Test is the rest of those coins. Holdout coins are the sorted 30% sample-key split. The quintile uses train coins only. Width uses the lookback only. Selected entries ${input.primaryIds.size}. Means are coin-equal. Trials overlap, so the bootstrap resamples coins. Versus cash is coin-equal net after costs. Versus hold is that equity minus buying the volatile token. The candle cache is the one on disk for this run, including daily bars refreshed after the 2026-10-10 stress print, so the no-take-profit row is the control for this sample rather than a reprint of that earlier dollar figure.`);
  lines.push("");
  lines.push("Promotion gates are unchanged: 8 train / 5 test / 4 holdout coins, beat cash and beat holding on the holdout, no coin above 50% of positive PnL, Bid-Ask excluded. Nothing here is promoted. Nothing is written to strategies/winners. The original H12 trial file and its hash are unchanged.");
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push("| Variant | Fees | OOS coins | OOS trials | Vs cash | Vs hold | Holdout vs cash | Holdout vs hold | TP hit | Stop | Timeout | Still open | Ex top coin | Ex top 3 |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of input.books) {
    const oos = row.book.filter(isOos).filter((item) => !item.withdrew);
    const holdout = oos.filter((item) => item.entry.split === "holdout");
    const summary = stats(oos);
    const holdSummary = stats(holdout);
    const ex1 = withoutTopCoins(oos.map((item) => ({ key: item.entry.key, net: item.net })), 1);
    const ex3 = withoutTopCoins(oos.map((item) => ({ key: item.entry.key, net: item.net })), 3);
    const name = row.level === null ? "H12, no TP" : `TP ${Math.round(row.level * 100)}%`;
    lines.push(`| ${name} | ${row.feeModel} | ${summary.coins} | ${summary.trials} | ${usd(summary.coinNet)} | ${usd(summary.coinVsToken)} | ${usd(holdSummary.coinNet)} | ${usd(holdSummary.coinVsToken)} | ${rate(oos, "take-profit")} | ${rate(oos, "stop-loss")} | ${rate(oos, "out-of-range-timeout")} | ${rate(oos, null)} | ${usd(ex1.mean)} | ${usd(ex3.mean)} |`);
  }
  lines.push("");
  const baseline = input.books.find((row) => row.level === null && row.feeModel === "crossed-bins");
  const withdrawals = baseline ? baseline.book.filter(isOos).filter((row) => row.withdrew).length : 0;
  lines.push(`Cartea withdrawals on the out-of-sample days, counted as cash in the inclusive figure below: ${withdrawals}. They do not depend on the take-profit. Inclusive crossed-bin, no take-profit, coin-equal net ${usd(baseline ? stats(baseline.book.filter(isOos), true).coinNet : null)}. Holding the token on the entered out-of-sample rows, coin-equal net ${usd(baseline ? coinEqualMean(holdRows(baseline.book)).mean : null)}.`);
  lines.push("");
  lines.push("## Concentration and the gates");
  lines.push("");
  for (const level of [null, ...H12_TP_LEVELS]) {
    const crossed = input.books.find((row) => row.level === level && row.feeModel === "crossed-bins");
    const active = input.books.find((row) => row.level === level && row.feeModel === "active-bin");
    if (!crossed || !active) continue;
    const name = level === null ? "H12, no TP" : `TP ${Math.round(level * 100)}%`;
    const oos = crossed.book.filter(isOos).filter((row) => !row.withdrew);
    const coinNets = perCoinNets(oos.map((row) => ({ key: row.entry.key, net: row.net }))).sort((a, b) => a - b);
    const boot = clusterBootstrapCoinMean(groupsOf(oos), 1000, 12);
    const activeOos = active.book.filter(isOos).filter((row) => !row.withdrew);
    const id = level === null ? "h12-no-tp" : `h12-tp${Math.round(level * 100)}`;
    const collapsed = collapseCoins(crossed.book).map((trial) => ({ ...trial, strategyId: id }));
    const boards = scoreTrials(collapsed, []);
    const notes = boards.map((board) => `${board.coinType}: ${board.promotionNote}`).join(" ");
    const promoted = boards.filter((board) => board.winner).map((board) => board.coinType);
    lines.push(`### ${name}`);
    lines.push("");
    lines.push(`Crossed-bin entered out-of-sample per-coin net: n=${coinNets.length}, median ${usd(median(coinNets))}, 10th ${usd(quantileOf(coinNets, 0.1))}, 90th ${usd(quantileOf(coinNets, 0.9))}, share positive ${pct(coinNets.length ? coinNets.filter((value) => value > 0).length / coinNets.length : null)}. Bootstrap 95% ${boot ? `${usd(boot.low)} to ${usd(boot.high)}` : "n/a"}. Active-bin coin-equal net ${usd(stats(activeOos).coinNet)}, versus hold ${usd(stats(activeOos).coinVsToken)}. Train crossed-bin coin-equal net ${usd(stats(crossed.book.filter((row) => row.entry.split === "train" && !row.withdrew)).coinNet)}. Mean bins ${binsOf(oos)}.`);
    lines.push("");
    lines.push(`Coin-collapsed gate check, crossed-bin, not a promotion: ${promoted.length ? promoted.join(", ") : "no bucket cleared"}. ${notes}`);
    lines.push("");
  }
  lines.push("Active-bin coin-equal out-of-sample net is negative for the no-take-profit rule and for every take-profit level. That is the same result that kept H12 from being frozen. A bucket note that says a rule is promoted is the unchanged gate talking about this crossed-bin sample. It does not freeze a strategy, it does not write strategies/winners, and it does not change the H12 trial hash. Every file stays labelled trial, not promoted.");
  lines.push("");
  return lines.join("\n");
}

function rate(rows: Outcome[], reason: string | null): string {
  if (rows.length === 0) return "n/a";
  const hits = rows.filter((row) => (row.trial.closeReason ?? null) === reason).length;
  return `${((100 * hits) / rows.length).toFixed(1)}%`;
}

function makePlayer(
  base: StrategyConfig,
  sol: number,
  cache: Map<string, TrialResult | null>,
  log: (line: string) => void,
) {
  let calls = 0;
  return function play(entries: Prepared[], ids: Set<string>, opts: {
    gamma?: number;
    bins?: number;
    size: number;
    feeModel: "crossed-bins" | "active-bin";
    path: "wick" | "close";
    costScale: number;
    label: string;
    features?: "pit" | "forward";
    /** Null keeps the pre-registered exit. A number is an after-cost take-profit. */
    takeProfitPct?: number | null;
    /** all-non-sol sells every non-SOL balance. leg is the stress-test default. */
    swap?: "leg" | "all-non-sol";
  }): Outcome[] {
    const selected = entries.filter((entry) => ids.has(entry.id));
    const out: Outcome[] = [];
    for (const entry of selected) {
      const feat = opts.features === "forward"
        ? entryFeatures(entry.forward, entry.candleHours, entry.pool.tvlUsd)
        : null;
      const sigma = feat?.sigma ?? entry.sigma;
      const feeYield = feat?.feeYield ?? entry.feeYield;
      const bins = opts.bins ?? (opts.gamma === undefined ? null : widthFor(sigma, feeYield, opts.gamma, entry.binStep));
      if (bins === null) {
        out.push(cashOutcome(entry, opts.size, opts.label));
        continue;
      }
      const strategy = withBins(base, bins, opts.label, opts.takeProfitPct ?? null);
      const gross = cachedReplay(cache, entry, strategy, opts.size, opts.feeModel, opts.path, sol);
      calls += 1;
      if (calls % 2000 === 0) log(`Replays ${calls}, cache ${cache.size}`);
      if (!gross) continue;
      const net = withCosts(
        { ...gross, strategyId: opts.label, coinKey: entry.key },
        entry.pool,
        sol,
        entry.liquidityBins,
        opts.costScale,
        opts.swap ?? "leg",
      );
      const hold = tokenHoldUsd(entry.pool, entry.forward, opts.size);
      net.vsTokenUsd = net.equityUsd - hold.usd;
      net.poolShare = entry.pool.tvlUsd > 0 ? opts.size / entry.pool.tvlUsd : 0;
      net.split = entry.split;
      net.coinType = entry.coinType;
      out.push({
        entry,
        net: net.netPnlUsd,
        vsToken: net.vsTokenUsd ?? 0,
        bins,
        withdrew: false,
        trial: net,
      });
    }
    return out;
  };
}

function cachedReplay(
  cache: Map<string, TrialResult | null>,
  entry: Prepared,
  strategy: StrategyConfig,
  size: number,
  feeModel: "crossed-bins" | "active-bin",
  path: "wick" | "close",
  solPriceUsd: number,
): TrialResult | null {
  const tp = strategy.exit.takeProfitAfterCosts && strategy.exit.takeProfitPct !== null
    ? `|tp${strategy.exit.takeProfitPct}|sol${solPriceUsd}`
    : "";
  const key = `${entry.id}|${strategy.binsBelow}|${size}|${feeModel}|${path}|${entry.candleHours}${tp}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const gross = replayStrategy({
    pool: entry.pool,
    strategy,
    candles: entry.forward,
    sizeUsd: size,
    candleHours: entry.candleHours,
    coinType: entry.coinType,
    split: entry.split,
    feeModel,
    liquidityBins: entry.liquidityBins,
    path,
    solPriceUsd,
  });
  cache.set(key, gross);
  return gross;
}

function widthFor(sigma: number, feeYield: number, gamma: number, binStep: number): number | null {
  const delta = carteaSpread({ feeYieldPerDay: feeYield, sigmaDaily: sigma, gamma });
  if (delta === null) return null;
  return binsForSpread(delta, binStep);
}

function chooseWidth(books: Map<number, Outcome[]>, which: "train" | "oos"): number {
  let best: number = WIDTHS[0] ?? 2;
  let bestMean = Number.NEGATIVE_INFINITY;
  for (const width of WIDTHS) {
    const rows = (books.get(width) ?? []).filter((row) => which === "train" ? row.entry.split === "train" : isOos(row));
    const mean = coinEqualMean(rows.map((row) => ({ key: row.entry.key, net: row.net }))).mean;
    if (mean === null || mean <= bestMean) continue;
    bestMean = mean;
    best = width;
  }
  return best;
}

async function loadReady(
  universe: DiscoveredPool[],
  cacheDir: string,
  end: number,
  nowMs: number,
  log: (line: string) => void,
): Promise<Ready[]> {
  mkdirSync(join(cacheDir, "24h"), { recursive: true });
  mkdirSync(join(cacheDir, "4h"), { recursive: true });
  mkdirSync(join(cacheDir, "1h"), { recursive: true });
  const ready: Ready[] = [];
  let cursor = 0;
  const limit = 5;
  async function worker(): Promise<void> {
    while (cursor < universe.length) {
      const index = cursor;
      cursor += 1;
      const pool = universe[index];
      if (!pool || pool.binStep === null) continue;
      const daily = await cachedWindow(pool, cacheDir, "24h", end - 90 * 86_400, end);
      const h4 = await cachedWindow(pool, cacheDir, "4h", end - 16 * 86_400, end);
      const h1 = await cachedWindow(pool, cacheDir, "1h", end - 2 * 86_400, end);
      if ((index + 1) % 50 === 0) log(`Candles ${index + 1}/${universe.length}`);
      const any = daily.candles.length + h4.candles.length + h1.candles.length;
      if (any < 8) continue;
      ready.push({
        pool,
        coinType: classifyPool(pool, nowMs).type,
        key: sampleKey(pool),
        daily,
        h4,
        h1,
      });
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  ready.sort((a, b) => a.pool.address.localeCompare(b.pool.address));
  return ready;
}

async function cachedWindow(
  pool: DiscoveredPool,
  cacheDir: string,
  timeframe: "24h" | "4h" | "1h",
  start: number,
  end: number,
): Promise<CandleSeries> {
  const path = join(cacheDir, timeframe, `${pool.address}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as CandleSeries;
  const series = await fetchCandleWindow(pool, timeframe, start, end);
  writeFileSync(path, JSON.stringify(series));
  await sleep(40);
  return series;
}

function prepare(rows: Ready[], seriesOf: (row: Ready) => CandleSeries, spec: WalkSpec): Prepared[] {
  const draft: Array<Omit<Prepared, "holdout" | "split"> & { key: string }> = [];
  for (const row of rows) {
    const series = seriesOf(row);
    if (series.candles.length < 4 || row.pool.binStep === null) continue;
    for (const window of rollingWindows(series.candles, series.candleHours, spec)) {
      const feat = entryFeatures(window.feature, series.candleHours, row.pool.tvlUsd);
      if (!feat) continue;
      draft.push({
        id: `${row.pool.address}:${window.entryTs}`,
        pool: row.pool,
        coinType: row.coinType,
        key: row.key,
        entryTs: window.entryTs,
        day: window.day,
        feature: window.feature,
        forward: window.forward,
        candleHours: series.candleHours,
        sigma: feat.sigma,
        feeYield: feat.feeYield,
        absChange: feat.absChange,
        feePerVolume: feat.feePerVolume,
        h2: h2Score(feat.feeYield, feat.absChange),
        volumeScore: h2Score(feat.feePerVolume, feat.absChange),
        liquidityBins: liquidityBinsFromMove(row.pool.binStep, feat.absChange),
        binStep: row.pool.binStep,
      });
    }
  }
  const keys = splitCoinKeys([...new Set(draft.map((row) => row.key))]);
  const holdout = new Set(keys.holdoutKeys);
  const cut = calendarCut(draft.filter((row) => !holdout.has(row.key)).map((row) => row.day));
  if (cut === null) return [];
  const prepared: Prepared[] = [];
  for (const row of draft) {
    const isHoldout = holdout.has(row.key);
    if (isHoldout && row.day <= cut) continue;
    const split = isHoldout ? "holdout" : row.day <= cut ? "train" : "test";
    prepared.push({ ...row, holdout: isHoldout, split });
  }
  return prepared;
}

function passSet(entries: Prepared[], top: number, score: "h2" | "volume" | "forward-h2"): Set<string> {
  const rows: RankRow[] = [];
  for (const entry of entries) {
    let value = score === "volume" ? entry.volumeScore : entry.h2;
    if (score === "forward-h2") {
      const feat = entryFeatures(entry.forward, entry.candleHours, entry.pool.tvlUsd);
      if (!feat) continue;
      value = h2Score(feat.feeYield, feat.absChange);
    }
    rows.push({ id: entry.id, day: entry.day, score: value, holdout: entry.holdout });
  }
  return passingIds(rows, top, H12_MIN_DAY_SAMPLE);
}

function resolutionBooks(
  rows: Ready[],
  base: StrategyConfig,
  sol: number,
  cache: Map<string, TrialResult | null>,
  log: (line: string) => void,
): { dailyVs4h: string; hourly: string } {
  const play = makePlayer(base, sol, cache, log);
  const both = rows.filter((row) => row.daily.candles.length >= 20 && row.h4.candles.length >= 40);
  const spec: WalkSpec = { stepDays: 2, lookbackDays: 4, horizonDays: 3 };
  const daily = prepare(both, (row) => row.daily, spec);
  const h4 = prepare(both, (row) => row.h4, spec);
  const dailyIds = passSet(daily, PRIMARY_TOP, "h2");
  const h4Ids = passSet(h4, PRIMARY_TOP, "h2");
  const dailyBook = play(daily, dailyIds, {
    gamma: PRIMARY_GAMMA,
    size: PRIMARY_SIZE,
    feeModel: "crossed-bins",
    path: "wick",
    costScale: 1,
    label: "res-daily",
  });
  const h4Book = play(h4, h4Ids, {
    gamma: PRIMARY_GAMMA,
    size: PRIMARY_SIZE,
    feeModel: "crossed-bins",
    path: "wick",
    costScale: 1,
    label: "res-4h",
  });
  const hourlyRows = rows.filter((row) => row.h1.candles.length >= 40);
  const hourSpec: WalkSpec = { stepDays: 1, lookbackDays: 1, horizonDays: 1 };
  const h1 = prepare(hourlyRows, (row) => row.h1, hourSpec);
  const h4short = prepare(hourlyRows, (row) => row.h4, hourSpec);
  const h1Ids = passSet(h1, PRIMARY_TOP, "h2");
  const h4ShortIds = passSet(h4short, PRIMARY_TOP, "h2");
  const h1Book = play(h1, h1Ids, {
    gamma: PRIMARY_GAMMA,
    size: PRIMARY_SIZE,
    feeModel: "crossed-bins",
    path: "wick",
    costScale: 1,
    label: "res-1h",
  });
  const h4OnHour = play(h4short, h4ShortIds, {
    gamma: PRIMARY_GAMMA,
    size: PRIMARY_SIZE,
    feeModel: "crossed-bins",
    path: "wick",
    costScale: 1,
    label: "res-4h-short",
  });
  const h1All = h1Book.filter((row) => !row.withdrew);
  return {
    dailyVs4h: `${both.length} pools have both a daily history and 16 days of 4h bars. Refitting the rule on a 4-day lookback and 3-day hold, OOS coin-equal net is daily ${fmt(stats(dailyBook.filter(isOos)))} and 4h ${fmt(stats(h4Book.filter(isOos)))}. Mean bins daily ${binsOf(dailyBook.filter(isOos))}, 4h ${binsOf(h4Book.filter(isOos))}. These are separate entry sets.`,
    hourly: `${hourlyRows.length} pools have a 48-hour 1h series. A one-day lookback leaves one calendar day, so it cannot be split into train and test. All entered 1h trials: ${fmt(stats(h1All))}, mean bins ${binsOf(h1All)}. 4h on that same one-day spec, out-of-sample where a split exists: ${fmt(stats(h4OnHour.filter(isOos).filter((row) => !row.withdrew)))}. The 1h API rejects a 7-day window.`,
  };
}

function pairedFourHour(
  rows: Ready[],
  entered: Outcome[],
  base: StrategyConfig,
  sol: number,
  cache: Map<string, TrialResult | null>,
  log: (line: string) => void,
): { coins: number; trials: number; dailyNet: number | null; fourHourNet: number | null; text: string } {
  const byAddress = new Map(rows.map((row) => [row.pool.address, row]));
  const play = makePlayer(base, sol, cache, log);
  const copies: Prepared[] = [];
  const widths = new Map<string, number>();
  for (const outcome of entered) {
    if (outcome.bins === null) continue;
    const ready = byAddress.get(outcome.entry.pool.address);
    if (!ready) continue;
    const endTs = outcome.entry.entryTs + H12_HORIZON_DAYS * 86_400;
    const forward = ready.h4.candles.filter((candle) => candle.timestamp >= outcome.entry.entryTs && candle.timestamp < endTs);
    const last = forward[forward.length - 1];
    const first = forward[0];
    if (!first || !last || forward.length < 6) continue;
    if (last.timestamp - first.timestamp < 5 * 86_400) continue;
    const id = `${outcome.entry.id}:4h`;
    copies.push({ ...outcome.entry, id, forward, candleHours: 4 });
    widths.set(id, outcome.bins);
  }
  const forced: Outcome[] = [];
  for (const copy of copies) {
    const bins = widths.get(copy.id);
    if (bins === undefined) continue;
    forced.push(...play([copy], new Set([copy.id]), {
      bins,
      size: PRIMARY_SIZE,
      feeModel: "crossed-bins",
      path: "wick",
      costScale: 1,
      label: "paired-4h",
    }));
  }
  const used = new Set(forced.map((row) => row.entry.id.replace(/:4h$/, "")));
  const pairedDaily = entered.filter((row) => used.has(row.entry.id)).map((row) => ({ key: row.entry.key, net: row.net }));
  const dailyMean = coinEqualMean(pairedDaily);
  const four = coinEqualMean(forced.filter((row) => !row.withdrew).map((row) => ({ key: row.entry.key, net: row.net })));
  const text = `Paired check: the same out-of-sample entries and the same width, marked on 4h bars over that same 7-day hold when the 4h series covers at least five days of it. Entries ${forced.length}, coins ${dailyMean.coins}. Daily path ${usd(dailyMean.mean)}. 4h path ${usd(four.mean)}.`;
  return { coins: dailyMean.coins, trials: forced.length, dailyNet: dailyMean.mean, fourHourNet: four.mean, text };
}

function recorderCheck(rows: Ready[], paths: string[]): string {
  const dbPath = paths.find((path) => existsSync(path));
  if (!dbPath) {
    return `The box recorder database is not on this machine (${paths.join(", ")}). Overlapping snapshots: 0. The fee-share model was not compared with live bin balances.`;
  }
  const wanted = new Map(rows.map((row) => [row.pool.address, row]));
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const pools = db.prepare(`SELECT json FROM pools`).all() as Array<{ json: string }>;
    const byAddress = new Map<string, { decimalsX: number; decimalsY: number; priceUsdX: number; priceUsdY: number; tvlUsd: number }>();
    for (const row of pools) {
      const parsed = JSON.parse(row.json) as {
        address?: string;
        decimalsX?: number;
        decimalsY?: number;
        priceUsdX?: number;
        priceUsdY?: number;
        tvlUsd?: number;
      };
      if (!parsed.address || !wanted.has(parsed.address)) continue;
      byAddress.set(parsed.address, {
        decimalsX: parsed.decimalsX ?? 0,
        decimalsY: parsed.decimalsY ?? 0,
        priceUsdX: parsed.priceUsdX ?? 0,
        priceUsdY: parsed.priceUsdY ?? 0,
        tvlUsd: parsed.tvlUsd ?? 0,
      });
    }
    const shares: number[] = [];
    const assumed: number[] = [];
    const seen = new Set<string>();
    for (const address of byAddress.keys()) {
      const meta = byAddress.get(address);
      const ready = wanted.get(address);
      if (!meta || !ready) continue;
      const snaps = db.prepare(`SELECT active_bin, bins FROM snapshots WHERE pool = ?`).all(address) as Array<{ active_bin: number; bins: string }>;
      for (const snap of snaps) {
        const bins = JSON.parse(snap.bins) as Array<[number, string, string]>;
        const share = activeBinTvlShare({
          activeBin: snap.active_bin,
          bins,
          decimalsX: meta.decimalsX,
          decimalsY: meta.decimalsY,
          priceX: meta.priceUsdX,
          priceY: meta.priceUsdY,
          tvlUsd: meta.tvlUsd,
        });
        if (share === null) continue;
        shares.push(share);
        assumed.push(1 / assumedLiquidityBins(ready.pool));
        seen.add(address);
      }
    }
    db.close();
    const medShare = median(shares);
    const medAssumed = median(assumed);
    return `Recorder ${dbPath}. Overlapping pools ${seen.size}. Snapshots with an active-bin balance ${shares.length}. Median active-bin USD / pool TVL ${pct(medShare)}. The backtest's even-spread assumption puts ${pct(medAssumed)} of TVL in the active bin.`;
  } catch (error) {
    return `Recorder file ${dbPath} could not be read (${error instanceof Error ? error.message : String(error)}). Overlapping snapshots: 0.`;
  }
}

function render(input: {
  nowMs: number;
  sol: number;
  universe: number;
  missingPrice: number;
  enriched: number;
  ready: Ready[];
  entries: Prepared[];
  causalFails: number;
  primary: Outcome[];
  oos: Outcome[];
  train: Outcome[];
  fixed: Outcome[];
  bestWidth: number;
  oracleWidth: number;
  gammas: Array<{ gamma: number; book: Outcome[] }>;
  tops: Array<{ top: number; ids: number; book: Outcome[] }>;
  sizes: Array<{ size: number; book: Outcome[] }>;
  scales: Array<{ costScale: number; book: Outcome[] }>;
  active: Outcome[];
  closePath: Outcome[];
  volumeIds: Set<string>;
  volumeBook: Outcome[];
  leakedSelect: Set<string>;
  leakedSelectBook: Outcome[];
  leakedBoth: Outcome[];
  primaryIds: Set<string>;
  resolution: { dailyVs4h: string; hourly: string };
  paired: { coins: number; trials: number; dailyNet: number | null; fourHourNet: number | null; text: string };
  recorder: string;
  boards: ReturnType<typeof scoreTrials>;
  promoted: string[];
  cacheSize: number;
}): string {
  const entered = input.oos.filter((row) => !row.withdrew);
  const enteredIds = new Set(entered.map((row) => row.entry.id));
  const enteredFixed = input.fixed.filter((row) => isOos(row) && enteredIds.has(row.entry.id));
  const holdRows = entered.map((row) => {
    const hold = tokenHoldUsd(row.entry.pool, row.entry.forward, PRIMARY_SIZE);
    return { key: row.entry.key, net: hold.usd - PRIMARY_SIZE };
  });
  const enteredStats = stats(entered);
  const inclusiveStats = stats(input.oos, true);
  const fixedStats = stats(enteredFixed);
  const holdStats = coinEqualMean(holdRows);
  const boot = clusterBootstrapCoinMean(groupsOf(entered), 1000, 12);
  const ex1 = withoutTopCoins(entered.map((row) => ({ key: row.entry.key, net: row.net })), 1);
  const ex3 = withoutTopCoins(entered.map((row) => ({ key: row.entry.key, net: row.net })), 3);
  const coinNets = perCoinNets(entered.map((row) => ({ key: row.entry.key, net: row.net }))).sort((a, b) => a - b);
  const overlapSelect = jaccard(input.primaryIds, input.leakedSelect);
  const kills = killList({
    entered: enteredStats,
    inclusive: inclusiveStats,
    fixed: fixedStats,
    hold: holdStats.mean,
    vsToken: enteredStats.coinVsToken,
    boot,
    ex1: ex1.mean,
    ex3: ex3.mean,
    scales: input.scales,
    active: stats(input.active.filter(isOos).filter((row) => !row.withdrew)),
    closePath: stats(input.closePath.filter(isOos).filter((row) => !row.withdrew)),
    gammas: input.gammas,
    tops: input.tops,
    sizes: input.sizes,
    volume: stats(input.volumeBook.filter(isOos).filter((row) => !row.withdrew)),
    promoted: input.promoted,
    coins: enteredStats.coins,
    paired: input.paired,
  });
  const survived = kills.filter((row) => row.pass);
  const dead = kills.filter((row) => !row.pass);
  const lines: string[] = [];
  lines.push(`# H12 stress test ${new Date(input.nowMs).toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push(`Paper only. Spot DLMM inventory. No perps, no borrowed leverage, no lending. Gamma is the Cartea risk-aversion constant, not borrowed capital. Deposit $${PRIMARY_SIZE} unless a row says otherwise. SOL $${input.sol.toFixed(2)}. Replay is the crossed-bin fee model plus exit slippage, transaction fees, and non-refundable bin-array rent. A 1× cost row matches that model. 1.5× and 2× scale slippage and transaction fees. Rent is unchanged.`);
  lines.push("");
  lines.push("## Sample");
  lines.push("");
  lines.push(`Discovered pools: ${input.universe}. Pools with at least eight candles on some free timeframe: ${input.ready.length}. Daily bars are a 90-day Meteora window. 4h bars are 16 days. 1h bars are 48 hours; a 7-day 1h request is rejected by the API.`);
  lines.push("");
  lines.push(`The walk-forward uses daily bars. Lookback ${H12_LOOKBACK_DAYS} days, hold ${H12_HORIZON_DAYS} days, step ${H12_STEP_DAYS} days. ${input.entries.length} entries, ${new Set(input.entries.map((row) => row.key)).size} distinct coins, ${input.entries.filter((row) => row.holdout).length} holdout-coin entries. Train is the first 70% of train-coin calendar days. Test is the rest of those coins. Holdout coins are the sorted 30% sample-key split and only their post-cut entries are kept.`);
  lines.push("");
  lines.push("Trials overlap by five days, so the trial count is larger than the number of independent coins. Means below that say coin-equal weight each coin once. The bootstrap resamples coins. Fresh pools are under a day old, so they do not have a 21-day daily history. A high-vol label needs a 25% day or turnover of 8. Pools whose 24h change was not filled can land in older-memecoin instead.");
  lines.push("");
  lines.push(bucketTable(input.oos));
  lines.push("");
  lines.push("## Primary result");
  lines.push("");
  lines.push(`Pre-registered rule: γ=${PRIMARY_GAMMA} (the figure scale that can move width), top 20% of that day's train-coin fee/TVL over absolute price change, two-sided Spot, 96-hour out-of-range timeout, 18% stop. Width uses only the lookback. A non-positive Cartea denominator withdraws to cash.`);
  lines.push("");
  lines.push(`Out-of-sample entered positions: coin-equal net ${usd(enteredStats.coinNet)} (trials ${enteredStats.trials}, coins ${enteredStats.coins}), trial-weighted net ${usd(enteredStats.trialNet)}. Withdrawals on the same days: ${inclusiveStats.withdrew}. Inclusive of those withdrawals as cash: coin-equal net ${usd(inclusiveStats.coinNet)} (trials ${inclusiveStats.trials}, coins ${inclusiveStats.coins}). Mean bins each side ${binsOf(entered)}. Train coin-equal net ${usd(stats(input.train.filter((row) => !row.withdrew)).coinNet)}.`);
  lines.push("");
  lines.push(`Best fixed width, chosen on train coin-equal net only: ${input.bestWidth} bins each side. Same entered entries, fixed width coin-equal net ${usd(fixedStats.coinNet)}. Holding the volatile token coin-equal net ${usd(holdStats.mean)}. Cash is $0. The width with the best out-of-sample coin-equal net is ${input.oracleWidth}. That oracle was not used.`);
  lines.push("");
  lines.push(`Coin-equal net versus holding the token, entered out-of-sample: ${usd(enteredStats.coinVsToken)}.`);
  lines.push("");
  lines.push("## Gamma, quintile, bin step, deposit, resolution");
  lines.push("");
  lines.push(gammaTable(input.gammas));
  lines.push("");
  lines.push(topTable(input.tops));
  lines.push("");
  lines.push(bandTable(entered));
  lines.push("");
  lines.push(sizeTable(input.sizes));
  lines.push("");
  lines.push(input.resolution.dailyVs4h);
  lines.push("");
  lines.push(input.resolution.hourly);
  lines.push("");
  lines.push(input.paired.text);
  lines.push("");
  lines.push("## Concentration");
  lines.push("");
  lines.push(`Bootstrap of the coin-equal entered out-of-sample mean, 1000 coin resamples: ${boot ? `${usd(boot.mean)} with a 95% interval ${usd(boot.low)} to ${usd(boot.high)}` : "n/a"}.`);
  lines.push("");
  lines.push(`Dropping the highest-PnL coin (${ex1.dropped.join(", ") || "none"}): coin-equal net ${usd(ex1.mean)} on ${ex1.coins} coins. Dropping the top 3 (${ex3.dropped.join(", ") || "none"}): ${usd(ex3.mean)} on ${ex3.coins} coins.`);
  lines.push("");
  lines.push(`Per-coin mean net, entered out-of-sample: n=${coinNets.length}, mean ${usd(trialMean(coinNets))}, median ${usd(median(coinNets))}, 10th ${usd(quantileOf(coinNets, 0.1))}, 90th ${usd(quantileOf(coinNets, 0.9))}, share positive ${pct(coinNets.length ? coinNets.filter((value) => value > 0).length / coinNets.length : null)}.`);
  lines.push("");
  lines.push("## Costs and the wick");
  lines.push("");
  lines.push(scaleTable(input.scales));
  lines.push("");
  lines.push(`Active-bin fee model on the same entries, entered out-of-sample: ${fmt(stats(input.active.filter(isOos).filter((row) => !row.withdrew)))}. Close-only path, no intra-candle wick: ${fmt(stats(input.closePath.filter(isOos).filter((row) => !row.withdrew)))}. Mean bins on the close path ${binsOf(input.closePath.filter(isOos).filter((row) => !row.withdrew))}.`);
  lines.push("");
  lines.push("## Look-ahead");
  lines.push("");
  lines.push(`Feature windows that contain a bar at or after entry: ${input.causalFails}. Gamma and the fee quintile for the primary book are computed from the lookback only. The fixed width is the train argmax. Test and holdout outcomes were not an input to that choice.`);
  lines.push("");
  lines.push("Meteora volume history for this window has timestamp, volume, fees, and protocol fees. It has no TVL. Fee/TVL therefore divides pre-entry fees by the scan-time TVL. That denominator was not known at entry. The replacement rank uses pre-entry fees/volume over the same price change, which is known at entry.");
  lines.push("");
  lines.push(`Fee/volume quintile, entered out-of-sample: ${fmt(stats(input.volumeBook.filter(isOos).filter((row) => !row.withdrew)))}. Selected entries ${input.volumeIds.size} versus ${input.primaryIds.size} for fee/TVL. Jaccard overlap ${overlapSelect.toFixed(2)}.`);
  lines.push("");
  lines.push(`If the quintile is taken from the forward window instead of the lookback, entered out-of-sample coin-equal net is ${usd(stats(input.leakedSelectBook.filter(isOos).filter((row) => !row.withdrew)).coinNet)} (selected ${input.leakedSelect.size}). If width is also taken from the forward window, it is ${usd(stats(input.leakedBoth.filter(isOos).filter((row) => !row.withdrew)).coinNet)}. Liquidity depth in the fee model uses the lookback's absolute price change, floored at 10%, not the live 24h print.`);
  lines.push("");
  lines.push(`${input.missingPrice} pools had no 24h price change on the pool payload. ${input.enriched} of those were filled from DexScreener before classification. Cache size ${input.cacheSize} replays.`);
  lines.push("");
  lines.push("## Recorder snapshots");
  lines.push("");
  lines.push(input.recorder);
  lines.push("");
  lines.push("## Promotion");
  lines.push("");
  lines.push("Gates are the tournament gates on one observation per coin per split (the mean of that coin's entries), inclusive of withdrawals as cash. Beat cash and beat holding the token on the holdout, no coin above 50% of positive PnL, at least 8 train / 5 test / 4 holdout coins. These trials were not written into the 108-cell grid.");
  lines.push("");
  for (const board of input.boards) {
    lines.push(`- ${board.coinType}: ${board.promotionNote}`);
  }
  lines.push("");
  lines.push("## What survived");
  lines.push("");
  if (survived.length === 0) lines.push("No check passed.");
  else {
    for (const row of survived) lines.push(`- ${row.name}: ${row.detail}`);
  }
  lines.push("");
  lines.push(dead.length === 0
    ? "Nothing killed it. The rule clears the promotion gates and the robustness checks. It was not frozen by this run until a separate forward book is written."
    : "What killed a freeze:");
  if (dead.length > 0) {
    lines.push("");
    for (const row of dead) lines.push(`- ${row.name}: ${row.detail}`);
  }
  const narrow = input.gammas.find((row) => row.gamma === 5e-7);
  const narrowRows = narrow ? narrow.book.filter(isOos).filter((row) => !row.withdrew) : [];
  lines.push("");
  lines.push(`The published γ=5e-7 averages ${binsOf(narrowRows)} bins and its entered coin-equal net is ${usd(stats(narrowRows).coinNet)}. The pre-registered γ=${PRIMARY_GAMMA} averages ${binsOf(input.oos.filter((row) => !row.withdrew))} bins. Narrower ranges earned more on the crossed-bin model. The train-chosen fixed width was ${input.bestWidth} bins, and that same width was the out-of-sample oracle.`);
  lines.push("");
  lines.push(dead.length === 0 && input.promoted.length > 0
    ? `Promoted buckets: ${input.promoted.join(", ")}.`
    : "No forward book was frozen.");
  lines.push("");
  return lines.join("\n");
}

function killList(input: {
  entered: BookStats;
  inclusive: BookStats;
  fixed: BookStats;
  hold: number | null;
  vsToken: number | null;
  boot: { low: number; high: number } | null;
  ex1: number | null;
  ex3: number | null;
  scales: Array<{ costScale: number; book: Outcome[] }>;
  active: BookStats;
  closePath: BookStats;
  gammas: Array<{ gamma: number; book: Outcome[] }>;
  tops: Array<{ top: number; book: Outcome[] }>;
  sizes: Array<{ size: number; book: Outcome[] }>;
  volume: BookStats;
  promoted: string[];
  coins: number;
  paired: { coins: number; fourHourNet: number | null };
}): Array<{ name: string; pass: boolean; detail: string }> {
  const rows: Array<{ name: string; pass: boolean; detail: string }> = [];
  const enough = input.coins >= 15 && input.entered.trials >= 100;
  rows.push({
    name: "Sample size",
    pass: enough,
    detail: `${input.entered.trials} entered out-of-sample trials, ${input.entered.coins} coins. A freeze wants at least 100 trials and 15 coins.`,
  });
  rows.push(signCheck("Entered coin-equal net", input.entered.coinNet));
  rows.push(signCheck("Inclusive coin-equal net", input.inclusive.coinNet));
  rows.push({
    name: "Beats fixed width",
    pass: input.entered.coinNet !== null && input.fixed.coinNet !== null && input.entered.coinNet > input.fixed.coinNet,
    detail: `adaptive ${usd(input.entered.coinNet)}, fixed ${usd(input.fixed.coinNet)}`,
  });
  rows.push({
    name: "Beats holding the token",
    pass: input.vsToken !== null && input.vsToken > 0,
    detail: `coin-equal versus token ${usd(input.vsToken)}, token net ${usd(input.hold)}`,
  });
  rows.push({
    name: "Bootstrap interval",
    pass: input.boot !== null && input.boot.low > 0,
    detail: input.boot ? `${usd(input.boot.low)} to ${usd(input.boot.high)}` : "n/a",
  });
  rows.push(signCheck("Without the top coin", input.ex1));
  rows.push(signCheck("Without the top 3 coins", input.ex3));
  for (const row of input.scales) {
    if (row.costScale === 1) continue;
    const value = stats(row.book.filter(isOos).filter((item) => !item.withdrew)).coinNet;
    rows.push(signCheck(`${row.costScale}× slippage and tx fees`, value));
  }
  rows.push(signCheck("Active-bin fees", input.active.coinNet));
  rows.push(signCheck("Close-only path", input.closePath.coinNet));
  for (const gamma of [5e-4, 5e-3]) {
    const book = input.gammas.find((row) => row.gamma === gamma);
    const value = book ? stats(book.book.filter(isOos).filter((item) => !item.withdrew)).coinNet : null;
    rows.push(signCheck(`Gamma ${gamma}`, value));
  }
  for (const top of [0.1, 0.3]) {
    const book = input.tops.find((row) => row.top === top);
    const value = book ? stats(book.book.filter(isOos).filter((item) => !item.withdrew)).coinNet : null;
    rows.push(signCheck(`Top ${Math.round(top * 100)}% fee quintile`, value));
  }
  const big = input.sizes.find((row) => row.size === 1000);
  rows.push(signCheck("$1000 deposit", big ? stats(big.book.filter(isOos).filter((item) => !item.withdrew)).coinNet : null));
  rows.push(signCheck("Fee/volume quintile", input.volume.coinNet));
  rows.push({
    name: "Same entries on 4h bars",
    pass: input.paired.coins >= 15 && input.paired.fourHourNet !== null && input.paired.fourHourNet > 0,
    detail: input.paired.coins < 15
      ? `only ${input.paired.coins} coins overlap the 4h window`
      : `${usd(input.paired.fourHourNet)} on ${input.paired.coins} coins`,
  });
  rows.push({
    name: "Promotion gates",
    pass: input.promoted.length > 0,
    detail: input.promoted.length > 0 ? input.promoted.join(", ") : "no bucket promoted",
  });
  return rows;
}

function signCheck(name: string, value: number | null): { name: string; pass: boolean; detail: string } {
  return { name, pass: value !== null && value > 0, detail: usd(value) };
}

function collapseCoins(book: Outcome[]): TrialResult[] {
  const groups = new Map<string, Outcome[]>();
  for (const row of book) {
    const key = `${row.entry.split}|${row.entry.key}|${row.entry.coinType}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const out: TrialResult[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    if (!first) continue;
    const net = list.reduce((sum, row) => sum + row.net, 0) / list.length;
    const vs = list.reduce((sum, row) => sum + row.vsToken, 0) / list.length;
    const ret = list.reduce((sum, row) => sum + row.trial.returnPct, 0) / list.length;
    out.push({
      ...first.trial,
      strategyId: "h12-adaptive",
      candles: list.length,
      netPnlUsd: net,
      equityUsd: first.trial.depositedUsd + net,
      returnPct: ret,
      vsTokenUsd: vs,
      feesUsd: list.reduce((sum, row) => sum + row.trial.feesUsd, 0) / list.length,
      coinKey: first.entry.key,
    });
  }
  return out;
}

function bucketTable(rows: Outcome[]): string {
  const lines = ["| Bucket | OOS trials | OOS coins | Entered trials | Entered coins |", "| --- | ---: | ---: | ---: | ---: |"];
  for (const type of COIN_TYPES) {
    const mine = rows.filter((row) => row.entry.coinType === type);
    const entered = mine.filter((row) => !row.withdrew);
    lines.push(`| ${type} | ${mine.length} | ${new Set(mine.map((row) => row.entry.key)).size} | ${entered.length} | ${new Set(entered.map((row) => row.entry.key)).size} |`);
  }
  return lines.join("\n");
}

function gammaTable(rows: Array<{ gamma: number; book: Outcome[] }>): string {
  const lines = ["| Gamma | Entered coin-equal net | Trials | Coins | Withdrawals | Mean bins |", "| --- | ---: | ---: | ---: | ---: | ---: |"];
  for (const row of rows) {
    const oos = row.book.filter(isOos);
    const entered = oos.filter((item) => !item.withdrew);
    const summary = stats(entered);
    lines.push(`| ${row.gamma} | ${usd(summary.coinNet)} | ${summary.trials} | ${summary.coins} | ${oos.filter((item) => item.withdrew).length} | ${binsOf(entered)} |`);
  }
  return lines.join("\n");
}

function topTable(rows: Array<{ top: number; ids: number; book: Outcome[] }>): string {
  const lines = ["| Fee/TVL rank | Selected entries | Entered coin-equal net | Trials | Coins |", "| --- | ---: | ---: | ---: | ---: |"];
  for (const row of rows) {
    const entered = row.book.filter(isOos).filter((item) => !item.withdrew);
    const summary = stats(entered);
    lines.push(`| top ${Math.round(row.top * 100)}% | ${row.ids} | ${usd(summary.coinNet)} | ${summary.trials} | ${summary.coins} |`);
  }
  return lines.join("\n");
}

function bandTable(rows: Outcome[]): string {
  const lines = ["| Bin step | Entered coin-equal net | Trials | Coins |", "| --- | ---: | ---: | ---: |"];
  for (const band of ["1-20", "21-80", "81-125", "126+"]) {
    const mine = rows.filter((row) => binStepBand(row.entry.binStep) === band);
    const summary = stats(mine);
    lines.push(`| ${band} | ${usd(summary.coinNet)} | ${summary.trials} | ${summary.coins} |`);
  }
  return lines.join("\n");
}

function sizeTable(rows: Array<{ size: number; book: Outcome[] }>): string {
  const lines = ["| Deposit | Entered coin-equal net | Trials | Coins |", "| --- | ---: | ---: | ---: |"];
  for (const row of rows) {
    const summary = stats(row.book.filter(isOos).filter((item) => !item.withdrew));
    lines.push(`| $${row.size} | ${usd(summary.coinNet)} | ${summary.trials} | ${summary.coins} |`);
  }
  return lines.join("\n");
}

function scaleTable(rows: Array<{ costScale: number; book: Outcome[] }>): string {
  const lines = ["| Cost scale | Entered coin-equal net | Trials |", "| --- | ---: | ---: |"];
  for (const row of rows) {
    const summary = stats(row.book.filter(isOos).filter((item) => !item.withdrew));
    lines.push(`| ${row.costScale}× | ${usd(summary.coinNet)} | ${summary.trials} |`);
  }
  return lines.join("\n");
}

function stats(rows: Outcome[], includeWithdrawals = false): BookStats {
  const entered = includeWithdrawals ? rows : rows.filter((row) => !row.withdrew);
  const nets = coinEqualMean(entered.map((row) => ({ key: row.entry.key, net: row.net })));
  const versus = coinEqualMean(entered.map((row) => ({ key: row.entry.key, net: row.vsToken })));
  return {
    trials: entered.length,
    coins: nets.coins,
    withdrew: rows.filter((row) => row.withdrew).length,
    trialNet: trialMean(entered.map((row) => row.net)),
    coinNet: nets.mean,
    coinVsToken: versus.mean,
    meanBins: null,
  };
}

function groupsOf(rows: Outcome[]): number[][] {
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const list = map.get(row.entry.key) ?? [];
    list.push(row.net);
    map.set(row.entry.key, list);
  }
  return [...map.values()];
}

function binsOf(rows: Outcome[]): string {
  const values = rows.map((row) => row.bins).filter((value): value is number => value !== null);
  const mean = trialMean(values);
  return mean === null ? "n/a" : mean.toFixed(1);
}

function fmt(summary: BookStats): string {
  return `${usd(summary.coinNet)} (trials ${summary.trials}, coins ${summary.coins})`;
}

function isOos(row: Outcome): boolean {
  return row.entry.split === "test" || row.entry.split === "holdout";
}

function cashOutcome(entry: Prepared, size: number, id: string): Outcome {
  const hold = tokenHoldUsd(entry.pool, entry.forward, size);
  const trial: TrialResult = {
    poolAddress: entry.pool.address,
    poolName: entry.pool.name,
    strategyId: id,
    coinType: entry.coinType,
    split: entry.split,
    candles: entry.forward.length,
    depositedUsd: size,
    equityUsd: size,
    netPnlUsd: 0,
    returnPct: 0,
    feesUsd: 0,
    ilUsd: 0,
    hodlUsd: hold.usd,
    vsHodlUsd: size - hold.usd,
    maxDrawdownPct: 0,
    closeReason: "withdraw",
    rebalanceCount: 0,
    coinKey: entry.key,
    vsTokenUsd: size - hold.usd,
    poolShare: entry.pool.tvlUsd > 0 ? size / entry.pool.tvlUsd : 0,
  };
  return { entry, net: 0, vsToken: size - hold.usd, bins: null, withdrew: true, trial };
}

function withBins(base: StrategyConfig, bins: number, id: string, takeProfitPct: number | null = null): StrategyConfig {
  const exit: StrategyConfig["exit"] = { ...base.exit, takeProfitPct };
  if (takeProfitPct !== null) exit.takeProfitAfterCosts = true;
  return { ...base, id, binsBelow: bins, binsAbove: bins, exit };
}

function mustStrategy(id: string): StrategyConfig {
  const strategy = gridStrategies().find((item) => item.id === id);
  if (!strategy) throw new Error(`missing grid cell ${id}`);
  return strategy;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let both = 0;
  for (const id of a) if (b.has(id)) both += 1;
  const union = a.size + b.size - both;
  return union === 0 ? 0 : both / union;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return quantileOf(sorted, 0.5);
}

function quantileOf(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return quantile([...sorted].sort((a, b) => a - b), p);
}

function usd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

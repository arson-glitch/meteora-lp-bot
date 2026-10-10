import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DLMM_API_BASE } from "../constants.js";
import { getJson, sleep } from "../http.js";
import { assumedLiquidityBins } from "../math/activeBin.js";
import { liquidationCost, tokenLegToSol } from "../math/costs.js";
import {
  binsForSpread,
  carteaSpread,
  CARTEA_GAMMA_FIGURE,
  CARTEA_GAMMA_PAPER,
  continuousRangeLeverage,
  discreteBinLeverage,
  feeClearsHold,
  feeYieldPerDay,
  fullRangeLvrFraction,
  lvrGate,
  rangePrices,
  realizedSigmaDaily,
  varianceRatio,
} from "../math/lvr.js";
import type { StrategyConfig } from "../strategy/schema.js";
import type { CoinType, DiscoveredPool } from "../types.js";
import { replayStrategy, splitCandles, MIN_SERIES_CANDLES, type TrialResult } from "./backtest.js";
import { fetchCandleSeries, type Candle, type CandleSeries } from "./candles.js";
import { sampleKey } from "./classify.js";
import { discoverTournamentPools, enrichPriceChange, selectTournamentBuckets, TARGET_COINS_PER_BUCKET } from "./discover.js";
import { withCosts } from "./edge.js";
import { solPriceUsd } from "./frozenBook.js";
import { gridStrategies } from "./grid.js";
import { splitCoinKeys } from "./holdout.js";
import { tokenHoldUsd } from "./leaderStudy.js";
import { scoreTrials } from "./score.js";
import { fetchSwapCounts, mentionFirehose, percentile, planForMonth, planForSwaps, tapeCredits, type SwapCount } from "./swapCounts.js";
import { replaySkewUnwind } from "./unwind.js";

const SIZE_USD = 250;
const COST_FRACTION = 0.03;

interface ReadyPool {
  pool: DiscoveredPool;
  coinType: CoinType;
  key: string;
  holdout: boolean;
  series: CandleSeries;
  m5: number[];
}

interface Feat {
  sigma: number;
  feeYield: number;
  absChange: number;
  leverage: number;
  continuous: number;
  discrete: number | null;
}

interface Scored {
  id: string;
  net: TrialResult;
  costUsd: number;
  slippageUsd: number;
}

/**
 * H10–H14 on the crossed-bin, cost-adjusted replay. Does not write winners
 * and does not touch the forward books. H26 and H27 are not run.
 */
export async function runBrief3(options: {
  reportsDir: string;
  cacheDir: string;
  nowMs?: number;
  onProgress?: (message: string) => void;
}): Promise<string> {
  const nowMs = options.nowMs ?? Date.now();
  const log = options.onProgress ?? (() => {});
  log("Discovering the tournament universe");
  const universe = await discoverTournamentPools(nowMs);
  const buckets = selectTournamentBuckets(universe, nowMs, TARGET_COINS_PER_BUCKET);
  const listed = buckets.flatMap((bucket) => bucket.pools.map((pool) => ({ pool, coinType: bucket.type })));
  log(`Enriching price change for ${listed.length} pools`);
  await enrichPriceChange(listed.map((row) => row.pool));
  const price = await solPriceUsd(universe);
  log(`SOL $${price.toFixed(2)}. Loading candles`);
  const ready = await loadReady(listed, options.cacheDir, nowMs, log);
  const counts = await fetchSwapCounts(ready.map((row) => ({ address: row.pool.address, name: row.pool.name })), log);
  const markdown = render({ ready, counts, solPriceUsd: price, nowMs, universe: universe.length });
  mkdirSync(options.reportsDir, { recursive: true });
  const path = join(options.reportsDir, `hypotheses-brief3-${new Date(nowMs).toISOString().slice(0, 10)}.md`);
  writeFileSync(path, markdown);
  log(`Wrote ${path}`);
  return path;
}

async function loadReady(
  listed: Array<{ pool: DiscoveredPool; coinType: CoinType }>,
  cacheDir: string,
  nowMs: number,
  log: (line: string) => void,
): Promise<ReadyPool[]> {
  const keys = splitCoinKeys([...new Set(listed.map((row) => sampleKey(row.pool)))]);
  const holdout = new Set(keys.holdoutKeys);
  const ready: ReadyPool[] = [];
  mkdirSync(join(cacheDir, "candles"), { recursive: true });
  mkdirSync(join(cacheDir, "m5"), { recursive: true });
  for (const row of listed) {
    if (row.pool.binStep === null) continue;
    log(`Candles ${row.coinType} ${row.pool.name}`);
    const series = await cachedSeries(row.pool, cacheDir, nowMs);
    await sleep(80);
    if (series.candles.length < MIN_SERIES_CANDLES) continue;
    const m5 = await cachedM5(row.pool.address, cacheDir, nowMs);
    await sleep(80);
    ready.push({
      pool: row.pool,
      coinType: row.coinType,
      key: sampleKey(row.pool),
      holdout: holdout.has(sampleKey(row.pool)),
      series,
      m5,
    });
  }
  return ready;
}

async function cachedSeries(pool: DiscoveredPool, cacheDir: string, nowMs: number): Promise<CandleSeries> {
  const path = join(cacheDir, "candles", `${pool.address}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as CandleSeries;
  const series = await fetchCandleSeries(pool, nowMs);
  writeFileSync(path, JSON.stringify(series));
  return series;
}

async function cachedM5(address: string, cacheDir: string, nowMs: number): Promise<number[]> {
  const path = join(cacheDir, "m5", `${address}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as number[];
  const end = Math.floor(nowMs / 1000);
  let closes: number[] = [];
  try {
    const body = await getJson<{ data?: Array<{ close?: number }> }>(
      `${DLMM_API_BASE}/pools/${address}/ohlcv?timeframe=5m&start_time=${end - 48 * 3600}&end_time=${end}`,
    );
    closes = (body.data ?? []).map((row) => Number(row.close)).filter((value) => value > 0);
  } catch {
    closes = [];
  }
  writeFileSync(path, JSON.stringify(closes));
  return closes;
}

function render(input: {
  ready: ReadyPool[];
  counts: SwapCount[];
  solPriceUsd: number;
  nowMs: number;
  universe: number;
}): string {
  const base = mustStrategy("grid-spot-broad-two-stay");
  const oor = mustStrategy("grid-spot-wide-two-oor");
  const trials: TrialResult[] = [];
  const h10 = h10Block(input.ready, base, input.solPriceUsd, trials);
  const h11 = h11Block(input.ready, base, input.solPriceUsd, trials);
  const h12 = h12Block(input.ready, base, input.solPriceUsd, trials);
  const h13 = h13Block(input.ready, base, input.solPriceUsd, trials);
  const h14 = h14Block(input.ready, oor, input.solPriceUsd, trials);
  const boards = scoreTrials(trials, []);
  const promoted = boards.filter((board) => board.winner);
  const lines: string[] = [];
  lines.push(`# Hypothesis check H10–H14 ${new Date(input.nowMs).toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push(`Paper only. Deposit $${SIZE_USD}. SOL $${input.solPriceUsd.toFixed(2)}. ${input.ready.length} pools with candles from a discovered universe of ${input.universe}. Replay is crossed-bin LP fees plus exit slippage, transaction fees, and non-refundable bin-array rent. Train coins replay the first 70% of bars as train and the last 30% as test. Holdout coins are the sorted 30% sample-key split; their features use the first 70% of bars and the replay is the last 30%. A gate that fails produces no trial.`);
  lines.push("");
  lines.push("H26 and H27 are not tested. Perps, borrowed leverage, and lending are rejected by the strategy loader.");
  lines.push("");
  lines.push(leverageNote());
  lines.push(h10);
  lines.push(h11);
  lines.push(h12);
  lines.push(h13);
  lines.push(h14);
  lines.push("## Promotion");
  lines.push("");
  if (promoted.length === 0) {
    lines.push("Nothing promotes. These cells were scored with the same gates as the tournament (beat cash and beat holding the token on the holdout, no coin above 50% of positive PnL, walk-forward time split, at least 8 train / 5 test / 4 holdout trials). They were not mixed into the 108-cell grid.");
  } else {
    lines.push("A cell cleared the promotion gates inside this set. It was not written to `strategies/winners` and was not ranked against the 108-cell grid.");
  }
  lines.push("");
  for (const board of boards) {
    if (board.rows.every((row) => row.train.n === 0)) continue;
    lines.push(`- ${board.coinType}: ${board.promotionNote}`);
  }
  lines.push("");
  lines.push(tapeSection(input.counts, input.ready.length));
  lines.push("");
  return lines.join("\n");
}

function leverageNote(): string {
  const sample = rangePrices(100, 2, 2);
  const continuous = continuousRangeLeverage(sample.pLow, sample.pHigh);
  const discrete = discreteBinLeverage(100, 2, 2);
  const wideDiscrete = discreteBinLeverage(100, 80, 80);
  const wideContinuous = continuousRangeLeverage(rangePrices(100, 80, 80).pLow, rangePrices(100, 80, 80).pHigh);
  return [
    "## Leverage term",
    "",
    `Full-range LVR is σ²/8 of position value per day (Milionis et al.). At 5% daily vol that is ${(fullRangeLvrFraction(0.05) * 10_000).toFixed(2)} bp. The brief's factor L = 1/(1−√(p_low/p_high)) is ${continuous.toFixed(1)} on a 5-bin range at bin step 100. A one-bin finite-difference gamma of the same Spot position is ${discrete === null ? "n/a" : discrete.toFixed(1)}, about ${discrete === null ? "n/a" : (discrete / continuous).toFixed(2)}× the brief. On an 80-bin range at the same step the discrete factor is ${wideDiscrete === null ? "n/a" : wideDiscrete.toFixed(1)} and the brief's factor is ${wideContinuous.toFixed(1)}. Discrete gamma is steeper than the brief on narrow ranges and can be lower once the range is many wide bins. Cartea's 4/δ is about twice the brief for a narrow range. The gates below use the discrete factor when the position is concave, and the brief's factor otherwise. This factor is concentration, not borrowed leverage.`,
    "",
  ].join("\n");
}

function h10Block(rows: ReadyPool[], base: StrategyConfig, sol: number, trials: TrialResult[]): string {
  const played = new Map<string, Scored[]>();
  const weekly = { h2: [] as number[], lvr1: [] as number[], all: [] as number[] };
  let weeklyPools = 0;
  for (const row of rows) {
    const windows = splitsOf(row);
    const feat = features(row, windows.feature, base.binsBelow, base.binsAbove);
    if (!feat) continue;
    const h2Pass = h2PassSet(rows, base).has(row.pool.address);
    for (const replay of windows.replays) {
      pushPlay(played, "h10-all", play(row, base, replay.candles, replay.split, sol, "h10-all"));
      if (h2Pass) pushPlay(played, "h10-h2", play(row, base, replay.candles, replay.split, sol, "h10-h2"));
      for (const k of [1, 2, 4]) {
        const id = `h10-k${k}`;
        if (lvrGate({ feeYieldPerDay: feat.feeYield, sigmaDaily: feat.sigma, leverage: feat.leverage, k })) {
          pushPlay(played, id, play(row, base, replay.candles, replay.split, sol, id));
        }
      }
    }
    const weekRows = weekReplay(row, base, sol);
    if (weekRows.length > 0) weeklyPools += 1;
    for (const week of weekRows) {
      if (week.split === "train") continue;
      weekly.all.push(week.all);
      if (week.h2) weekly.h2.push(week.h2);
      if (week.lvr) weekly.lvr1.push(week.lvr);
    }
  }
  for (const [id, scored] of played) {
    if (id.startsWith("h10-")) for (const item of scored) trials.push(item.net);
  }
  const all = oos(played.get("h10-all") ?? []);
  const h2 = oos(played.get("h10-h2") ?? []);
  const k1 = oos(played.get("h10-k1") ?? []);
  const k2 = oos(played.get("h10-k2") ?? []);
  const k4 = oos(played.get("h10-k4") ?? []);
  const beatH2 = k1.mean !== null && h2.mean !== null && k1.mean > h2.mean;
  const beatAll = k1.mean !== null && all.mean !== null && k1.mean > all.mean;
  const verdict = k1.n < 8 || h2.n < 8 ? "untestable" : beatH2 && beatAll ? "confirmed" : "rejected";
  return [
    "## H10 Fee yield versus LVR",
    "",
    `**${verdict}.** The cell is broad two-sided Spot, 96-hour out-of-range hold. H2's gate is the top quintile of candle fee/TVL divided by absolute price change over the feature window (floor 1%), the same ratio as the earlier check. H10 enters when daily fee/TVL > k · σ²/8 · L. σ is the dailyized standard deviation of log closes in that window.`,
    "",
    `OOS (time-split test plus holdout) mean net: ungated ${usd(all.mean)} (n=${all.n}), H2 quintile ${usd(h2.mean)} (n=${h2.n}), k=1 ${usd(k1.mean)} (n=${k1.n}), k=2 ${usd(k2.mean)} (n=${k2.n}), k=4 ${usd(k4.mean)} (n=${k4.n}).`,
    "",
    `Week-ahead replay, OOS weeks only, ${weeklyPools} pools had at least two weeks: ungated ${usd(mean(weekly.all))} (n=${weekly.all.length}), H2 ${usd(mean(weekly.h2))} (n=${weekly.h2.length}), k=1 ${usd(mean(weekly.lvr1))} (n=${weekly.lvr1.length}).`,
    "",
  ].join("\n");
}

function h11Block(rows: ReadyPool[], base: StrategyConfig, sol: number, trials: TrialResult[]): string {
  const holds = [0, 24, 48, 72];
  const played = new Map<string, Scored[]>();
  for (const hours of holds) {
    const strategy = cloneStrategy(base, `h11-hold-${hours}`, { minHoldHours: hours > 0 ? hours : null, outOfRangeTimeoutHours: null });
    for (const row of rows) {
      const windows = splitsOf(row);
      const feat = features(row, windows.feature, strategy.binsBelow, strategy.binsAbove);
      if (!feat) continue;
      const clears = hours === 0
        ? true
        : feeClearsHold({
          feeYieldPerDay: feat.feeYield,
          sigmaDaily: feat.sigma,
          leverage: feat.leverage,
          holdHours: hours,
          costFraction: COST_FRACTION,
        });
      if (!clears) continue;
      for (const replay of windows.replays) {
        const scored = play(row, strategy, replay.candles, replay.split, sol, strategy.id);
        pushPlay(played, strategy.id, scored);
        if (scored) trials.push(scored.net);
      }
    }
  }
  const lines = holds.map((hours) => {
    const stats = oos(played.get(`h11-hold-${hours}`) ?? []);
    const share = costShare(played.get(`h11-hold-${hours}`) ?? []);
    return `- ${hours}h: OOS mean net ${usd(stats.mean)} (n=${stats.n}), share of OOS trades where cost exceeds half of fees ${pct(share.rate)} (n=${share.n})`;
  });
  const baseStats = oos(played.get("h11-hold-0") ?? []);
  const best = holds.filter((hours) => hours > 0).map((hours) => ({ hours, ...oos(played.get(`h11-hold-${hours}`) ?? []) }));
  const winner = best.filter((row) => row.n >= 8 && row.mean !== null).sort((a, b) => (b.mean ?? 0) - (a.mean ?? 0))[0];
  const baseShare = costShare(played.get("h11-hold-0") ?? []);
  const winnerShare = winner ? costShare(played.get(`h11-hold-${winner.hours}`) ?? []) : null;
  const verdict = !winner || baseStats.mean === null || winner.mean === null
    ? "untestable"
    : winner.mean > baseStats.mean && winnerShare !== null && winnerShare.rate !== null && baseShare.rate !== null && winnerShare.rate < baseShare.rate
      ? "confirmed"
      : "rejected";
  return [
    "## H11 Minimum hold",
    "",
    `**${verdict}.** Same broad Spot range. A minimum hold blocks the out-of-range close until that many hours; stop-loss still fires. For 24/48/72h the entry also requires expected fee/TVL over the hold to clear a 3% cost floor plus σ²/8·L over that hold. The 0h row is immediate out-of-range close with no fee screen, so it is the cost-churn baseline.`,
    "",
    ...lines,
    "",
  ].join("\n");
}

function h12Block(rows: ReadyPool[], base: StrategyConfig, sol: number, trials: TrialResult[]): string {
  const widths = [2, 12, 30, 80];
  const h2 = h2PassSet(rows, base);
  const selected = rows.filter((row) => h2.has(row.pool.address));
  const trainNets = new Map<number, number[]>();
  for (const width of widths) {
    const strategy = cloneStrategy(base, `h12-fixed-${width}`, { binsBelow: width, binsAbove: width });
    for (const row of selected) {
      const windows = splitsOf(row);
      const trainReplay = windows.replays.find((replay) => replay.split === "train");
      if (!trainReplay) continue;
      const scored = play(row, strategy, trainReplay.candles, "train", sol, strategy.id);
      if (!scored) continue;
      const list = trainNets.get(width) ?? [];
      list.push(scored.net.netPnlUsd);
      trainNets.set(width, list);
    }
  }
  const bestWidth = [...trainNets.entries()].sort((a, b) => (mean(b[1]) ?? -1e18) - (mean(a[1]) ?? -1e18))[0]?.[0] ?? 12;
  const fixedId = "h12-best-fixed";
  const paperId = "h12-cartea-paper";
  const figureId = "h12-cartea-figure";
  const played = new Map<string, Scored[]>();
  let paperWithdraw = 0;
  let figureWithdraw = 0;
  for (const row of selected) {
    const windows = splitsOf(row);
    const feat = features(row, windows.feature, bestWidth, bestWidth);
    const fixed = cloneStrategy(base, fixedId, { binsBelow: bestWidth, binsAbove: bestWidth });
    for (const replay of windows.replays) {
      pushPlay(played, fixedId, play(row, fixed, replay.candles, replay.split, sol, fixedId));
    }
    for (const [id, gamma] of [[paperId, CARTEA_GAMMA_PAPER], [figureId, CARTEA_GAMMA_FIGURE]] as const) {
      if (!feat || row.pool.binStep === null) continue;
      const delta = carteaSpread({ feeYieldPerDay: feat.feeYield, sigmaDaily: feat.sigma, gamma });
      if (delta === null) {
        if (id === paperId) paperWithdraw += 1;
        else figureWithdraw += 1;
        continue;
      }
      const bins = binsForSpread(delta, row.pool.binStep);
      const strategy = cloneStrategy(base, id, { binsBelow: bins, binsAbove: bins });
      for (const replay of windows.replays) {
        pushPlay(played, id, play(row, strategy, replay.candles, replay.split, sol, id));
      }
    }
  }
  for (const id of [fixedId, paperId, figureId]) {
    for (const item of played.get(id) ?? []) trials.push(item.net);
  }
  const fixed = oos(played.get(fixedId) ?? []);
  const paper = oos(played.get(paperId) ?? []);
  const figure = oos(played.get(figureId) ?? []);
  const figureBeats = figure.mean !== null && fixed.mean !== null && figure.mean > fixed.mean && figure.n >= 8;
  const verdict = figure.n < 8 || fixed.n < 8 ? "untestable" : figureBeats ? "confirmed" : "rejected";
  return [
    "## H12 Cartea–Drissi–Monga width",
    "",
    `**${verdict}.** On the H2 quintile. μ = 0, so δ* = 4γ / (8π − σ²) (their equation 34). δ* > 4 or a non-positive denominator withdraws. Bins each side are round(ln(1+δ*/2) / ln(1+binStep/10000)), clamped to 1..80. The best fixed width is the train-window mean, then that width is frozen for test and holdout. Train picked ${bestWidth} bins each side.`,
    "",
    `OOS mean net: best fixed ${usd(fixed.mean)} (n=${fixed.n}), γ=5e-7 (their ETH/USDC study) ${usd(paper.mean)} (n=${paper.n}, withdrew ${paperWithdraw}), γ=1e-3 (their figure scale) ${usd(figure.mean)} (n=${figure.n}, withdrew ${figureWithdraw}). The published γ=5e-7 collapses toward one bin on daily units, so the comparison that can move width is γ=1e-3.`,
    "",
  ].join("\n");
}

function h13Block(rows: ReadyPool[], base: StrategyConfig, sol: number, trials: TrialResult[]): string {
  const h2 = h2PassSet(rows, base);
  const played = new Map<string, Scored[]>();
  let withVr = 0;
  let pass = 0;
  for (const row of rows) {
    if (!h2.has(row.pool.address)) continue;
    const windows = splitsOf(row);
    const vr = row.m5.length >= 15 ? varianceRatio(row.m5, 12) : null;
    if (vr === null) continue;
    withVr += 1;
    const moves = hourMoves(row.m5);
    const last = moves[moves.length - 1] ?? null;
    const mid = median(moves);
    const passVr = vr < 1 && last !== null && mid !== null && last < mid;
    if (passVr) pass += 1;
    for (const replay of windows.replays) {
      if (passVr) {
        const scored = play(row, base, replay.candles, replay.split, sol, "h13-vr");
        pushPlay(played, "h13-vr", scored);
        if (scored) trials.push(scored.net);
      }
      const baseline = play(row, base, replay.candles, replay.split, sol, "h13-h2");
      pushPlay(played, "h13-h2", baseline);
      if (baseline) trials.push(baseline.net);
    }
  }
  const filtered = oos(played.get("h13-vr") ?? []);
  const baseline = oos(played.get("h13-h2") ?? []);
  const verdict = withVr < 8 ? "untestable" : filtered.n < 8 || filtered.mean === null || baseline.mean === null
    ? "untestable"
    : filtered.mean > baseline.mean
      ? "confirmed"
      : "rejected";
  return [
    "## H13 Variance-ratio regime",
    "",
    `**${verdict}.** 5-minute closes from Meteora ohlcv, last 48 hours. VR is the variance of 12-bar (1 hour) log returns divided by 12 times the 5-minute variance. Entry also requires the latest 1-hour absolute log return to sit under the median of those hourly moves in the same 48 hours. The VR>1.2 exit is not applied inside the candle replay: the 5-minute series is an entry screen, not a path through the position. Pools with a VR: ${withVr}. Passed the screen: ${pass}.`,
    "",
    `OOS mean net on the H2 quintile: unfiltered ${usd(baseline.mean)} (n=${baseline.n}), VR<1 screen ${usd(filtered.mean)} (n=${filtered.n}).`,
    "",
  ].join("\n");
}

function h14Block(rows: ReadyPool[], strategy: StrategyConfig, sol: number, trials: TrialResult[]): string {
  const market: Scored[] = [];
  const unwind: Scored[] = [];
  let armed = 0;
  for (const row of rows) {
    const windows = splitsOf(row);
    const bins = assumedLiquidityBins(row.pool);
    for (const replay of windows.replays) {
    const gross = replayStrategy({
      pool: row.pool,
      strategy,
      candles: replay.candles,
      sizeUsd: SIZE_USD,
      candleHours: row.series.candleHours,
      coinType: row.coinType,
      split: replay.split,
      feeModel: "crossed-bins",
      liquidityBins: bins,
    });
    if (gross) {
      const net = priceTrial(gross, row, replay.candles, sol, bins, "h14-market");
      market.push(net);
      trials.push(net.net);
    }
    const skewed = replaySkewUnwind({
      pool: row.pool,
      strategy,
      candles: replay.candles,
      sizeUsd: SIZE_USD,
      candleHours: row.series.candleHours,
      coinType: row.coinType,
      split: replay.split,
      unwindHours: 6,
      liquidityBins: bins,
    });
    if (!skewed) continue;
    if (skewed.armed) armed += 1;
    const { armed: _armed, ...trial } = skewed;
    const net = priceTrial(trial, row, replay.candles, sol, bins, "h14-unwind-6h");
    unwind.push(net);
    trials.push(net.net);
    }
  }
  const marketOos = oos(market);
  const unwindOos = oos(unwind);
  const marketSlip = mean(market.filter(oosRow).map((row) => row.slippageUsd));
  const unwindSlip = mean(unwind.filter(oosRow).map((row) => row.slippageUsd));
  const verdict = armed < 8 || marketOos.mean === null || unwindOos.mean === null || marketSlip === null || unwindSlip === null
    ? "untestable"
    : unwindSlip < marketSlip && unwindOos.mean > marketOos.mean
      ? "confirmed"
      : "rejected";
  return [
    "## H14 Inventory unwind",
    "",
    `**${verdict}.** Wide two-sided Spot that closes on the first out-of-range mark, versus the same path when a book that is at least 70% one token is placed on a 10-bin single-sided Bid-Ask for 6 hours and then closed. The reshape uses the tokens already in the position. Armed unwinds: ${armed}.`,
    "",
    `OOS mean net: market exit ${usd(marketOos.mean)} (n=${marketOos.n}), unwind ${usd(unwindOos.mean)} (n=${unwindOos.n}). OOS mean exit slippage: market ${usd(marketSlip)}, unwind ${usd(unwindSlip)}.`,
    "",
  ].join("\n");
}

function tapeSection(counts: SwapCount[], pools: number): string {
  const measured = counts.map((row) => row.swaps24h).filter((value): value is number => value !== null);
  const missing = counts.length - measured.length;
  const total = measured.reduce((sum, value) => sum + value, 0);
  const med = percentile(measured, 50);
  const p90 = percentile(measured, 90);
  const firehose = mentionFirehose(pools);
  const quiet = tapeCredits((med ?? 0) * pools);
  const hot = tapeCredits(p90 === null ? 0 : p90 * pools);
  const sumPlan = tapeCredits(total);
  const lines = [
    "## Swap tape and the Helius plan",
    "",
    "Meteora's DLMM data API does not publish a swap count. The pool payload, `/ohlcv`, and `/volume/history` have volume and LP fees. That was checked on the swagger and on SOL-USDC. The counts here are DexScreener buys plus sells for the last 24 hours on the same Meteora pair address. One day is not a long average.",
    "",
    `Pools in the candle set: ${pools}. DexScreener returned a count for ${measured.length}. Missing ${missing}. Sum ${Math.round(total)} swaps/day. Median ${med === null ? "n/a" : Math.round(med)}. 90th percentile ${p90 === null ? "n/a" : Math.round(p90)}.`,
    "",
    `The recorder dropped about 286,000 signatures in 17 minutes across ${pools} logsSubscribe subscriptions. That is ${Math.round(firehose.perDay).toLocaleString("en-US")} mentions/day, or ${Math.round(firehose.perPoolPerDay).toLocaleString("en-US")} per pool per day, if that rate held. Mentions include non-swap transactions. Measured swaps are ${total > 0 ? (firehose.perDay / total).toFixed(1) : "n/a"}× fewer than that mention rate, so the socket is not a swap tape.`,
    "",
    "Credits add 10% for liquidity transactions. getSignaturesForAddress is about one call per 1,000 signatures. getTransactionsForAddress is 0.1 credit per transaction and needs Developer. Archival getTransaction at 10 credits is the pricing-page conflict.",
    "",
    `| Book | Tx/day | getTransaction @1 | archival @10 | getTransactionsForAddress @0.1 | parsed stream @1 |`,
    `| --- | ---: | ---: | ---: | ---: | ---: |`,
    `| Median × pools | ${Math.round(quiet.txPerDay)} | ${fmtCr(quiet.getTransactionMonth)}/mo | ${fmtCr(quiet.archivalMonth)}/mo | ${fmtCr(quiet.batchMonth)}/mo | ${fmtCr(quiet.streamMonth)}/mo |`,
    `| Sum of measured | ${Math.round(sumPlan.txPerDay)} | ${fmtCr(sumPlan.getTransactionMonth)}/mo | ${fmtCr(sumPlan.archivalMonth)}/mo | ${fmtCr(sumPlan.batchMonth)}/mo | ${fmtCr(sumPlan.streamMonth)}/mo |`,
    `| 90th × pools | ${Math.round(hot.txPerDay)} | ${fmtCr(hot.getTransactionMonth)}/mo | ${fmtCr(hot.archivalMonth)}/mo | ${fmtCr(hot.batchMonth)}/mo | ${fmtCr(hot.streamMonth)}/mo |`,
    "",
    `Cheapest plan that covers the measured sum on getTransactionsForAddress: ${planForSwaps(total)}. The same book on parsed streams needs ${planForMonth(sumPlan.streamMonth)}. Plain getTransaction at 1 credit needs ${planForMonth(sumPlan.getTransactionMonth)}.`,
  ];
  return lines.join("\n");
}

function weekReplay(row: ReadyPool, strategy: StrategyConfig, sol: number): Array<{ split: "train" | "test" | "holdout"; all: number; h2: number | null; lvr: number | null }> {
  const groups = groupWeeks(row.series.candles);
  if (groups.length < 2) return [];
  const out: Array<{ split: "train" | "test" | "holdout"; all: number; h2: number | null; lvr: number | null }> = [];
  const scores: number[] = [];
  const feats: Array<Feat | null> = groups.map((group) => features(row, group, strategy.binsBelow, strategy.binsAbove));
  for (let i = 0; i < groups.length; i += 1) {
    const feat = feats[i];
    if (feat) scores.push(feat.feeYield / Math.max(feat.absChange, 0.01));
  }
  const cut = quantileCut(scores, 0.8);
  for (let i = 1; i < groups.length; i += 1) {
    const prior = feats[i - 1];
    const replay = groups[i];
    if (!prior || !replay || replay.length < 2) continue;
    const split: "train" | "test" | "holdout" = row.holdout ? "holdout" : i / groups.length < 0.7 ? "train" : "test";
    const all = play(row, strategy, replay, split, sol, "week-all");
    const h2Score = prior.feeYield / Math.max(prior.absChange, 0.01);
    const h2 = cut !== null && h2Score >= cut ? play(row, strategy, replay, split, sol, "week-h2") : null;
    const lvr = lvrGate({ feeYieldPerDay: prior.feeYield, sigmaDaily: prior.sigma, leverage: prior.leverage, k: 1 })
      ? play(row, strategy, replay, split, sol, "week-lvr")
      : null;
    if (!all) continue;
    out.push({
      split,
      all: all.net.netPnlUsd,
      h2: h2 ? h2.net.netPnlUsd : null,
      lvr: lvr ? lvr.net.netPnlUsd : null,
    });
  }
  return out;
}

function h2PassSet(rows: ReadyPool[], strategy: StrategyConfig): Set<string> {
  const scored: Array<{ address: string; score: number }> = [];
  for (const row of rows) {
    const feat = features(row, splitsOf(row).feature, strategy.binsBelow, strategy.binsAbove);
    if (!feat) continue;
    scored.push({ address: row.pool.address, score: feat.feeYield / Math.max(feat.absChange, 0.01) });
  }
  const cut = quantileCut(scored.map((row) => row.score), 0.8);
  if (cut === null) return new Set();
  return new Set(scored.filter((row) => row.score >= cut).map((row) => row.address));
}

function features(row: ReadyPool, candles: Candle[], binsBelow: number, binsAbove: number): Feat | null {
  if (candles.length < 2 || row.pool.binStep === null) return null;
  const closes = candles.map((candle) => candle.close);
  const sigma = realizedSigmaDaily(closes, row.series.candleHours);
  if (sigma === null) return null;
  const days = (candles.length * row.series.candleHours) / 24;
  const fees = candles.reduce((sum, candle) => sum + candle.lpFeesUsd, 0);
  const first = candles[0]?.open ?? 0;
  const last = candles[candles.length - 1]?.close ?? 0;
  const prices = rangePrices(row.pool.binStep, binsBelow, binsAbove);
  const continuous = continuousRangeLeverage(prices.pLow, prices.pHigh);
  const discrete = discreteBinLeverage(row.pool.binStep, binsBelow, binsAbove);
  const leverage = discrete ?? continuous;
  if (!Number.isFinite(leverage) || leverage <= 0) return null;
  return {
    sigma,
    feeYield: feeYieldPerDay(fees, row.pool.tvlUsd, days),
    absChange: first > 0 && last > 0 ? Math.abs(last / first - 1) : 0,
    leverage,
    continuous,
    discrete,
  };
}

function splitsOf(row: ReadyPool): { feature: Candle[]; replays: Array<{ candles: Candle[]; split: TrialResult["split"] }> } {
  const { train, test } = splitCandles(row.series.candles);
  if (row.holdout) {
    const replay = test.length >= 2 ? test : train;
    return { feature: train, replays: [{ candles: replay, split: "holdout" }] };
  }
  const replays: Array<{ candles: Candle[]; split: TrialResult["split"] }> = [{ candles: train, split: "train" }];
  if (test.length >= 2) replays.push({ candles: test, split: "test" });
  return { feature: train, replays };
}

function play(
  row: ReadyPool,
  strategy: StrategyConfig,
  candles: Candle[],
  split: TrialResult["split"],
  sol: number,
  id: string,
): Scored | null {
  if (candles.length < 2) return null;
  const bins = assumedLiquidityBins(row.pool);
  const gross = replayStrategy({
    pool: row.pool,
    strategy,
    candles,
    sizeUsd: SIZE_USD,
    candleHours: row.series.candleHours,
    coinType: row.coinType,
    split,
    feeModel: "crossed-bins",
    liquidityBins: bins,
  });
  if (!gross) return null;
  return priceTrial(gross, row, candles, sol, bins, id);
}

function priceTrial(gross: TrialResult, row: ReadyPool, candles: Candle[], sol: number, bins: number, id: string): Scored {
  const net = withCosts({ ...gross, strategyId: id }, row.pool, sol, bins);
  const hold = tokenHoldUsd(row.pool, candles, SIZE_USD);
  net.coinKey = row.key;
  net.vsTokenUsd = net.equityUsd - hold.usd;
  net.poolShare = row.pool.tvlUsd > 0 ? SIZE_USD / row.pool.tvlUsd : 0;
  net.strategyId = id;
  const slippage = slippageOf(gross, row.pool, sol, bins);
  return { id, net, costUsd: gross.equityUsd - net.equityUsd, slippageUsd: slippage };
}

function slippageOf(trial: TrialResult, pool: DiscoveredPool, sol: number, bins: number): number {
  const terminal = trial.terminal;
  if (!terminal) return 0;
  const leg = tokenLegToSol(terminal.tokenX, terminal.tokenY);
  const tokenAmount = leg === "x" ? terminal.amountX + terminal.feesX : leg === "y" ? terminal.amountY + terminal.feesY : 0;
  return liquidationCost({
    pool,
    minBinId: terminal.minBinId,
    maxBinId: terminal.maxBinId,
    activeBinId: terminal.activeBinId,
    binStep: terminal.binStep,
    rebalanceCount: terminal.rebalanceCount,
    liquidityBins: bins,
    solPriceUsd: sol,
    tokenLeg: leg,
    tokenAmount,
    tokenPriceUsd: leg === "x" ? terminal.priceXUsd : terminal.priceYUsd,
    otherPriceUsd: leg === "x" ? terminal.priceYUsd : terminal.priceXUsd,
  }).exitSlippageUsd;
}

function pushPlay(map: Map<string, Scored[]>, id: string, scored: Scored | null): void {
  if (!scored) return;
  const list = map.get(id) ?? [];
  list.push(scored);
  map.set(id, list);
}

function oos(rows: Scored[]): { n: number; mean: number | null } {
  const values = rows.filter(oosRow).map((row) => row.net.netPnlUsd);
  return { n: values.length, mean: mean(values) };
}

function oosRow(row: Scored): boolean {
  return row.net.split === "test" || row.net.split === "holdout";
}

function costShare(rows: Scored[]): { n: number; rate: number | null } {
  const sample = rows.filter(oosRow);
  if (sample.length === 0) return { n: 0, rate: null };
  const hit = sample.filter((row) => row.costUsd > 0.5 * row.net.feesUsd).length;
  return { n: sample.length, rate: hit / sample.length };
}

function groupWeeks(candles: Candle[]): Candle[][] {
  const span = 7 * 24 * 3600;
  const map = new Map<number, Candle[]>();
  for (const candle of candles) {
    const key = Math.floor(candle.timestamp / span);
    const list = map.get(key) ?? [];
    list.push(candle);
    map.set(key, list);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, group]) => group).filter((group) => group.length >= 2);
}

function hourMoves(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 12; i < closes.length; i += 12) {
    const previous = closes[i - 12] ?? 0;
    const next = closes[i] ?? 0;
    if (previous > 0 && next > 0) out.push(Math.abs(Math.log(next / previous)));
  }
  return out;
}

function quantileCut(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(quantile * (sorted.length - 1))));
  return sorted[index] ?? null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function cloneStrategy(
  base: StrategyConfig,
  id: string,
  patch: { binsBelow?: number; binsAbove?: number; minHoldHours?: number | null; outOfRangeTimeoutHours?: number | null },
): StrategyConfig {
  return {
    ...base,
    id,
    binsBelow: patch.binsBelow ?? base.binsBelow,
    binsAbove: patch.binsAbove ?? base.binsAbove,
    exit: {
      ...base.exit,
      minHoldHours: patch.minHoldHours === undefined ? base.exit.minHoldHours ?? null : patch.minHoldHours,
      outOfRangeTimeoutHours: patch.outOfRangeTimeoutHours === undefined ? base.exit.outOfRangeTimeoutHours ?? null : patch.outOfRangeTimeoutHours,
    },
  };
}

function mustStrategy(id: string): StrategyConfig {
  const strategy = gridStrategies().find((item) => item.id === id);
  if (!strategy) throw new Error(`missing grid cell ${id}`);
  return strategy;
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

function fmtCr(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

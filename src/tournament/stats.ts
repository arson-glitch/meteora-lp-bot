export interface Distribution {
  n: number;
  mean: number | null;
  median: number | null;
  p5: number | null;
  min: number | null;
  max: number | null;
}

export function distribution(values: number[]): Distribution {
  if (values.length === 0) return { n: 0, mean: null, median: null, p5: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: quantile(sorted, 0.5),
    p5: quantile(sorted, 0.05),
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
  };
}

/** Linear quantile on a sorted ascending sample. p is in [0, 1]. */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const low = sorted[lo] ?? 0;
  const high = sorted[hi] ?? low;
  if (lo === hi) return low;
  return low + (high - low) * (rank - lo);
}

export interface EquityPoint {
  t: number;
  equity: number;
}

/**
 * Sum trial equity curves on a shared clock. A trial counts only between its
 * first and last timestamp. The drawdown is the peak-to-trough drop of that sum.
 */
/**
 * Lines trials up on bar index, as if they were funded together. A trial that
 * has already ended stays at its final equity for the remaining bars.
 */
export function alignedAggregateDrawdown(curves: EquityPoint[][]): { maxDrawdownPct: number; peakUsd: number; troughUsd: number } {
  const series = curves.filter((curve) => curve.length > 0);
  if (series.length === 0) return { maxDrawdownPct: 0, peakUsd: 0, troughUsd: 0 };
  const bars = Math.max(...series.map((curve) => curve.length));
  let peak = 0;
  let troughAtPeak = 0;
  let maxDd = 0;
  for (let index = 0; index < bars; index += 1) {
    let sum = 0;
    for (const curve of series) {
      const point = curve[Math.min(index, curve.length - 1)];
      sum += point?.equity ?? 0;
    }
    if (sum > peak) {
      peak = sum;
      troughAtPeak = sum;
    }
    if (peak > 0) {
      const dd = (peak - sum) / peak;
      if (dd > maxDd) {
        maxDd = dd;
        troughAtPeak = sum;
      }
    }
  }
  return { maxDrawdownPct: maxDd, peakUsd: peak, troughUsd: troughAtPeak };
}

export function aggregateDrawdown(curves: EquityPoint[][]): { maxDrawdownPct: number; peakUsd: number; troughUsd: number } {
  const series = curves.filter((curve) => curve.length > 0);
  if (series.length === 0) return { maxDrawdownPct: 0, peakUsd: 0, troughUsd: 0 };
  const times = [...new Set(series.flatMap((curve) => curve.map((point) => point.t)))].sort((a, b) => a - b);
  let peak = 0;
  let troughAtPeak = 0;
  let maxDd = 0;
  for (const t of times) {
    let sum = 0;
    let included = 0;
    for (const curve of series) {
      const first = curve[0]?.t ?? 0;
      const last = curve[curve.length - 1]?.t ?? 0;
      if (t < first) continue;
      let equity = curve[0]?.equity ?? 0;
      for (const point of curve) {
        if (point.t > t) break;
        equity = point.equity;
      }
      if (t > last) equity = curve[curve.length - 1]?.equity ?? equity;
      sum += equity;
      included += 1;
    }
    if (included === 0) continue;
    if (sum > peak) {
      peak = sum;
      troughAtPeak = sum;
    }
    if (peak > 0) {
      const dd = (peak - sum) / peak;
      if (dd > maxDd) {
        maxDd = dd;
        troughAtPeak = sum;
      }
    }
  }
  return { maxDrawdownPct: maxDd, peakUsd: peak, troughUsd: troughAtPeak };
}

export interface CoinProfit {
  key: string;
  label: string;
  netPnlUsd: number;
}

/** Top coins by net PnL. Share is their net divided by the sum of every coin's net. */
export function topCoinShare(coins: CoinProfit[], count = 3): { top: CoinProfit[]; shareOfNet: number | null; shareOfPositive: number | null } {
  const sorted = [...coins].sort((a, b) => b.netPnlUsd - a.netPnlUsd);
  const top = sorted.slice(0, count);
  const total = coins.reduce((sum, coin) => sum + coin.netPnlUsd, 0);
  const positive = coins.filter((coin) => coin.netPnlUsd > 0).reduce((sum, coin) => sum + coin.netPnlUsd, 0);
  const topNet = top.reduce((sum, coin) => sum + coin.netPnlUsd, 0);
  const topPositive = top.filter((coin) => coin.netPnlUsd > 0).reduce((sum, coin) => sum + coin.netPnlUsd, 0);
  return {
    top,
    shareOfNet: total !== 0 ? topNet / total : null,
    shareOfPositive: positive > 0 ? topPositive / positive : null,
  };
}

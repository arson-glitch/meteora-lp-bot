# Strategy tournament leaderboard

Generated 2026-10-15T07:27:15.306Z. Paper only. Deposit size $250 per trial.

## How a winner is chosen

Strategies are ranked on train coins only, using the first 70% of each pool's candles, by median net return after crossed-bin LP fees, exit slippage, transaction fees, and non-refundable bin-array rent. A strategy needs at least 8 train trials. Bid-Ask cells are shown but are not promoted. The top 5 yield strategies are re-ranked on the last 30% of those same coins. The winner is written to `strategies/winners/` only when that time split has at least 5 trials with a positive median and mean, and the cost-adjusted holdout has at least 4 trials that beat cash (positive median and mean) and beat holding the volatile token, with no single coin above 50% of positive holdout PnL. Holdout coins are absent from ranking.

## Caveats

- Fee share splits each candle's observed LP fee across the bins the candle path walked. The LP fee series is already net of the protocol fee. A move that stays in one bin matches an active-bin share. It is not a replay of `Swap2Evt`. TVL is frozen, and our deposit is not added into it.
- When Meteora volume history has an LP fee on the same timestamp, that figure is used (it is already the LP slice). Otherwise volume × `(baseFeePct + dynamicFeePct) / 100` × the pool's observed 24h LP share. `dynamicFeePct` is the current snapshot, not the historical variable fee.
- The intra-candle path is open, nearer extreme, other extreme, close. A wick can stop out or exit a range that the close would have survived.
- Quote-token USD is frozen. Token X is marked at `price × frozen quote USD`. Exit costs include slippage, signature and priority fees, and bin-array rent outside the active array. Position rent is refundable and is not in PnL. Strategy deposits put one token in each bin, so the SDK composition fee on those deposits is zero. Jito tips are not included.
- After an exit the trial sits in cash. It does not re-enter. Hodl is the initial token amounts marked at the window's last close, so an early exit is compared with holding through the rest of the window.
- Each bucket aims for 18 coins. A second or third pool is included when the same coin has another bin step, so some trials share a coin. Holdout is by coin: every pool of a held-out coin is replayed on its full history and is excluded from training. The split is the lexicographic tail of the coin keys, about 30%.
- Older pools use daily bars over up to 90 days. Pools younger than 20 days use 4-hour bars over 16 days, and pools younger than 36 hours use 1-hour bars over 48 hours. A daily candle's wick path exits ranges that a finer bar might have survived.
- `sharpeLike` is mean trial return divided by the sample standard deviation of those trial returns. It is not annualized and it is not a bar-by-bar Sharpe.
- Bin step is the pool's step. The grid does not vary it, and winners are not split into bin-step bands.

## Samples

Accepted pools: 136. Skipped: 3.

| Bucket | Role | Pool | Bin step | History | Source | Fees |
| --- | --- | --- | --- | --- | --- | --- |
| stable | train | USDe-USDG | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | holdout | USDC-USDT | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | train | FDUSD-USDC | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | holdout | EURC-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| stable | train | PYUSD-USDC | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | holdout | USDC-USDT | 8 | 90d 91 × 24h | meteora | volume-history |
| stable | holdout | USDC-USDT | 80 | 90d 91 × 24h | meteora | volume-history |
| stable | holdout | EURC-USDC | 1 | 89d 90 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-SOL | 2 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JitoSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | mSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-SOL | 10 | 88d 89 × 24h | meteora | volume-history |
| bluechip | train | JUP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-SOL | 5 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 16 | 63d 64 × 24h | meteora | volume-history |
| bluechip | train | JUP-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | USDC-JitoSOL | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | ETH-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| fresh-memecoin | train | SAINDRA-SOL | 100 | 1d 20 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | WAL-USDC | 2 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | train | AVA-USDC | 2 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | train | NES-USDC | 2 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | train | GNS-USDC | 2 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | train | AERO-USDC | 2 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | train | ORBIO-USDC | 2 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | train | TRUTH-USDC | 2 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | train | RSR-USDC | 2 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | VEIL-USDC | 2 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | Stamp-USDT | 100 | 0d 10 × 1h | meteora | volume-history |
| high-vol-trending | train | SOL-HYPE | 4 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | SI-SOL | 30 | 16d 94 × 4h | meteora | volume-history |
| high-vol-trending | holdout | SPCX-SOL | 10 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | MUSK-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | VEIL-SOL | 20 | 1d 33 × 1h | meteora | volume-history |
| high-vol-trending | train | DOPE-SOL | 80 | 4d 22 × 4h | meteora | volume-history |
| high-vol-trending | train | HOOKED-SOL | 50 | 16d 97 × 4h | meteora | volume-history |
| high-vol-trending | train | DARK-SOL | 75 | 8d 51 × 4h | meteora | volume-history |
| high-vol-trending | train | CLAUDIA-SOL | 125 | 8d 50 × 4h | meteora | volume-history |
| high-vol-trending | holdout | XMR-USDC | 10 | 35d 36 × 24h | meteora | volume-history |
| high-vol-trending | train | Altai-SOL | 100 | 5d 28 × 4h | meteora | volume-history |
| high-vol-trending | train | OMNI-SOL | 200 | 12d 75 × 4h | meteora | volume-history |
| high-vol-trending | holdout | TTWO-USDC | 4 | 22d 23 × 24h | meteora | volume-history |
| high-vol-trending | train | DOGE-SOL | 25 | 38d 39 × 24h | meteora | volume-history |
| high-vol-trending | train | LOAD-SOL | 100 | 3d 16 × 4h | meteora | volume-history |
| high-vol-trending | holdout | FO-USDT | 10 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | CRAWL-SOL | 100 | 11d 69 × 4h | meteora | volume-history |
| high-vol-trending | train | SEALS-SOL | 100 | 2d 11 × 4h | meteora | volume-history |
| high-vol-trending | train | SI-SOL | 100 | 24d 25 × 24h | meteora | volume-history |
| high-vol-trending | train | HYPE-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | VEIL-SOL | 125 | 2d 15 × 4h | meteora | volume-history |
| high-vol-trending | train | LOAD-SOL | 20 | 3d 16 × 4h | meteora | volume-history |
| high-vol-trending | train | DOPE-SOL | 100 | 4d 23 × 4h | meteora | volume-history |
| high-vol-trending | train | OMNI-SOL | 100 | 1d 19 × 1h | meteora | volume-history |
| high-vol-trending | train | HOOKED-SOL | 30 | 12d 75 × 4h | meteora | volume-history |
| high-vol-trending | train | Altai-SOL | 250 | 5d 29 × 4h | meteora | volume-history |
| high-vol-trending | train | CRAWL-SOL | 80 | 11d 67 × 4h | meteora | volume-history |
| high-vol-trending | train | DOGE-USDC | 20 | 38d 39 × 24h | meteora | volume-history |
| high-vol-trending | train | CLAUDIA-SOL | 100 | 4d 24 × 4h | meteora | volume-history |
| high-vol-trending | holdout | SPCX-USDC | 75 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | XMR-SOL | 20 | 37d 38 × 24h | meteora | volume-history |
| high-vol-trending | holdout | TTWO-USDC | 10 | 34d 35 × 24h | meteora | volume-history |
| high-vol-trending | train | DARK-SOL | 50 | 13d 78 × 4h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | STONK-SOL | 20 | 64d 65 × 24h | meteora | volume-history |
| established-midcap | train | BP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANSEM-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZEC-SOL | 15 | 55d 56 × 24h | meteora | volume-history |
| established-midcap | train | ANTFUN-USDT | 16 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | MASK-SOL | 200 | 16d 97 × 4h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CARDS-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | NVDAx-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | PENGU-USDC | 25 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | Bonk-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZCAT-SOL | 80 | 39d 40 × 24h | meteora | volume-history |
| established-midcap | holdout | JupSOL-JitoSOL | 1 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | GOOGLx-SOL | 20 | 86d 87 × 24h | meteora | volume-history |
| established-midcap | train | USELESS-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CATE-USDC | 20 | 74d 75 × 24h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZEC-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | BP-SOL | 20 | 38d 39 × 24h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 4 | 87d 88 × 24h | meteora | volume-history |
| established-midcap | train | CATE-SOL | 50 | 80d 81 × 24h | meteora | volume-history |
| established-midcap | train | STONK-USDC | 50 | 39d 40 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CARDS-SOL | 100 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | MASK-SOL | 20 | 13d 78 × 4h | meteora | volume-history |
| established-midcap | train | ANSEM-SOL | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | PENGU-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | Bonk-SOL | 100 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZCAT-USDC | 20 | 38d 39 × 24h | meteora | volume-history |
| older-memecoin | train | MU-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | SKHY-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | wNEAR-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | BORDR-SOL | 100 | 7d 44 × 4h | meteora | volume-history |
| older-memecoin | train | baton-SOL | 80 | 35d 36 × 24h | meteora | volume-history |
| older-memecoin | train | Agency-SOL | 50 | 12d 70 × 4h | meteora | volume-history |
| older-memecoin | train | CTM-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | tSpaceX-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | SNDK-SOL | 25 | 57d 58 × 24h | meteora | volume-history |
| older-memecoin | train | STRK-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | JEANPHIL-SOL | 100 | 25d 26 × 24h | meteora | volume-history |
| older-memecoin | train | ENA-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | PEPE-SOL | 20 | 27d 28 × 24h | meteora | volume-history |
| older-memecoin | train | EMBER-SOL | 50 | 33d 34 × 24h | meteora | volume-history |
| older-memecoin | holdout | ANTHROPIC-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | HOTBOT-SOL | 100 | 13d 79 × 4h | meteora | volume-history |
| older-memecoin | train | PAID-SOL | 30 | 27d 28 × 24h | meteora | volume-history |
| older-memecoin | holdout | tKalshi-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | baton-SOL | 50 | 31d 32 × 24h | meteora | volume-history |
| older-memecoin | train | STRK-SOL | 80 | 85d 86 × 24h | meteora | volume-history |
| older-memecoin | train | BORDR-USDC | 80 | 7d 44 × 4h | meteora | volume-history |
| older-memecoin | holdout | ANTHROPIC-USDC | 15 | 64d 65 × 24h | meteora | volume-history |
| older-memecoin | train | Agency-SOL | 100 | 13d 78 × 4h | meteora | volume-history |
| older-memecoin | train | PAID-SOL | 80 | 30d 31 × 24h | meteora | volume-history |
| older-memecoin | train | MU-USDC | 50 | 2d 11 × 4h | meteora | volume-history |
| older-memecoin | train | JEANPHIL-SOL | 50 | 23d 24 × 24h | meteora | volume-history |
| older-memecoin | train | EMBER-USDC | 200 | 36d 37 × 24h | meteora | volume-history |
| older-memecoin | train | HOTBOT-USDC | 80 | 5d 31 × 4h | meteora | volume-history |
| older-memecoin | holdout | SKHY-SOL | 20 | 78d 79 × 24h | meteora | volume-history |
| older-memecoin | train | wNEAR-SOL | 80 | 90d 91 × 24h | meteora | volume-history |

## stable

No strategy has 8 or more train trials, so nothing is promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | `grid-spot-narrow-quote-rebalance` | 3 | 6.04% | 1.73% | 5 | -2.84% | $-11.46 |  |
| — | `grid-spot-narrow-two-rebalance` | 3 | 5.78% | 1.57% | 5 | -2.68% | $-9.95 |  |
| — | `grid-curve-narrow-two-rebalance` | 3 | 5.63% | 1.49% | 5 | -2.58% | $-8.98 |  |
| — | `grid-curve-narrow-token-rebalance` | 3 | 5.21% | 1.55% | 5 | -2.84% | $-9.59 |  |
| — | `grid-curve-narrow-quote-rebalance` | 3 | 5.10% | 1.59% | 5 | -2.83% | $-10.22 |  |
| — | `grid-spot-narrow-token-rebalance` | 3 | 3.90% | 1.66% | 5 | -2.84% | $-9.40 |  |
| — | `grid-bidask-narrow-quote-rebalance` | 3 | 3.53% | 0.53% | 5 | -2.86% | $-11.38 |  |
| — | `grid-bidask-narrow-two-rebalance` | 3 | 3.47% | 0.99% | 5 | -2.78% | $-10.74 |  |
| — | `grid-spot-narrow-two-stay-array` | 3 | 3.37% | 1.61% | 5 | 0.43% | $1.87 |  |
| — | `grid-spot-narrow-two-patient-array` | 3 | 3.37% | 1.61% | 5 | 0.43% | $2.27 |  |

Top train row vs holding: train $10.92, time-split $18.17, holdout $-11.46 (mean dollars versus buying and holding the entry tokens).

## bluechip

grid-curve-narrow-two-patient-array beat cash on the holdout but did not beat holding the token (median -$29.43, mean -$134.23), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-spot-narrow-two-stay-array` | 16 | 1.17% | 3.50% | 7 | 0.73% | $-52.99 |  |
| 2 | `grid-curve-narrow-two-stay-array` | 16 | 1.13% | 3.51% | 7 | 0.67% | $-53.16 |  |
| 3 | `grid-spot-narrow-two-patient-array` | 16 | 0.57% | 3.31% | 7 | 0.09% | $-65.11 |  |
| 4 | `grid-curve-narrow-two-patient-array` | 16 | 0.55% | 3.57% | 7 | 0.09% | $-64.90 |  |
| 5 | `grid-curve-medium-token-stay-array` | 16 | 0.47% | 2.80% | 7 | 0.22% | $-134.64 |  |
| 6 | `grid-curve-narrow-token-rebalance` | 16 | 0.46% | 16.48% | 7 | 5.65% | $372.70 |  |
| 7 | `grid-spot-medium-token-stay-array` | 16 | 0.45% | 1.21% | 7 | 0.21% | $-133.84 |  |
| 8 | `grid-curve-narrow-token-patient-array` | 16 | 0.39% | 4.75% | 7 | 0.72% | $-131.52 |  |
| 9 | `grid-curve-narrow-two-timeout` | 16 | 0.39% | 2.11% | 7 | 0.02% | $-67.28 |  |
| 10 | `grid-spot-narrow-token-patient-array` | 16 | 0.39% | 4.26% | 7 | 0.17% | $-131.25 |  |

Top train row vs holding: train $15.35, time-split $13.90, holdout $-52.99 (mean dollars versus buying and holding the entry tokens).

## fresh-memecoin

grid-curve-medium-quote-oor passed the time split (median 0.04%, mean 1.33%) but the cost-adjusted holdout did not beat cash (n=3, median 0.32%, mean -0.73%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-quote-oor` | 8 | 0.28% | 0.04% | 3 | 0.32% | $-1.65 |  |
| 2 | `grid-curve-narrow-quote-tp` | 8 | 0.28% | 0.04% | 3 | 0.32% | $-1.65 |  |
| 3 | `grid-spot-narrow-quote-oor` | 8 | 0.28% | 0.04% | 3 | 0.32% | $-1.75 |  |
| 4 | `grid-spot-narrow-quote-tp` | 8 | 0.28% | 0.04% | 3 | 0.32% | $-1.75 |  |
| 5 | `grid-curve-medium-quote-oor` | 8 | 0.28% | 0.04% | 3 | 0.32% | $-1.82 |  |
| 6 | `grid-curve-medium-quote-tp` | 8 | 0.28% | 0.04% | 3 | 0.32% | $-1.82 |  |
| 7 | `grid-curve-narrow-quote-timeout` | 8 | 0.28% | 0.04% | 3 | 0.32% | $-10.71 |  |
| 8 | `grid-curve-medium-quote-patient-array` | 8 | 0.28% | 0.04% | 3 | 0.32% | $-2.54 |  |
| 9 | `grid-curve-medium-quote-stay-array` | 8 | 0.28% | 0.04% | 3 | 0.32% | $-2.54 |  |
| 10 | `grid-curve-medium-quote-timeout` | 8 | 0.28% | 0.04% | 3 | 0.32% | $-2.54 |  |

Top train row vs holding: train $2.21, time-split $10.11, holdout $-1.65 (mean dollars versus buying and holding the entry tokens).

## high-vol-trending

grid-spot-narrow-two-oor beat cash and the token on the holdout, but one coin is 77.32% of positive PnL, above the 50.00% cap, so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-token-rebalance` | 24 | 31.02% | -1.70% | 9 | 104.54% | $1096.04 |  |
| 2 | `grid-curve-narrow-quote-rebalance` | 24 | 28.97% | -1.77% | 9 | 350.60% | $1210.20 |  |
| 3 | `grid-curve-narrow-quote-stay-array` | 24 | 3.02% | -7.99% | 9 | 3.08% | $276.10 |  |
| 4 | `grid-bidask-narrow-two-oor` | 24 | 1.56% | 1.94% | 9 | 0.30% | $63.63 |  |
| 5 | `grid-bidask-narrow-two-tp` | 24 | 1.56% | 1.94% | 9 | 0.30% | $63.63 |  |
| 6 | `grid-spot-narrow-two-oor` | 24 | 1.52% | 2.18% | 9 | 0.36% | $73.15 |  |
| 7 | `grid-spot-narrow-two-tp` | 24 | 1.52% | 2.18% | 9 | 0.36% | $73.15 |  |
| 8 | `grid-curve-narrow-two-oor` | 24 | 1.48% | 2.22% | 9 | 0.27% | $67.59 |  |
| 9 | `grid-curve-narrow-two-tp` | 24 | 1.48% | 2.22% | 9 | 0.27% | $67.59 |  |
| 10 | `grid-curve-narrow-quote-oor` | 24 | 1.27% | 3.19% | 9 | 3.09% | $89.58 |  |

Top train row vs holding: train $411.02, time-split $432.76, holdout $1096.04 (mean dollars versus buying and holding the entry tokens).

## established-midcap

grid-spot-narrow-token-patient-array passed the time split (median 3.36%, mean 10.13%) but the cost-adjusted holdout did not beat cash (n=7, median -1.83%, mean -2.85%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-spot-narrow-token-patient-array` | 24 | 1.84% | 3.36% | 7 | -1.83% | $-65.19 |  |
| 2 | `grid-curve-narrow-token-patient-array` | 24 | 1.79% | 3.04% | 7 | -1.49% | $-64.47 |  |
| 3 | `grid-spot-narrow-two-timeout` | 24 | 1.69% | 2.60% | 7 | -4.94% | $-48.49 |  |
| 4 | `grid-curve-narrow-two-timeout` | 24 | 1.68% | 2.80% | 7 | -4.97% | $-48.20 |  |
| 5 | `grid-bidask-narrow-two-timeout` | 24 | 1.61% | 2.29% | 7 | -4.91% | $-48.78 |  |
| 6 | `grid-bidask-narrow-token-timeout` | 24 | 1.27% | 2.45% | 7 | -1.84% | $-76.86 |  |
| 7 | `grid-spot-narrow-token-timeout` | 24 | 1.12% | 2.14% | 7 | -1.34% | $-76.56 |  |
| 8 | `grid-curve-narrow-token-timeout` | 24 | 0.89% | 1.91% | 7 | -1.12% | $-76.27 |  |
| 9 | `grid-spot-narrow-two-patient-array` | 24 | 0.65% | 9.04% | 7 | -2.04% | $-34.65 |  |
| 10 | `grid-curve-narrow-two-patient-array` | 24 | 0.62% | 9.55% | 7 | -2.07% | $-34.72 |  |

Top train row vs holding: train $-208.97, time-split $25.71, holdout $-65.19 (mean dollars versus buying and holding the entry tokens).

## older-memecoin

grid-curve-narrow-token-patient-array passed the time split (median 0.90%, mean 4.55%) but the cost-adjusted holdout did not beat cash (n=7, median -7.85%, mean -8.26%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-token-patient-array` | 23 | 1.43% | 0.90% | 7 | -7.85% | $3.27 |  |
| 2 | `grid-curve-narrow-quote-patient-array` | 23 | 0.15% | -0.53% | 7 | -2.48% | $-10.12 |  |
| 3 | `grid-curve-narrow-quote-stay-array` | 23 | 0.15% | -0.53% | 7 | 0.44% | $-13.61 |  |
| 4 | `grid-spot-narrow-quote-stay-array` | 23 | 0.04% | -1.44% | 7 | 0.42% | $-14.58 |  |
| 5 | `grid-spot-narrow-quote-patient-array` | 23 | 0.04% | -1.44% | 7 | -2.51% | $-10.71 |  |
| 6 | `grid-spot-narrow-quote-timeout` | 23 | 0.01% | -1.52% | 7 | -2.17% | $-8.73 |  |
| 7 | `grid-bidask-narrow-two-timeout` | 23 | -0.29% | -0.79% | 7 | -2.59% | $4.76 |  |
| 8 | `grid-spot-narrow-two-patient-array` | 23 | -0.33% | -0.41% | 7 | -2.24% | $1.75 |  |
| 9 | `grid-spot-narrow-two-timeout` | 23 | -0.33% | -0.41% | 7 | -2.71% | $4.99 |  |
| 10 | `grid-curve-narrow-two-patient-array` | 23 | -0.38% | -0.03% | 7 | -2.25% | $2.01 |  |

Top train row vs holding: train $41.54, time-split $-59.89, holdout $3.27 (mean dollars versus buying and holding the entry tokens).

Full rows, including strategies with no trials, are in `reports/leaderboard.csv`.

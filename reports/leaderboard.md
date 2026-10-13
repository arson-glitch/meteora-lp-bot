# Strategy tournament leaderboard

Generated 2026-10-13T07:23:38.241Z. Paper only. Deposit size $250 per trial.

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

Accepted pools: 136. Skipped: 4.

| Bucket | Role | Pool | Bin step | History | Source | Fees |
| --- | --- | --- | --- | --- | --- | --- |
| stable | train | USDe-USDG | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | holdout | USDC-USDT | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | train | PYUSD-USDC | 1 | 89d 90 × 24h | meteora | volume-history |
| stable | train | FDUSD-USDC | 1 | 88d 89 × 24h | meteora | volume-history |
| stable | holdout | EURC-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| stable | holdout | USDC-USDT | 8 | 90d 91 × 24h | meteora | volume-history |
| stable | holdout | USDC-USDT | 16 | 90d 91 × 24h | meteora | volume-history |
| stable | holdout | EURC-USDC | 1 | 87d 88 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | cbBTC-SOL | 2 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JitoSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | RENDER-SOL | 25 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | mSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | cbBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | cbBTC-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-SOL | 10 | 86d 87 × 24h | meteora | volume-history |
| bluechip | train | JUP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-SOL | 5 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 16 | 61d 62 × 24h | meteora | volume-history |
| bluechip | train | INF-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | USDC-JitoSOL | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-ETH | 50 | 90d 91 × 24h | meteora | volume-history |
| fresh-memecoin | train | LOAD-SOL | 100 | 1d 13 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | AVGOx-USDC | 8 | 1d 16 × 1h | meteora | volume-history |
| fresh-memecoin | train | HIRE-SOL | 100 | 1d 18 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | MarsX-SOL | 100 | 1d 15 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | VEIL-SOL | 125 | 0d 12 × 1h | meteora | volume-history |
| fresh-memecoin | train | ATTENTION-SOL | 200 | 0d 10 × 1h | meteora | volume-history |
| fresh-memecoin | train | Dogcoin-SOL | 100 | 1d 16 × 1h | meteora | volume-history |
| fresh-memecoin | train | DOGU-SOL | 125 | 1d 20 × 1h | meteora | volume-history |
| fresh-memecoin | train | B22-SOL | 50 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | train | LOAD-SOL | 20 | 1d 13 × 1h | meteora | volume-history |
| fresh-memecoin | train | ANT-ZEC | 50 | 6d 36 × 4h | meteora | volume-history |
| high-vol-trending | train | SOL-HYPE | 4 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | XMR-USDC | 10 | 33d 34 × 24h | meteora | volume-history |
| high-vol-trending | holdout | STRK-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | W-SOL | 10 | 1d 8 × 4h | meteora | volume-history |
| high-vol-trending | train | SI-SOL | 30 | 14d 82 × 4h | meteora | volume-history |
| high-vol-trending | holdout | SPCX-SOL | 10 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | CLAUDIA-SOL | 125 | 6d 38 × 4h | meteora | volume-history |
| high-vol-trending | train | HOOKED-SOL | 50 | 14d 87 × 4h | meteora | volume-history |
| high-vol-trending | train | MUSK-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | Normie-SOL | 100 | 2d 10 × 4h | meteora | volume-history |
| high-vol-trending | train | DARK-SOL | 75 | 6d 39 × 4h | meteora | volume-history |
| high-vol-trending | train | AAVE-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | QI-SOL | 100 | 4d 24 × 4h | meteora | volume-history |
| high-vol-trending | train | DOPE-SOL | 100 | 2d 11 × 4h | meteora | volume-history |
| high-vol-trending | train | GRASS-SOL | 15 | 70d 71 × 24h | meteora | volume-history |
| high-vol-trending | holdout | VVV-SOL | 50 | 7d 41 × 4h | meteora | volume-history |
| high-vol-trending | train | INJ-USDC | 15 | 26d 27 × 24h | meteora | volume-history |
| high-vol-trending | holdout | RACE-USDC | 10 | 6d 39 × 4h | meteora | volume-history |
| high-vol-trending | train | SI-SOL | 100 | 22d 23 × 24h | meteora | volume-history |
| high-vol-trending | train | HYPE-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | STRK-SOL | 80 | 83d 84 × 24h | meteora | volume-history |
| high-vol-trending | holdout | XMR-SOL | 20 | 35d 36 × 24h | meteora | volume-history |
| high-vol-trending | train | HOOKED-SOL | 30 | 10d 63 × 4h | meteora | volume-history |
| high-vol-trending | train | CLAUDIA-USDC | 80 | 3d 19 × 4h | meteora | volume-history |
| high-vol-trending | train | DOPE-SOL | 80 | 2d 10 × 4h | meteora | volume-history |
| high-vol-trending | train | QI-SOL | 125 | 4d 22 × 4h | meteora | volume-history |
| high-vol-trending | holdout | SPCX-USDC | 75 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | GRASS-SOL | 50 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | DARK-USDC | 50 | 5d 32 × 4h | meteora | volume-history |
| high-vol-trending | holdout | RACE-SOL | 20 | 7d 40 × 4h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | STONK-SOL | 20 | 62d 63 × 24h | meteora | volume-history |
| established-midcap | train | BP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANSEM-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZEC-SOL | 15 | 53d 54 × 24h | meteora | volume-history |
| established-midcap | train | ANTFUN-USDT | 16 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CARDS-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | NVDAx-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | PENGU-USDC | 25 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | Bonk-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZCAT-SOL | 80 | 37d 38 × 24h | meteora | volume-history |
| established-midcap | holdout | FO-USDT | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | USELESS-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CATE-SOL | 50 | 78d 79 × 24h | meteora | volume-history |
| established-midcap | holdout | GOOGLx-SOL | 20 | 84d 85 × 24h | meteora | volume-history |
| established-midcap | train | JLP-JitoSOL | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 4 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZEC-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | BP-SOL | 20 | 36d 37 × 24h | meteora | volume-history |
| established-midcap | train | STONK-USDC | 8 | 25d 26 × 24h | meteora | volume-history |
| established-midcap | train | CATE-USDC | 20 | 72d 73 × 24h | meteora | volume-history |
| established-midcap | train | CARDS-SOL | 100 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | JLP-USDC | 2 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | PENGU-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZCAT-USDC | 20 | 36d 37 × 24h | meteora | volume-history |
| established-midcap | train | Bonk-SOL | 100 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANSEM-SOL | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | USELESS-STONK | 100 | 16d 97 × 4h | meteora | volume-history |
| older-memecoin | train | wNEAR-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | MU-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | SKHY-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | baton-SOL | 50 | 29d 30 × 24h | meteora | volume-history |
| older-memecoin | train | BORDR-SOL | 100 | 5d 32 × 4h | meteora | volume-history |
| older-memecoin | train | Agency-SOL | 50 | 10d 58 × 4h | meteora | volume-history |
| older-memecoin | train | CTM-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | tOpenAI-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | JEANPHIL-SOL | 100 | 23d 24 × 24h | meteora | volume-history |
| older-memecoin | holdout | PEPE-SOL | 20 | 25d 26 × 24h | meteora | volume-history |
| older-memecoin | train | HOTBOT-SOL | 100 | 11d 67 × 4h | meteora | volume-history |
| older-memecoin | train | CRAWL-SOL | 100 | 9d 57 × 4h | meteora | volume-history |
| older-memecoin | train | KLED-SOL | 50 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | MASK-SOL | 200 | 16d 97 × 4h | meteora | volume-history |
| older-memecoin | train | ENA-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | tSpaceX-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | PAID-SOL | 30 | 25d 26 × 24h | meteora | volume-history |
| older-memecoin | train | EMBER-SOL | 50 | 31d 32 × 24h | meteora | volume-history |
| older-memecoin | train | baton-SOL | 80 | 33d 34 × 24h | meteora | volume-history |
| older-memecoin | holdout | MU-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | CRAWL-SOL | 80 | 9d 55 × 4h | meteora | volume-history |
| older-memecoin | train | PAID-SOL | 80 | 28d 29 × 24h | meteora | volume-history |
| older-memecoin | train | KLED-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | Agency-SOL | 100 | 11d 66 × 4h | meteora | volume-history |
| older-memecoin | holdout | PEPE-SOL | 10 | 23d 24 × 24h | meteora | volume-history |
| older-memecoin | train | JEANPHIL-SOL | 50 | 21d 22 × 24h | meteora | volume-history |
| older-memecoin | train | BORDR-USDC | 80 | 5d 32 × 4h | meteora | volume-history |
| older-memecoin | train | EMBER-USDC | 200 | 34d 35 × 24h | meteora | volume-history |
| older-memecoin | train | HOTBOT-USDC | 80 | 3d 19 × 4h | meteora | volume-history |
| older-memecoin | holdout | SKHY-SOL | 20 | 76d 77 × 24h | meteora | volume-history |
| older-memecoin | train | MASK-SOL | 20 | 11d 66 × 4h | meteora | volume-history |

## stable

No strategy has 8 or more train trials, so nothing is promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | `grid-spot-narrow-quote-rebalance` | 3 | 1.89% | 1.02% | 5 | -1.94% | $-11.02 |  |
| — | `grid-spot-narrow-token-rebalance` | 3 | 1.88% | 1.65% | 5 | -2.02% | $-8.80 |  |
| — | `grid-curve-narrow-token-rebalance` | 3 | 1.70% | 1.63% | 5 | -2.21% | $-9.21 |  |
| — | `grid-spot-narrow-two-rebalance` | 3 | 1.63% | 0.88% | 5 | -2.75% | $-9.76 |  |
| — | `grid-curve-narrow-quote-rebalance` | 3 | 1.61% | 0.92% | 5 | -2.08% | $-11.57 |  |
| — | `grid-curve-narrow-quote-stay-array` | 3 | 1.60% | 1.50% | 5 | 0.16% | $-0.98 |  |
| — | `grid-spot-narrow-quote-stay-array` | 3 | 1.60% | 1.50% | 5 | 0.09% | $-1.01 |  |
| — | `grid-curve-medium-quote-stay-array` | 3 | 1.60% | 1.50% | 5 | 0.16% | $-0.97 |  |
| — | `grid-spot-medium-quote-stay-array` | 3 | 1.60% | 1.50% | 5 | 0.09% | $-1.01 |  |
| — | `grid-curve-narrow-two-rebalance` | 3 | 1.48% | 0.81% | 5 | -3.04% | $-9.31 |  |

Top train row vs holding: train $7.29, time-split $17.74, holdout $-11.02 (mean dollars versus buying and holding the entry tokens).

## bluechip

grid-curve-narrow-token-rebalance passed the time split (median 18.09%, mean 227.99%) but the cost-adjusted holdout did not beat cash (n=5, median -17.83%, mean 36.96%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-quote-rebalance` | 19 | 13.40% | 14.00% | 5 | -19.80% | $87.74 |  |
| 2 | `grid-curve-narrow-two-rebalance` | 19 | 12.22% | 10.94% | 5 | -18.93% | $-73.54 |  |
| 3 | `grid-curve-narrow-token-rebalance` | 19 | 10.99% | 18.09% | 5 | -17.83% | $-192.52 |  |
| 4 | `grid-spot-narrow-token-timeout` | 19 | 0.64% | 2.43% | 5 | 0.27% | $-272.62 |  |
| 5 | `grid-curve-narrow-token-timeout` | 19 | 0.60% | 2.20% | 5 | 0.25% | $-270.26 |  |
| 6 | `grid-bidask-narrow-token-timeout` | 19 | 0.55% | 3.13% | 5 | 0.24% | $-275.01 |  |
| 7 | `grid-spot-narrow-token-patient-array` | 19 | 0.50% | 5.30% | 5 | 0.27% | $-263.59 |  |
| 8 | `grid-spot-narrow-token-stay-array` | 19 | 0.50% | 3.88% | 5 | 0.54% | $-264.27 |  |
| 9 | `grid-curve-narrow-token-patient-array` | 19 | 0.46% | 7.05% | 5 | 0.25% | $-259.93 |  |
| 10 | `grid-curve-narrow-token-stay-array` | 19 | 0.46% | 3.96% | 5 | 0.46% | $-260.66 |  |

Top train row vs holding: train $526.15, time-split $557.37, holdout $87.74 (mean dollars versus buying and holding the entry tokens).

## fresh-memecoin

grid-curve-narrow-quote-rebalance passed the time split (median 16.88%, mean 108.34%) but the cost-adjusted holdout did not beat cash (n=3, median 1041.92%, mean 1610.71%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-token-rebalance` | 8 | 204.12% | 11.02% | 3 | 1314.20% | $4624.77 |  |
| 2 | `grid-curve-narrow-quote-rebalance` | 8 | 181.77% | 16.88% | 3 | 1041.92% | $4026.78 |  |
| 3 | `grid-curve-narrow-two-rebalance` | 8 | 173.35% | 11.70% | 3 | 1140.36% | $3858.50 |  |
| 4 | `grid-spot-narrow-two-rebalance` | 8 | 149.59% | 10.50% | 3 | 1161.14% | $3879.05 |  |
| 5 | `grid-curve-narrow-quote-patient-array` | 8 | 141.81% | 1.83% | 3 | 171.02% | $455.14 |  |
| 6 | `grid-curve-narrow-quote-stay-array` | 8 | 141.81% | 1.83% | 3 | 171.02% | $455.14 |  |
| 7 | `grid-spot-narrow-quote-rebalance` | 8 | 134.96% | 12.03% | 3 | 1124.71% | $3854.61 |  |
| 8 | `grid-spot-narrow-token-rebalance` | 8 | 134.33% | 7.33% | 3 | 1094.38% | $3509.52 |  |
| 9 | `grid-bidask-narrow-two-rebalance` | 8 | 125.55% | 9.30% | 3 | 1021.12% | $3534.31 |  |
| 10 | `grid-bidask-narrow-quote-rebalance` | 8 | 69.81% | 5.02% | 3 | 834.59% | $3019.16 |  |

Top train row vs holding: train $3723.48, time-split $294.30, holdout $4624.77 (mean dollars versus buying and holding the entry tokens).

## high-vol-trending

grid-curve-narrow-token-rebalance is promoted: train rank 1, time-split n=21 median 15.09%, holdout n=9 median 41.91%, holdout vs token $621.11, largest coin 44.16% of positive PnL.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-token-rebalance` | 21 | 22.98% | 15.09% | 9 | 41.91% | $621.11 | yes |
| 2 | `grid-curve-narrow-quote-rebalance` | 21 | 15.78% | 12.50% | 9 | 46.45% | $526.52 |  |
| 3 | `grid-curve-narrow-quote-patient-array` | 21 | 8.88% | 3.19% | 9 | 0.27% | $454.74 |  |
| 4 | `grid-curve-narrow-quote-stay-array` | 21 | 8.88% | 2.79% | 9 | -8.10% | $449.12 |  |
| 5 | `grid-curve-narrow-quote-timeout` | 21 | 8.84% | 2.79% | 9 | 0.08% | $77.74 |  |
| 6 | `grid-curve-narrow-two-rebalance` | 21 | 8.45% | 1.99% | 9 | 25.88% | $580.41 |  |
| 7 | `grid-spot-narrow-two-patient-array` | 21 | 8.15% | 3.12% | 9 | -7.09% | $265.86 |  |
| 8 | `grid-spot-narrow-two-stay-array` | 21 | 8.15% | 2.95% | 9 | -8.20% | $265.33 |  |
| 9 | `grid-curve-narrow-two-patient-array` | 21 | 6.93% | 3.85% | 9 | -7.30% | $367.57 |  |
| 10 | `grid-curve-narrow-two-stay-array` | 21 | 6.93% | 3.46% | 9 | -8.23% | $367.04 |  |

Top train row vs holding: train $402.18, time-split $191.64, holdout $621.11 (mean dollars versus buying and holding the entry tokens).

## established-midcap

grid-curve-narrow-two-timeout passed the time split (median 2.26%, mean 11.97%) but the cost-adjusted holdout did not beat cash (n=7, median -1.02%, mean -2.79%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-narrow-token-timeout` | 25 | 0.71% | 1.39% | 7 | -0.89% | $-44.42 |  |
| 2 | `grid-curve-narrow-token-timeout` | 25 | 0.64% | 1.65% | 7 | -0.68% | $-37.70 |  |
| 3 | `grid-spot-narrow-token-timeout` | 25 | 0.62% | 1.52% | 7 | -0.89% | $-39.11 |  |
| 4 | `grid-bidask-narrow-two-timeout` | 25 | 0.48% | 1.51% | 7 | -2.06% | $-26.43 |  |
| 5 | `grid-spot-narrow-two-timeout` | 25 | 0.48% | 1.50% | 7 | -1.54% | $-26.21 |  |
| 6 | `grid-curve-narrow-two-timeout` | 25 | 0.47% | 2.26% | 7 | -1.02% | $-25.99 |  |
| 7 | `grid-curve-narrow-quote-timeout` | 25 | 0.19% | 2.03% | 7 | -0.21% | $-6.34 |  |
| 8 | `grid-curve-narrow-quote-oor` | 25 | 0.08% | 2.07% | 7 | 0.01% | $-1.41 |  |
| 9 | `grid-curve-narrow-quote-tp` | 25 | 0.08% | 2.07% | 7 | 0.01% | $-1.41 |  |
| 10 | `grid-spot-narrow-quote-timeout` | 25 | 0.07% | 0.95% | 7 | -1.54% | $-7.13 |  |

Top train row vs holding: train $-307.96, time-split $3.58, holdout $-44.42 (mean dollars versus buying and holding the entry tokens).

## older-memecoin

grid-curve-narrow-quote-oor led the time-split test among the top 5 yield strategies, but the test median (-3.19%) and mean (-5.49%) are not both positive, so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-token-patient-array` | 23 | 2.08% | -5.24% | 8 | -9.28% | $19.16 |  |
| 2 | `grid-spot-narrow-token-patient-array` | 23 | 2.08% | -19.29% | 8 | -9.37% | $14.86 |  |
| 3 | `grid-spot-narrow-two-patient-array` | 23 | 0.88% | -22.22% | 8 | -8.38% | $35.68 |  |
| 4 | `grid-curve-narrow-two-patient-array` | 23 | 0.76% | -22.33% | 8 | -8.49% | $36.53 |  |
| 5 | `grid-curve-narrow-quote-oor` | 23 | 0.04% | -3.19% | 8 | 0.06% | $9.42 |  |
| 6 | `grid-curve-narrow-quote-tp` | 23 | 0.04% | -0.55% | 8 | 0.06% | $9.42 |  |
| 7 | `grid-spot-narrow-quote-oor` | 23 | 0.02% | -3.03% | 8 | 0.03% | $5.09 |  |
| 8 | `grid-spot-narrow-quote-tp` | 23 | 0.02% | -3.03% | 8 | 0.03% | $5.09 |  |
| 9 | `grid-bidask-narrow-quote-oor` | 23 | -0.58% | -2.86% | 8 | 0.01% | $0.76 |  |
| 10 | `grid-bidask-narrow-quote-tp` | 23 | -0.58% | -2.86% | 8 | 0.01% | $0.76 |  |

Top train row vs holding: train $-133.71, time-split $-91.76, holdout $19.16 (mean dollars versus buying and holding the entry tokens).

Full rows, including strategies with no trials, are in `reports/leaderboard.csv`.

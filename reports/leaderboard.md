# Strategy tournament leaderboard

Generated 2026-10-12T07:25:50.758Z. Paper only. Deposit size $250 per trial.

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

Accepted pools: 135. Skipped: 5.

| Bucket | Role | Pool | Bin step | History | Source | Fees |
| --- | --- | --- | --- | --- | --- | --- |
| stable | train | USDe-USDG | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | train | USDC-USDT | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | holdout | EURC-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| stable | train | PYUSD-USDC | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | train | USDC-USDT | 8 | 90d 91 × 24h | meteora | volume-history |
| stable | train | USDC-USDT | 16 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-SOL | 2 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-SOL | 10 | 85d 86 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JitoSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | BTC-SOL | 200 | 36d 37 × 24h | meteora | volume-history |
| bluechip | holdout | mSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-SOL | 5 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 16 | 60d 61 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | USDC-JitoSOL | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-ETH | 50 | 90d 91 × 24h | meteora | volume-history |
| fresh-memecoin | train | DOPE-SOL | 100 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | train | Nuts-SOL | 100 | 1d 15 × 1h | meteora | volume-history |
| fresh-memecoin | train | Normie-SOL | 100 | 1d 16 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | FARM-SOL | 100 | 0d 11 × 1h | meteora | volume-history |
| fresh-memecoin | train | Malfoid-USDC | 400 | 1d 21 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | GANG-SOL | 200 | 1d 14 × 1h | meteora | volume-history |
| fresh-memecoin | train | INMUKING-SOL | 100 | 0d 11 × 1h | meteora | volume-history |
| fresh-memecoin | train | ASTER-SOL | 80 | 0d 11 × 1h | meteora | volume-history |
| fresh-memecoin | train | DOPE-SOL | 80 | 1d 15 × 1h | meteora | volume-history |
| fresh-memecoin | train | DOPE-SOL | 125 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | train | Normie-USDC | 400 | 1d 23 × 1h | meteora | volume-history |
| high-vol-trending | holdout | STRK-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | baton-SOL | 80 | 32d 33 × 24h | meteora | volume-history |
| high-vol-trending | holdout | SPCX-SOL | 10 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | MUSK-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | Agency-SOL | 50 | 9d 52 × 4h | meteora | volume-history |
| high-vol-trending | train | BORDR-SOL | 100 | 4d 26 × 4h | meteora | volume-history |
| high-vol-trending | holdout | TTWO-USDC | 10 | 31d 32 × 24h | meteora | volume-history |
| high-vol-trending | train | Incognito-SOL | 100 | 1d 27 × 1h | meteora | volume-history |
| high-vol-trending | train | GRASS-SOL | 15 | 69d 70 × 24h | meteora | volume-history |
| high-vol-trending | holdout | SWOLF-SOL | 100 | 3d 18 × 4h | meteora | volume-history |
| high-vol-trending | train | HIGGS-SOL | 100 | 8d 47 × 4h | meteora | volume-history |
| high-vol-trending | train | INJ-USDC | 15 | 25d 26 × 24h | meteora | volume-history |
| high-vol-trending | train | Altai-SOL | 250 | 2d 11 × 4h | meteora | volume-history |
| high-vol-trending | train | KLED-SOL | 50 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | -SOL | 100 | 55d 56 × 24h | meteora | volume-history |
| high-vol-trending | train | ALOIS-SOL | 100 | 1d 35 × 1h | meteora | volume-history |
| high-vol-trending | holdout | VVV-SOL | 50 | 6d 35 × 4h | meteora | volume-history |
| high-vol-trending | train | PQC-SOL | 100 | 4d 26 × 4h | meteora | volume-history |
| high-vol-trending | holdout | STRK-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | baton-SOL | 50 | 28d 29 × 24h | meteora | volume-history |
| high-vol-trending | train | Agency-SOL | 100 | 10d 60 × 4h | meteora | volume-history |
| high-vol-trending | holdout | SWOLF-SOL | 125 | 2d 10 × 4h | meteora | volume-history |
| high-vol-trending | train | GRASS-SOL | 50 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | TTWO-SOL | 80 | 27d 28 × 24h | meteora | volume-history |
| high-vol-trending | train | CYBERLEEK-SOL | 200 | 50d 51 × 24h | meteora | volume-history |
| high-vol-trending | train | KLED-SOL | 100 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | BORDR-USDC | 80 | 4d 26 × 4h | meteora | volume-history |
| high-vol-trending | holdout | SPCX-USDC | 75 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | Altai-SOL | 100 | 2d 10 × 4h | meteora | volume-history |
| high-vol-trending | train | INJ-SOL | 50 | 14d 82 × 4h | meteora | volume-history |
| high-vol-trending | train | PQC-SOL | 125 | 4d 22 × 4h | meteora | volume-history |
| established-midcap | train | SOL-HYPE | 4 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | Bonk-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | STONK-SOL | 20 | 61d 62 × 24h | meteora | volume-history |
| established-midcap | train | BP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANTFUN-USDT | 16 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | PENGU-USDC | 25 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CARDS-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | SI-SOL | 100 | 21d 22 × 24h | meteora | volume-history |
| established-midcap | train | ANSEM-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZCAT-SOL | 80 | 36d 37 × 24h | meteora | volume-history |
| established-midcap | train | ZEC-SOL | 15 | 52d 53 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | NVDAx-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | MASK-SOL | 200 | 16d 97 × 4h | meteora | volume-history |
| established-midcap | train | USELESS-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | JupSOL-INF | 1 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | HYPE-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 4 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | SI-SOL | 30 | 13d 76 × 4h | meteora | volume-history |
| established-midcap | train | STONK-USDC | 8 | 24d 25 × 24h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZEC-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | BP-SOL | 20 | 35d 36 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CARDS-SOL | 100 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | Bonk-SOL | 100 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | PENGU-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANSEM-SOL | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZCAT-USDC | 20 | 35d 36 × 24h | meteora | volume-history |
| older-memecoin | train | wNEAR-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | CLAUDIA-SOL | 125 | 5d 32 × 4h | meteora | volume-history |
| older-memecoin | holdout | SKHY-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | HOOKED-SOL | 50 | 13d 81 × 4h | meteora | volume-history |
| older-memecoin | train | DARK-SOL | 75 | 5d 33 × 4h | meteora | volume-history |
| older-memecoin | train | QI-SOL | 100 | 3d 18 × 4h | meteora | volume-history |
| older-memecoin | train | ENA-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | CTM-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | HOTBOT-SOL | 100 | 10d 61 × 4h | meteora | volume-history |
| older-memecoin | holdout | ANTHROPIC-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | PEPE-SOL | 20 | 24d 25 × 24h | meteora | volume-history |
| older-memecoin | train | JEANPHIL-SOL | 100 | 22d 23 × 24h | meteora | volume-history |
| older-memecoin | train | CRAWL-SOL | 100 | 8d 51 × 4h | meteora | volume-history |
| older-memecoin | train | MU-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | PAID-SOL | 30 | 24d 25 × 24h | meteora | volume-history |
| older-memecoin | holdout | XMR-USDC | 10 | 32d 33 × 24h | meteora | volume-history |
| older-memecoin | holdout | tSpaceX-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | swordcat-SOL | 100 | 14d 84 × 4h | meteora | volume-history |
| older-memecoin | train | CLAUDIA-USDC | 80 | 2d 13 × 4h | meteora | volume-history |
| older-memecoin | train | HOOKED-SOL | 30 | 9d 57 × 4h | meteora | volume-history |
| older-memecoin | holdout | ANTHROPIC-USDC | 15 | 61d 62 × 24h | meteora | volume-history |
| older-memecoin | train | CRAWL-SOL | 80 | 8d 49 × 4h | meteora | volume-history |
| older-memecoin | holdout | PEPE-SOL | 10 | 22d 23 × 24h | meteora | volume-history |
| older-memecoin | train | DARK-USDC | 50 | 4d 26 × 4h | meteora | volume-history |
| older-memecoin | train | QI-SOL | 125 | 3d 16 × 4h | meteora | volume-history |
| older-memecoin | holdout | XMR-SOL | 20 | 34d 35 × 24h | meteora | volume-history |
| older-memecoin | train | JEANPHIL-SOL | 50 | 20d 21 × 24h | meteora | volume-history |
| older-memecoin | train | PAID-SOL | 100 | 27d 28 × 24h | meteora | volume-history |
| older-memecoin | train | MU-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | HOTBOT-USDC | 80 | 2d 13 × 4h | meteora | volume-history |
| older-memecoin | train | swordcat-USDC | 80 | 9d 56 × 4h | meteora | volume-history |
| older-memecoin | holdout | SKHY-SOL | 100 | 90d 91 × 24h | meteora | volume-history |

## stable

No strategy has 8 or more train trials, so nothing is promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | `grid-spot-narrow-two-stay-array` | 5 | 1.66% | 1.76% | 1 | 0.16% | $2.38 |  |
| — | `grid-spot-medium-two-stay-array` | 5 | 1.66% | 1.36% | 1 | -2.25% | $-3.64 |  |
| — | `grid-spot-medium-two-patient-array` | 5 | 1.66% | 1.36% | 1 | -2.28% | $-3.72 |  |
| — | `grid-curve-narrow-two-stay-array` | 5 | 1.65% | 1.76% | 1 | 0.15% | $2.36 |  |
| — | `grid-curve-medium-two-stay-array` | 5 | 1.65% | 1.52% | 1 | -2.37% | $-3.95 |  |
| — | `grid-curve-medium-two-patient-array` | 5 | 1.65% | 1.52% | 1 | -2.40% | $-4.01 |  |
| — | `grid-spot-medium-quote-stay-array` | 5 | 1.13% | 1.76% | 1 | 0.03% | $0.06 |  |
| — | `grid-spot-narrow-quote-stay-array` | 5 | 1.13% | 1.76% | 1 | 0.03% | $0.06 |  |
| — | `grid-spot-medium-quote-patient-array` | 5 | 1.13% | 0.33% | 1 | 0.03% | $0.06 |  |
| — | `grid-spot-narrow-quote-patient-array` | 5 | 1.13% | 0.33% | 1 | 0.03% | $0.06 |  |

Top train row vs holding: train $3.77, time-split $18.47, holdout $2.38 (mean dollars versus buying and holding the entry tokens).

## bluechip

grid-spot-medium-token-stay-array led the time-split test among the top 5 yield strategies, but the test median (0.54%) and mean (-1.32%) are not both positive, so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-spot-medium-token-stay-array` | 17 | 0.45% | 0.54% | 7 | -0.53% | $-208.02 |  |
| 2 | `grid-spot-narrow-two-timeout` | 17 | 0.45% | 0.29% | 7 | 0.41% | $-100.76 |  |
| 3 | `grid-curve-narrow-two-timeout` | 17 | 0.44% | 0.38% | 7 | 0.49% | $-100.23 |  |
| 4 | `grid-bidask-narrow-two-timeout` | 17 | 0.44% | 0.24% | 7 | 0.32% | $-101.29 |  |
| 5 | `grid-curve-narrow-token-timeout` | 17 | 0.33% | 0.25% | 7 | 0.51% | $-203.52 |  |
| 6 | `grid-curve-narrow-token-oor` | 17 | 0.33% | -0.95% | 7 | -0.04% | $-206.26 |  |
| 7 | `grid-curve-narrow-token-tp` | 17 | 0.33% | -0.40% | 7 | -0.04% | $-206.26 |  |
| 8 | `grid-spot-narrow-token-timeout` | 17 | 0.25% | -0.34% | 7 | 0.68% | $-204.83 |  |
| 9 | `grid-spot-narrow-two-oor` | 17 | 0.22% | 0.28% | 7 | 0.16% | $-103.35 |  |
| 10 | `grid-spot-narrow-two-tp` | 17 | 0.22% | 0.28% | 7 | 0.16% | $-103.35 |  |

Top train row vs holding: train $-30.47, time-split $-19.68, holdout $-208.02 (mean dollars versus buying and holding the entry tokens).

## fresh-memecoin

grid-curve-narrow-token-patient-array led the time-split test among the top 5 yield strategies, but the test median (-7.95%) and mean (-4.39%) are not both positive, so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-spot-medium-token-patient-array` | 9 | 24.02% | -24.28% | 2 | 44.16% | $-248.54 |  |
| 2 | `grid-spot-medium-token-stay-array` | 9 | 24.02% | -24.28% | 2 | 44.16% | $-248.54 |  |
| 3 | `grid-curve-narrow-token-patient-array` | 9 | 11.43% | -7.95% | 2 | 35.93% | $-269.12 |  |
| 4 | `grid-curve-narrow-token-stay-array` | 9 | 11.43% | -7.95% | 2 | 35.93% | $-269.12 |  |
| 5 | `grid-curve-narrow-token-timeout` | 9 | 11.43% | -7.95% | 2 | 44.52% | $-247.65 |  |
| 6 | `grid-spot-narrow-token-patient-array` | 9 | 10.66% | -15.30% | 2 | 34.90% | $-271.70 |  |
| 7 | `grid-spot-narrow-token-stay-array` | 9 | 10.66% | -15.30% | 2 | 34.90% | $-271.70 |  |
| 8 | `grid-spot-broad-two-patient` | 9 | 10.32% | -25.77% | 2 | 69.57% | $-5.55 |  |
| 9 | `grid-spot-broad-two-stay` | 9 | 10.32% | -25.77% | 2 | 69.57% | $-5.55 |  |
| 10 | `grid-spot-broad-two-guard` | 9 | 10.32% | -25.77% | 2 | 69.57% | $-5.55 |  |

Top train row vs holding: train $-213.65, time-split $12.30, holdout $-248.54 (mean dollars versus buying and holding the entry tokens).

## high-vol-trending

grid-spot-narrow-token-patient-array passed the time split (median 6.63%, mean 30.34%) but the cost-adjusted holdout did not beat cash (n=9, median -4.32%, mean 231.84%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-spot-narrow-token-patient-array` | 22 | 13.28% | 6.63% | 9 | -4.32% | $429.22 |  |
| 2 | `grid-spot-narrow-two-patient-array` | 22 | 12.29% | -4.16% | 9 | -1.97% | $130.26 |  |
| 3 | `grid-curve-narrow-token-rebalance` | 22 | 11.29% | -4.81% | 9 | -21.04% | $890.24 |  |
| 4 | `grid-curve-narrow-token-patient-array` | 22 | 10.99% | 6.41% | 9 | -4.31% | $626.08 |  |
| 5 | `grid-curve-narrow-two-patient-array` | 22 | 10.89% | -4.19% | 9 | -7.58% | $208.89 |  |
| 6 | `grid-curve-narrow-quote-rebalance` | 22 | 10.19% | -7.72% | 9 | -20.10% | $954.52 |  |
| 7 | `grid-curve-narrow-quote-patient-array` | 22 | 8.94% | -2.83% | 9 | 0.18% | $351.20 |  |
| 8 | `grid-curve-narrow-token-stay-array` | 22 | 7.70% | 2.59% | 9 | -7.98% | $628.06 |  |
| 9 | `grid-spot-narrow-quote-patient-array` | 22 | 6.35% | -2.97% | 9 | -0.30% | $211.61 |  |
| 10 | `grid-spot-narrow-two-stay-array` | 22 | 6.04% | -0.46% | 9 | -10.00% | $135.06 |  |

Top train row vs holding: train $667.49, time-split $-94.09, holdout $429.22 (mean dollars versus buying and holding the entry tokens).

## established-midcap

grid-curve-narrow-token-timeout passed the time split (median 1.58%, mean 2.48%) but the cost-adjusted holdout did not beat cash (n=7, median -2.25%, mean -5.45%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-spot-narrow-token-timeout` | 24 | 0.47% | 0.24% | 7 | -2.35% | $-100.05 |  |
| 2 | `grid-curve-narrow-token-timeout` | 24 | 0.42% | 1.58% | 7 | -2.25% | $-99.96 |  |
| 3 | `grid-bidask-narrow-two-timeout` | 24 | 0.38% | -0.16% | 7 | -0.01% | $-51.03 |  |
| 4 | `grid-spot-narrow-two-timeout` | 24 | 0.36% | 0.40% | 7 | 0.01% | $-51.10 |  |
| 5 | `grid-curve-narrow-two-timeout` | 24 | 0.33% | 1.19% | 7 | 0.03% | $-51.18 |  |
| 6 | `grid-bidask-narrow-token-timeout` | 24 | 0.04% | 0.36% | 7 | -2.45% | $-100.13 |  |
| 7 | `grid-curve-narrow-quote-timeout` | 24 | 0.02% | 0.64% | 7 | -0.84% | $-8.03 |  |
| 8 | `grid-curve-narrow-quote-oor` | 24 | 0.01% | 2.70% | 7 | 0.06% | $-4.30 |  |
| 9 | `grid-curve-narrow-quote-tp` | 24 | 0.01% | 2.70% | 7 | 0.06% | $-4.30 |  |
| 10 | `grid-spot-narrow-quote-oor` | 24 | 0.01% | 1.48% | 7 | 0.04% | $-4.09 |  |

Top train row vs holding: train $-272.67, time-split $-24.97, holdout $-100.05 (mean dollars versus buying and holding the entry tokens).

## older-memecoin

grid-curve-narrow-two-timeout led the time-split test among the top 5 yield strategies, but the test median (-8.56%) and mean (-9.31%) are not both positive, so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-wide-two-oor` | 23 | 2.16% | -17.61% | 9 | -3.08% | $-19.85 |  |
| 2 | `grid-curve-narrow-token-timeout` | 23 | 0.88% | -12.73% | 9 | 1.39% | $22.14 |  |
| 3 | `grid-spot-narrow-token-timeout` | 23 | 0.80% | -13.50% | 9 | 1.17% | $15.13 |  |
| 4 | `grid-curve-narrow-token-patient-array` | 23 | 0.76% | -22.13% | 9 | 1.35% | $74.47 |  |
| 5 | `grid-bidask-narrow-two-timeout` | 23 | 0.44% | -9.01% | 9 | -2.51% | $6.02 |  |
| 6 | `grid-spot-narrow-two-timeout` | 23 | 0.41% | -8.78% | 9 | -2.58% | $8.04 |  |
| 7 | `grid-curve-narrow-two-timeout` | 23 | 0.37% | -8.56% | 9 | -2.65% | $10.06 |  |
| 8 | `grid-curve-narrow-quote-timeout` | 23 | 0.03% | -13.59% | 9 | -3.17% | $71.17 |  |
| 9 | `grid-spot-narrow-quote-timeout` | 23 | 0.02% | -13.61% | 9 | -3.19% | $84.32 |  |
| 10 | `grid-bidask-narrow-quote-timeout` | 23 | 0.01% | -4.29% | 9 | -3.20% | $97.48 |  |

Top train row vs holding: train $-199.30, time-split $-56.15, holdout $-19.85 (mean dollars versus buying and holding the entry tokens).

Full rows, including strategies with no trials, are in `reports/leaderboard.csv`.

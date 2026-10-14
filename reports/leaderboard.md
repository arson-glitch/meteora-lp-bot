# Strategy tournament leaderboard

Generated 2026-10-14T07:32:26.883Z. Paper only. Deposit size $250 per trial.

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

Accepted pools: 129. Skipped: 2.

| Bucket | Role | Pool | Bin step | History | Source | Fees |
| --- | --- | --- | --- | --- | --- | --- |
| stable | train | USDe-USDG | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | train | USDC-USDT | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | train | PYUSD-USDC | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | holdout | EURC-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| stable | train | USDC-USDT | 8 | 90d 91 × 24h | meteora | volume-history |
| stable | train | USDC-USDT | 16 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-SOL | 2 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JitoSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | mSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-SOL | 10 | 87d 88 × 24h | meteora | volume-history |
| bluechip | train | JUP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-SOL | 5 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 16 | 62d 63 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | USDC-JitoSOL | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-ETH | 50 | 90d 91 × 24h | meteora | volume-history |
| fresh-memecoin | train | SEALS-SOL | 100 | 1d 20 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | VEIL-SOL | 20 | 0d 9 × 1h | meteora | volume-history |
| fresh-memecoin | train | CMG-USDC | 50 | 1d 17 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | FLOYD-SOL | 200 | 0d 11 × 1h | meteora | volume-history |
| fresh-memecoin | train | TXGYM-SOL | 100 | 0d 8 × 1h | meteora | volume-history |
| fresh-memecoin | train | GFPU-USDT | 10 | 1d 24 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | VEIL-SOL | 125 | 1d 36 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | VEIL-SOL | 50 | 1d 14 × 1h | meteora | volume-history |
| fresh-memecoin | train | CMG-SOL | 20 | 1d 16 × 1h | meteora | volume-history |
| high-vol-trending | holdout | SPCX-SOL | 10 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | MUSK-USDC | 100 | 89d 90 × 24h | meteora | volume-history |
| high-vol-trending | train | HOOKED-SOL | 50 | 15d 93 × 4h | meteora | volume-history |
| high-vol-trending | train | BORDR-SOL | 100 | 6d 38 × 4h | meteora | volume-history |
| high-vol-trending | holdout | Altai-SOL | 100 | 4d 22 × 4h | meteora | volume-history |
| high-vol-trending | train | CLAUDIA-SOL | 125 | 7d 44 × 4h | meteora | volume-history |
| high-vol-trending | holdout | MASK-SOL | 200 | 16d 97 × 4h | meteora | volume-history |
| high-vol-trending | train | LOAD-SOL | 20 | 2d 10 × 4h | meteora | volume-history |
| high-vol-trending | train | QI-SOL | 100 | 5d 30 × 4h | meteora | volume-history |
| high-vol-trending | train | EMBER-SOL | 50 | 32d 33 × 24h | meteora | volume-history |
| high-vol-trending | train | DOPE-SOL | 80 | 3d 16 × 4h | meteora | volume-history |
| high-vol-trending | train | OMNI-SOL | 200 | 11d 69 × 4h | meteora | volume-history |
| high-vol-trending | train | HIRE-SOL | 100 | 2d 11 × 4h | meteora | volume-history |
| high-vol-trending | holdout | RACE-USDC | 10 | 7d 45 × 4h | meteora | volume-history |
| high-vol-trending | train | W-SOL | 10 | 2d 14 × 4h | meteora | volume-history |
| high-vol-trending | train | ALLINU-SOL | 50 | 33d 34 × 24h | meteora | volume-history |
| high-vol-trending | train | REA-SOL | 200 | 2d 15 × 4h | meteora | volume-history |
| high-vol-trending | train | si.gov-SOL | 200 | 12d 71 × 4h | meteora | volume-history |
| high-vol-trending | train | HOOKED-SOL | 30 | 11d 69 × 4h | meteora | volume-history |
| high-vol-trending | train | DOPE-SOL | 100 | 3d 17 × 4h | meteora | volume-history |
| high-vol-trending | train | LOAD-SOL | 100 | 2d 10 × 4h | meteora | volume-history |
| high-vol-trending | holdout | Altai-SOL | 250 | 4d 23 × 4h | meteora | volume-history |
| high-vol-trending | train | BORDR-JupUSD | 80 | 2d 14 × 4h | meteora | volume-history |
| high-vol-trending | train | QI-SOL | 125 | 5d 28 × 4h | meteora | volume-history |
| high-vol-trending | train | CLAUDIA-USDC | 80 | 4d 25 × 4h | meteora | volume-history |
| high-vol-trending | holdout | SPCX-USDC | 75 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | EMBER-USDC | 200 | 35d 36 × 24h | meteora | volume-history |
| high-vol-trending | holdout | RACE-USDC | 8 | 7d 45 × 4h | meteora | volume-history |
| high-vol-trending | train | ALLINU-SOL | 100 | 33d 34 × 24h | meteora | volume-history |
| high-vol-trending | holdout | MASK-SOL | 20 | 12d 72 × 4h | meteora | volume-history |
| high-vol-trending | train | W-JTO | 125 | 11d 65 × 4h | meteora | volume-history |
| established-midcap | train | SOL-HYPE | 4 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | STONK-SOL | 20 | 63d 64 × 24h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | BP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANTFUN-USDT | 16 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZEC-SOL | 15 | 54d 55 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANSEM-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | NVDAx-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZCAT-SOL | 80 | 38d 39 × 24h | meteora | volume-history |
| established-midcap | train | CARDS-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | FO-USDT | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | GOOGLx-SOL | 20 | 85d 86 × 24h | meteora | volume-history |
| established-midcap | train | USELESS-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | Bonk-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | PENGU-USDC | 25 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CATE-USDC | 20 | 73d 74 × 24h | meteora | volume-history |
| established-midcap | train | HYPE-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 4 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZEC-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | STONK-USDC | 50 | 38d 39 × 24h | meteora | volume-history |
| established-midcap | train | BP-SOL | 20 | 37d 38 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CATE-SOL | 50 | 79d 80 × 24h | meteora | volume-history |
| established-midcap | train | CARDS-SOL | 100 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZCAT-STONK | 50 | 38d 39 × 24h | meteora | volume-history |
| established-midcap | train | PENGU-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANSEM-SOL | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | Bonk-SOL | 100 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | MU-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | SI-SOL | 30 | 15d 88 × 4h | meteora | volume-history |
| older-memecoin | train | wNEAR-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | SKHY-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | baton-SOL | 80 | 34d 35 × 24h | meteora | volume-history |
| older-memecoin | holdout | tOpenAI-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | DARK-SOL | 75 | 7d 45 × 4h | meteora | volume-history |
| older-memecoin | holdout | XMR-USDC | 10 | 34d 35 × 24h | meteora | volume-history |
| older-memecoin | train | CTM-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | STRK-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | tSpaceX-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | ENA-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | Normie-SOL | 100 | 3d 16 × 4h | meteora | volume-history |
| older-memecoin | train | Agency-SOL | 50 | 11d 64 × 4h | meteora | volume-history |
| older-memecoin | train | ANTHROPIC-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | tKalshi-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | PAID-SOL | 30 | 26d 27 × 24h | meteora | volume-history |
| older-memecoin | train | swordcat-SOL | 100 | 16d 96 × 4h | meteora | volume-history |
| older-memecoin | train | baton-SOL | 50 | 30d 31 × 24h | meteora | volume-history |
| older-memecoin | train | SI-SOL | 100 | 23d 24 × 24h | meteora | volume-history |
| older-memecoin | train | STRK-SOL | 80 | 84d 85 × 24h | meteora | volume-history |
| older-memecoin | train | PAID-SOL | 80 | 29d 30 × 24h | meteora | volume-history |
| older-memecoin | train | ANTHROPIC-USDC | 15 | 63d 64 × 24h | meteora | volume-history |
| older-memecoin | holdout | XMR-SOL | 20 | 36d 37 × 24h | meteora | volume-history |
| older-memecoin | train | Agency-SOL | 100 | 12d 72 × 4h | meteora | volume-history |
| older-memecoin | train | MU-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | DARK-SOL | 50 | 12d 72 × 4h | meteora | volume-history |
| older-memecoin | holdout | SKHY-SOL | 20 | 77d 78 × 24h | meteora | volume-history |
| older-memecoin | train | swordcat-USDC | 80 | 11d 68 × 4h | meteora | volume-history |

## stable

No strategy has 8 or more train trials, so nothing is promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | `grid-spot-medium-two-stay-array` | 5 | 1.63% | 0.67% | 1 | -2.44% | $-3.25 |  |
| — | `grid-spot-medium-two-patient-array` | 5 | 1.63% | 0.67% | 1 | -2.47% | $-3.33 |  |
| — | `grid-curve-medium-two-stay-array` | 5 | 1.63% | 0.59% | 1 | -2.49% | $-3.38 |  |
| — | `grid-curve-medium-two-patient-array` | 5 | 1.63% | 0.59% | 1 | -2.52% | $-3.46 |  |
| — | `grid-curve-medium-quote-stay-array` | 5 | 1.48% | 0.98% | 1 | -2.51% | $-6.28 |  |
| — | `grid-curve-narrow-quote-stay-array` | 5 | 1.48% | 0.94% | 1 | -2.65% | $-6.63 |  |
| — | `grid-spot-medium-quote-stay-array` | 5 | 1.48% | 1.22% | 1 | -2.51% | $-6.28 |  |
| — | `grid-spot-narrow-quote-stay-array` | 5 | 1.48% | 1.36% | 1 | -2.65% | $-6.63 |  |
| — | `grid-curve-narrow-two-stay-array` | 5 | 1.23% | 0.44% | 1 | -1.94% | $-2.01 |  |
| — | `grid-curve-narrow-two-patient-array` | 5 | 1.23% | 0.44% | 1 | -1.69% | $-1.38 |  |

Top train row vs holding: train $4.07, time-split $7.70, holdout $-3.25 (mean dollars versus buying and holding the entry tokens).

## bluechip

grid-curve-narrow-token-stay-array beat cash on the holdout but did not beat holding the token (median -$34.75, mean -$171.25), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-token-stay-array` | 16 | 0.43% | 1.08% | 7 | 0.46% | $-171.25 |  |
| 2 | `grid-spot-narrow-token-stay-array` | 16 | 0.39% | 0.55% | 7 | 0.55% | $-171.29 |  |
| 3 | `grid-curve-narrow-quote-oor` | 16 | 0.27% | 0.56% | 7 | 0.10% | $1.12 |  |
| 4 | `grid-curve-narrow-quote-tp` | 16 | 0.27% | 0.56% | 7 | 0.10% | $1.12 |  |
| 5 | `grid-curve-narrow-two-oor` | 16 | 0.27% | 0.56% | 7 | 0.62% | $-87.49 |  |
| 6 | `grid-curve-narrow-two-tp` | 16 | 0.27% | 0.56% | 7 | 0.62% | $-87.49 |  |
| 7 | `grid-spot-narrow-two-oor` | 16 | 0.27% | 0.48% | 7 | 0.66% | $-87.64 |  |
| 8 | `grid-spot-narrow-two-tp` | 16 | 0.27% | 0.48% | 7 | 0.66% | $-87.64 |  |
| 9 | `grid-bidask-narrow-two-oor` | 16 | 0.26% | 0.40% | 7 | 0.61% | $-87.79 |  |
| 10 | `grid-bidask-narrow-two-tp` | 16 | 0.26% | 0.40% | 7 | 0.61% | $-87.79 |  |

Top train row vs holding: train $-11.46, time-split $-13.55, holdout $-171.25 (mean dollars versus buying and holding the entry tokens).

## fresh-memecoin

No strategy has 8 or more train trials, so nothing is promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | `grid-curve-narrow-quote-rebalance` | 5 | 119.58% | 5.98% | 4 | 84.45% | $2904.13 |  |
| — | `grid-curve-narrow-two-rebalance` | 5 | 114.92% | 4.41% | 4 | 74.02% | $2502.61 |  |
| — | `grid-curve-narrow-token-rebalance` | 5 | 111.56% | 5.51% | 4 | 98.39% | $2359.99 |  |
| — | `grid-spot-narrow-two-rebalance` | 5 | 89.24% | 3.48% | 4 | 67.55% | $2599.36 |  |
| — | `grid-spot-narrow-token-rebalance` | 5 | 77.04% | 3.20% | 4 | 55.11% | $2244.76 |  |
| — | `grid-spot-narrow-quote-rebalance` | 5 | 76.48% | 3.80% | 4 | 56.69% | $2971.74 |  |
| — | `grid-bidask-narrow-two-rebalance` | 5 | 63.50% | 2.51% | 4 | 61.06% | $2285.80 |  |
| — | `grid-bidask-narrow-token-rebalance` | 5 | 42.31% | 0.89% | 4 | 7.89% | $925.92 |  |
| — | `grid-bidask-narrow-quote-rebalance` | 5 | 33.07% | 1.62% | 4 | 21.63% | $2085.58 |  |
| — | `grid-curve-medium-token-rebalance` | 5 | 30.95% | -0.08% | 4 | -1.49% | $1333.98 |  |

Top train row vs holding: train $1772.09, time-split $241.13, holdout $2904.13 (mean dollars versus buying and holding the entry tokens).

## high-vol-trending

grid-curve-narrow-token-patient-array passed the time split (median 17.68%, mean 498.38%) but the cost-adjusted holdout did not beat cash (n=9, median -5.46%, mean 87.79%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-quote-patient-array` | 22 | 100.87% | 15.26% | 9 | -7.10% | $223.52 |  |
| 2 | `grid-spot-narrow-quote-patient-array` | 22 | 93.08% | 0.40% | 9 | -6.62% | $239.70 |  |
| 3 | `grid-spot-narrow-two-patient-array` | 22 | 90.36% | 12.79% | 9 | -5.15% | $121.37 |  |
| 4 | `grid-curve-narrow-two-patient-array` | 22 | 88.06% | 15.44% | 9 | -5.24% | $97.90 |  |
| 5 | `grid-curve-narrow-token-patient-array` | 22 | 72.10% | 17.68% | 9 | -5.46% | $-69.90 |  |
| 6 | `grid-spot-narrow-token-patient-array` | 22 | 59.89% | 5.72% | 9 | -5.58% | $-53.64 |  |
| 7 | `grid-curve-narrow-quote-stay-array` | 22 | 53.25% | 15.26% | 9 | -5.00% | $234.14 |  |
| 8 | `grid-spot-narrow-token-stay-array` | 22 | 53.20% | 4.75% | 9 | -8.30% | $-49.48 |  |
| 9 | `grid-spot-narrow-quote-stay-array` | 22 | 53.14% | 0.40% | 9 | -4.51% | $250.08 |  |
| 10 | `grid-curve-narrow-token-stay-array` | 22 | 49.01% | 14.01% | 9 | -8.30% | $-66.05 |  |

Top train row vs holding: train $432.58, time-split $1296.68, holdout $223.52 (mean dollars versus buying and holding the entry tokens).

## established-midcap

grid-curve-narrow-quote-oor passed the time split (median 1.26%, mean 2.85%) but the cost-adjusted holdout did not beat cash (n=7, median 0.00%, mean -2.31%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-spot-narrow-quote-oor` | 24 | -1.28% | 0.65% | 7 | 0.00% | $-6.05 |  |
| 2 | `grid-spot-narrow-quote-tp` | 24 | -1.28% | 0.65% | 7 | 0.00% | $-6.05 |  |
| 3 | `grid-curve-narrow-quote-oor` | 24 | -1.31% | 1.26% | 7 | 0.00% | $-5.77 |  |
| 4 | `grid-curve-narrow-quote-tp` | 24 | -1.31% | 1.26% | 7 | 0.00% | $-5.77 |  |
| 5 | `grid-spot-narrow-two-timeout` | 24 | -1.52% | 0.90% | 7 | -4.93% | $-31.54 |  |
| 6 | `grid-curve-narrow-two-timeout` | 24 | -1.52% | 0.88% | 7 | -4.96% | $-31.34 |  |
| 7 | `grid-bidask-narrow-two-timeout` | 24 | -1.53% | 0.91% | 7 | -6.20% | $-35.66 |  |
| 8 | `grid-spot-medium-token-patient-array` | 24 | -1.55% | 0.06% | 7 | -6.40% | $-61.84 |  |
| 9 | `grid-bidask-narrow-quote-oor` | 24 | -1.80% | 0.05% | 7 | 0.00% | $-6.32 |  |
| 10 | `grid-bidask-narrow-quote-tp` | 24 | -1.80% | 0.05% | 7 | 0.00% | $-6.32 |  |

Top train row vs holding: train $7.18, time-split $3.58, holdout $-6.05 (mean dollars versus buying and holding the entry tokens).

## older-memecoin

grid-curve-narrow-two-patient-array led the time-split test among the top 5 yield strategies, but the test median (-2.11%) and mean (-5.46%) are not both positive, so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-two-patient-array` | 22 | 0.32% | -2.11% | 7 | -9.67% | $-0.57 |  |
| 2 | `grid-spot-narrow-two-patient-array` | 22 | 0.25% | -2.15% | 7 | -9.53% | $-1.86 |  |
| 3 | `grid-curve-narrow-quote-oor` | 22 | 0.03% | -2.66% | 7 | 0.04% | $17.90 |  |
| 4 | `grid-curve-narrow-quote-tp` | 22 | 0.03% | -2.14% | 7 | 0.04% | $17.90 |  |
| 5 | `grid-spot-narrow-quote-oor` | 22 | 0.02% | -2.61% | 7 | 0.02% | $11.59 |  |
| 6 | `grid-spot-narrow-quote-tp` | 22 | 0.02% | -2.61% | 7 | 0.02% | $11.59 |  |
| 7 | `grid-bidask-narrow-quote-oor` | 22 | -0.00% | -2.83% | 7 | 0.00% | $5.28 |  |
| 8 | `grid-bidask-narrow-quote-tp` | 22 | -0.00% | -2.83% | 7 | 0.00% | $5.28 |  |
| 9 | `grid-spot-narrow-two-oor` | 22 | -0.84% | -3.24% | 7 | 0.65% | $15.48 |  |
| 10 | `grid-spot-narrow-two-tp` | 22 | -0.84% | -3.24% | 7 | 0.65% | $15.48 |  |

Top train row vs holding: train $-91.69, time-split $-33.58, holdout $-0.57 (mean dollars versus buying and holding the entry tokens).

Full rows, including strategies with no trials, are in `reports/leaderboard.csv`.

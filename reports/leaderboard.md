# Strategy tournament leaderboard

Generated 2026-10-11T07:26:36.679Z. Paper only. Deposit size $250 per trial.

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

Accepted pools: 128. Skipped: 3.

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
| bluechip | holdout | PUMP-SOL | 10 | 84d 85 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-SOL | 5 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JitoSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | BTC-SOL | 200 | 35d 36 × 24h | meteora | volume-history |
| bluechip | holdout | mSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 16 | 59d 60 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | USDC-JitoSOL | 80 | 90d 91 × 24h | meteora | volume-history |
| fresh-memecoin | holdout | Altai-SOL | 250 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | train | Pepper-SOL | 100 | 0d 11 × 1h | meteora | volume-history |
| fresh-memecoin | train | ALOIS-SOL | 100 | 0d 11 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | Altai-USDC | 80 | 1d 17 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | Altai-SOL | 200 | 1d 17 × 1h | meteora | volume-history |
| high-vol-trending | holdout | STRK-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | SPCX-SOL | 10 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | SI-SOL | 100 | 16d 97 × 4h | meteora | volume-history |
| high-vol-trending | train | MUSK-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | CLAUDIA-SOL | 125 | 4d 26 × 4h | meteora | volume-history |
| high-vol-trending | train | QI-SOL | 100 | 2d 12 × 4h | meteora | volume-history |
| high-vol-trending | train | DARK-SOL | 75 | 4d 27 × 4h | meteora | volume-history |
| high-vol-trending | train | Agency-SOL | 50 | 8d 46 × 4h | meteora | volume-history |
| high-vol-trending | train | PQC-SOL | 100 | 3d 20 × 4h | meteora | volume-history |
| high-vol-trending | train | CRAWL-SOL | 100 | 7d 45 × 4h | meteora | volume-history |
| high-vol-trending | train | JPAD-SOL | 125 | 2d 11 × 4h | meteora | volume-history |
| high-vol-trending | train | HeeHaw-SOL | 100 | 41d 42 × 24h | meteora | volume-history |
| high-vol-trending | train | TM-SOL | 100 | 1d 26 × 1h | meteora | volume-history |
| high-vol-trending | train | HIGGS-SOL | 100 | 7d 41 × 4h | meteora | volume-history |
| high-vol-trending | holdout | SWOLF-SOL | 100 | 2d 12 × 4h | meteora | volume-history |
| high-vol-trending | train | INJ-USDC | 15 | 24d 25 × 24h | meteora | volume-history |
| high-vol-trending | holdout | RARI-SOL | 125 | 5d 28 × 4h | meteora | volume-history |
| high-vol-trending | holdout | RACE-USDC | 10 | 4d 27 × 4h | meteora | volume-history |
| high-vol-trending | holdout | STRK-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | SI-SOL | 30 | 12d 70 × 4h | meteora | volume-history |
| high-vol-trending | train | CLAUDIA-USDC | 80 | 1d 28 × 1h | meteora | volume-history |
| high-vol-trending | train | Agency-SOL | 100 | 9d 54 × 4h | meteora | volume-history |
| high-vol-trending | train | QI-SOL | 125 | 2d 10 × 4h | meteora | volume-history |
| high-vol-trending | train | DARK-USDC | 50 | 3d 20 × 4h | meteora | volume-history |
| high-vol-trending | holdout | RACE-SOL | 20 | 5d 28 × 4h | meteora | volume-history |
| high-vol-trending | train | CRAWL-SOL | 80 | 7d 43 × 4h | meteora | volume-history |
| high-vol-trending | train | PQC-USDC | 50 | 2d 13 × 4h | meteora | volume-history |
| high-vol-trending | train | JPAD-SOL | 200 | 2d 11 × 4h | meteora | volume-history |
| high-vol-trending | holdout | SPCX-USDC | 75 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | RARI-SOL | 80 | 4d 27 × 4h | meteora | volume-history |
| high-vol-trending | train | INJ-SOL | 50 | 13d 76 × 4h | meteora | volume-history |
| high-vol-trending | holdout | SWOLF-SOL | 125 | 1d 13 × 1h | meteora | volume-history |
| established-midcap | train | STONK-SOL | 20 | 60d 61 × 24h | meteora | volume-history |
| established-midcap | train | BP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | SOL-HYPE | 4 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CARDS-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANTFUN-USDT | 16 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | PENGU-USDC | 25 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANSEM-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | NVDAx-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZCAT-SOL | 80 | 35d 36 × 24h | meteora | volume-history |
| established-midcap | train | MASK-SOL | 200 | 15d 93 × 4h | meteora | volume-history |
| established-midcap | train | ZEC-SOL | 15 | 51d 52 × 24h | meteora | volume-history |
| established-midcap | train | USELESS-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | GOOGLx-SOL | 20 | 82d 83 × 24h | meteora | volume-history |
| established-midcap | train | CATE-SOL | 50 | 76d 77 × 24h | meteora | volume-history |
| established-midcap | holdout | FO-USDT | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | HYPE-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 4 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | STONK-USDC | 8 | 23d 24 × 24h | meteora | volume-history |
| established-midcap | train | BP-SOL | 20 | 34d 35 × 24h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CATE-USDC | 20 | 70d 71 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CARDS-SOL | 100 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZEC-SOL | 10 | 24d 25 × 24h | meteora | volume-history |
| established-midcap | train | ZCAT-USDC | 20 | 34d 35 × 24h | meteora | volume-history |
| established-midcap | train | PENGU-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | MASK-SOL | 20 | 14d 87 × 4h | meteora | volume-history |
| established-midcap | train | ANSEM-SOL | 10 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | wNEAR-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | HOOKED-SOL | 50 | 12d 75 × 4h | meteora | volume-history |
| older-memecoin | train | HOTBOT-SOL | 100 | 9d 55 × 4h | meteora | volume-history |
| older-memecoin | train | baton-SOL | 80 | 31d 32 × 24h | meteora | volume-history |
| older-memecoin | train | BORDR-SOL | 100 | 3d 20 × 4h | meteora | volume-history |
| older-memecoin | train | CTM-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | PAID-SOL | 30 | 23d 24 × 24h | meteora | volume-history |
| older-memecoin | train | SAPLING-SOL | 100 | 9d 56 × 4h | meteora | volume-history |
| older-memecoin | train | e/acc-SOL | 50 | 15d 92 × 4h | meteora | volume-history |
| older-memecoin | train | swordcat-SOL | 100 | 13d 78 × 4h | meteora | volume-history |
| older-memecoin | train | JEANPHIL-SOL | 100 | 21d 22 × 24h | meteora | volume-history |
| older-memecoin | holdout | tSpaceX-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | ENA-USDC | 100 | 89d 90 × 24h | meteora | volume-history |
| older-memecoin | holdout | XMR-USDC | 10 | 31d 32 × 24h | meteora | volume-history |
| older-memecoin | holdout | ANTHROPIC-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | ALLINU-SOL | 50 | 30d 31 × 24h | meteora | volume-history |
| older-memecoin | holdout | SKHY-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | PEPE-SOL | 20 | 23d 24 × 24h | meteora | volume-history |
| older-memecoin | train | HOOKED-SOL | 30 | 8d 51 × 4h | meteora | volume-history |
| older-memecoin | train | baton-SOL | 50 | 27d 28 × 24h | meteora | volume-history |
| older-memecoin | holdout | ANTHROPIC-USDC | 15 | 60d 61 × 24h | meteora | volume-history |
| older-memecoin | train | HOTBOT-USDC | 80 | 1d 28 × 1h | meteora | volume-history |
| older-memecoin | train | e/acc-SOL | 200 | 15d 92 × 4h | meteora | volume-history |
| older-memecoin | holdout | PEPE-SOL | 10 | 21d 22 × 24h | meteora | volume-history |
| older-memecoin | holdout | XMR-SOL | 20 | 33d 34 × 24h | meteora | volume-history |
| older-memecoin | train | JEANPHIL-SOL | 50 | 19d 20 × 24h | meteora | volume-history |
| older-memecoin | train | PAID-USDC | 80 | 24d 25 × 24h | meteora | volume-history |
| older-memecoin | train | ALLINU-SOL | 100 | 30d 31 × 24h | meteora | volume-history |
| older-memecoin | train | BORDR-USDC | 80 | 3d 20 × 4h | meteora | volume-history |
| older-memecoin | train | swordcat-USDC | 80 | 8d 50 × 4h | meteora | volume-history |
| older-memecoin | train | SAPLING-SOL | 125 | 9d 56 × 4h | meteora | volume-history |
| older-memecoin | holdout | SKHY-SOL | 100 | 89d 90 × 24h | meteora | volume-history |

## stable

No strategy has 8 or more train trials, so nothing is promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | `grid-spot-narrow-token-stay-array` | 5 | 3.12% | 1.40% | 1 | -2.39% | $-1.51 |  |
| — | `grid-curve-narrow-token-stay-array` | 5 | 3.09% | 1.54% | 1 | -2.47% | $-1.72 |  |
| — | `grid-curve-medium-two-patient-array` | 5 | 2.97% | 1.26% | 1 | -2.27% | $-3.44 |  |
| — | `grid-curve-medium-two-stay-array` | 5 | 2.97% | 1.26% | 1 | -2.24% | $-3.38 |  |
| — | `grid-spot-medium-two-patient-array` | 5 | 2.26% | 1.18% | 1 | -2.17% | $-3.20 |  |
| — | `grid-spot-medium-two-stay-array` | 5 | 2.26% | 1.18% | 1 | -2.14% | $-3.13 |  |
| — | `grid-curve-medium-token-stay-array` | 5 | 2.21% | 0.71% | 1 | -2.28% | $-1.24 |  |
| — | `grid-spot-medium-token-stay-array` | 5 | 1.81% | 0.54% | 1 | -2.13% | $-0.86 |  |
| — | `grid-curve-narrow-two-stay-array` | 5 | 1.81% | 1.50% | 1 | -2.51% | $-4.06 |  |
| — | `grid-curve-medium-token-patient-array` | 5 | 1.81% | 0.57% | 1 | -1.14% | $1.62 |  |

Top train row vs holding: train $11.11, time-split $18.37, holdout $-1.51 (mean dollars versus buying and holding the entry tokens).

## bluechip

grid-curve-narrow-token-rebalance passed the time split (median 12.12%, mean 208.66%) but the cost-adjusted holdout did not beat cash (n=7, median -18.32%, mean 179.57%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-quote-rebalance` | 15 | 14.00% | 10.03% | 7 | -18.52% | $453.58 |  |
| 2 | `grid-curve-narrow-two-rebalance` | 15 | 12.75% | 5.69% | 7 | -18.22% | $304.46 |  |
| 3 | `grid-curve-narrow-token-rebalance` | 15 | 11.52% | 12.12% | 7 | -18.32% | $252.75 |  |
| 4 | `grid-curve-narrow-two-stay-array` | 15 | 1.44% | 4.63% | 7 | 0.11% | $-69.85 |  |
| 5 | `grid-curve-narrow-token-stay-array` | 15 | 1.36% | 4.80% | 7 | 0.43% | $-179.75 |  |
| 6 | `grid-curve-narrow-quote-stay-array` | 15 | 1.27% | 2.53% | 7 | 0.03% | $23.61 |  |
| 7 | `grid-spot-narrow-token-patient-array` | 15 | 1.26% | 4.17% | 7 | 0.69% | $-187.10 |  |
| 8 | `grid-curve-medium-quote-stay-array` | 15 | 0.84% | 1.93% | 7 | 0.13% | $16.06 |  |
| 9 | `grid-bidask-narrow-two-timeout` | 15 | 0.76% | 0.25% | 7 | 0.67% | $-94.28 |  |
| 10 | `grid-spot-narrow-two-timeout` | 15 | 0.71% | 0.30% | 7 | 0.65% | $-93.82 |  |

Top train row vs holding: train $405.74, time-split $513.71, holdout $453.58 (mean dollars versus buying and holding the entry tokens).

## fresh-memecoin

No strategy has 8 or more train trials, so nothing is promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | `grid-curve-narrow-token-rebalance` | 2 | 408.66% | 189.58% | 3 | 61.86% | $162.81 |  |
| — | `grid-curve-narrow-quote-rebalance` | 2 | 402.85% | 165.29% | 3 | 218.17% | $593.14 |  |
| — | `grid-spot-narrow-two-rebalance` | 2 | 397.02% | 159.14% | 3 | 32.59% | $185.55 |  |
| — | `grid-curve-narrow-two-rebalance` | 2 | 393.54% | 152.51% | 3 | 39.46% | $221.02 |  |
| — | `grid-spot-narrow-token-rebalance` | 2 | 387.21% | 155.52% | 3 | 17.43% | $-3.81 |  |
| — | `grid-spot-narrow-quote-rebalance` | 2 | 384.76% | 161.73% | 3 | 21.86% | $245.65 |  |
| — | `grid-bidask-narrow-two-rebalance` | 2 | 342.37% | 140.35% | 3 | 25.64% | $149.80 |  |
| — | `grid-bidask-narrow-token-rebalance` | 2 | 235.35% | 58.96% | 3 | -31.94% | $-180.08 |  |
| — | `grid-spot-narrow-token-patient-array` | 2 | 231.05% | 30.26% | 3 | 173.19% | $1315.94 |  |
| — | `grid-spot-narrow-token-stay-array` | 2 | 231.05% | 30.26% | 3 | 173.19% | $1315.94 |  |

Top train row vs holding: train $1080.14, time-split $408.23, holdout $162.81 (mean dollars versus buying and holding the entry tokens).

## high-vol-trending

grid-curve-narrow-two-patient-array beat cash on the holdout but did not beat holding the token (median -$10.63, mean $780.07), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-two-patient-array` | 22 | 23.10% | 0.52% | 10 | 32.48% | $931.14 |  |
| 2 | `grid-curve-narrow-two-stay-array` | 22 | 23.10% | 0.52% | 10 | 32.47% | $937.15 |  |
| 3 | `grid-spot-narrow-two-patient-array` | 22 | 22.10% | -1.54% | 10 | 29.09% | $727.37 |  |
| 4 | `grid-spot-narrow-two-stay-array` | 22 | 22.10% | -1.54% | 10 | 29.07% | $733.77 |  |
| 5 | `grid-bidask-narrow-two-timeout` | 22 | 16.50% | -14.55% | 10 | 18.92% | $230.27 |  |
| 6 | `grid-spot-narrow-two-timeout` | 22 | 16.45% | -14.18% | 10 | 21.17% | $261.03 |  |
| 7 | `grid-curve-narrow-two-timeout` | 22 | 16.40% | -14.04% | 10 | 21.54% | $290.84 |  |
| 8 | `grid-curve-narrow-token-timeout` | 22 | 16.29% | -15.37% | 10 | -1.49% | $637.20 |  |
| 9 | `grid-spot-narrow-token-timeout` | 22 | 15.51% | -15.70% | 10 | -1.44% | $307.51 |  |
| 10 | `grid-spot-narrow-token-patient-array` | 22 | 15.10% | -2.00% | 10 | 24.88% | $1304.58 |  |

Top train row vs holding: train $53.56, time-split $361.38, holdout $931.14 (mean dollars versus buying and holding the entry tokens).

## established-midcap

grid-curve-narrow-two-patient-array passed the time split (median 14.48%, mean 29.76%) but the cost-adjusted holdout did not beat cash (n=7, median -2.61%, mean -2.79%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-quote-patient-array` | 24 | 2.65% | 11.71% | 7 | -2.60% | $-6.17 |  |
| 2 | `grid-spot-narrow-quote-patient-array` | 24 | 2.53% | 9.14% | 7 | -2.44% | $-6.23 |  |
| 3 | `grid-curve-narrow-quote-stay-array` | 24 | 1.96% | 10.15% | 7 | -2.98% | $-11.41 |  |
| 4 | `grid-curve-narrow-two-patient-array` | 24 | 1.52% | 14.48% | 7 | -2.61% | $-24.48 |  |
| 5 | `grid-spot-narrow-two-patient-array` | 24 | 1.48% | 13.65% | 7 | -2.58% | $-24.34 |  |
| 6 | `grid-curve-narrow-token-timeout` | 24 | 0.60% | 6.02% | 7 | -2.92% | $-43.65 |  |
| 7 | `grid-spot-narrow-two-stay-array` | 24 | 0.47% | 14.50% | 7 | -6.68% | $-36.81 |  |
| 8 | `grid-curve-narrow-two-stay-array` | 24 | 0.46% | 16.38% | 7 | -6.71% | $-36.95 |  |
| 9 | `grid-spot-narrow-token-timeout` | 24 | 0.41% | 4.63% | 7 | -2.93% | $-44.03 |  |
| 10 | `grid-bidask-narrow-two-timeout` | 24 | 0.35% | 4.67% | 7 | -3.58% | $-27.90 |  |

Top train row vs holding: train $112.93, time-split $62.35, holdout $-6.17 (mean dollars versus buying and holding the entry tokens).

## older-memecoin

grid-spot-narrow-quote-patient-array led the time-split test among the top 5 yield strategies, but the test median (-11.07%) and mean (-12.93%) are not both positive, so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-token-patient-array` | 23 | 12.37% | -19.55% | 9 | -4.18% | $71.21 |  |
| 2 | `grid-curve-narrow-token-timeout` | 23 | 8.35% | -13.74% | 9 | 1.34% | $24.84 |  |
| 3 | `grid-spot-narrow-quote-patient-array` | 23 | 2.91% | -11.07% | 9 | 0.02% | $116.18 |  |
| 4 | `grid-spot-narrow-token-patient-array` | 23 | 2.53% | -20.27% | 9 | -4.67% | $68.94 |  |
| 5 | `grid-spot-narrow-token-timeout` | 23 | 2.34% | -13.89% | 9 | 1.57% | $17.93 |  |
| 6 | `grid-curve-narrow-quote-patient-array` | 23 | 2.29% | -8.03% | 9 | 0.03% | $103.44 |  |
| 7 | `grid-curve-narrow-token-stay-array` | 23 | 1.65% | -19.55% | 9 | 2.46% | $66.22 |  |
| 8 | `grid-bidask-narrow-quote-timeout` | 23 | 1.30% | -14.88% | 9 | -0.66% | $84.84 |  |
| 9 | `grid-spot-narrow-quote-timeout` | 23 | 1.06% | -13.37% | 9 | -0.00% | $73.98 |  |
| 10 | `grid-curve-narrow-quote-timeout` | 23 | 0.81% | -12.11% | 9 | -0.00% | $63.11 |  |

Top train row vs holding: train $-25.13, time-split $-141.44, holdout $71.21 (mean dollars versus buying and holding the entry tokens).

Full rows, including strategies with no trials, are in `reports/leaderboard.csv`.

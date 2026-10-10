# Strategy tournament leaderboard

Generated 2026-10-10T07:35:39.398Z. Paper only. Deposit size $250 per trial.

## How a winner is chosen

Strategies are ranked on train coins only, using the first 70% of each pool's candles, by median net return (equity minus deposit, divided by deposit). Net return includes simulated LP fees and the inventory mark, so impermanent loss is inside it. A strategy needs at least 8 train trials. The top 5 are re-ranked on the last 30% of those same coins' candles. The single best of that list is written to `strategies/winners/` only when that time split has at least 5 trials with a positive median and mean, and the cross-coin holdout has at least 4 trials with a positive median and mean. Holdout coins are absent from ranking and from the time split.

## Caveats

- Fee share is `candle LP fees × position mark / pool TVL`, capped at 100% of the candle's LP fees. It is not per-bin concentration. A tight range does not earn a higher fee rate while it is in range; it just falls out of range sooner. TVL is frozen at the scan snapshot, and our deposit is not added into it, so small pools overstate the share.
- When Meteora volume history has an LP fee on the same timestamp, that figure is used (it is already the LP slice). Otherwise volume × `(baseFeePct + dynamicFeePct) / 100` × the pool's observed 24h LP share. `dynamicFeePct` is the current snapshot, not the historical variable fee.
- The intra-candle path is open, nearer extreme, other extreme, close. A wick can stop out or exit a range that the close would have survived.
- Quote-token USD is frozen. Token X is marked at `price × frozen quote USD`. There is no gas, no rebalance rent, and no extra composition fee.
- After an exit the trial sits in cash. It does not re-enter. Hodl is the initial token amounts marked at the window's last close, so an early exit is compared with holding through the rest of the window.
- Each bucket aims for 18 coins. A second or third pool is included when the same coin has another bin step, so some trials share a coin. Holdout is by coin: every pool of a held-out coin is replayed on its full history and is excluded from training. The split is the lexicographic tail of the coin keys, about 30%.
- Older pools use daily bars over up to 90 days. Pools younger than 20 days use 4-hour bars over 16 days, and pools younger than 36 hours use 1-hour bars over 48 hours. A daily candle's wick path exits ranges that a finer bar might have survived.
- `sharpeLike` is mean trial return divided by the sample standard deviation of those trial returns. It is not annualized and it is not a bar-by-bar Sharpe.
- Bin step is the pool's step. The grid does not vary it, and winners are not split into bin-step bands.

## Samples

Accepted pools: 137. Skipped: 13.

| Bucket | Role | Pool | Bin step | History | Source | Fees |
| --- | --- | --- | --- | --- | --- | --- |
| stable | train | USDe-USDG | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | train | USDC-USDT | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | train | PYUSD-USDC | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | holdout | EURC-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| stable | train | USDC-USDT | 8 | 90d 91 × 24h | meteora | volume-history |
| stable | train | USDC-USDT | 16 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-SOL | 2 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-SOL | 10 | 83d 84 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-SOL | 5 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JitoSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | BTC-SOL | 200 | 34d 35 × 24h | meteora | volume-history |
| bluechip | holdout | mSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 16 | 58d 59 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | USDC-JitoSOL | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-ETH | 50 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-hSOL | 10 | 90d 91 × 24h | meteora | volume-history |
| fresh-memecoin | train | QI-SOL | 100 | 1d 22 × 1h | meteora | volume-history |
| fresh-memecoin | train | JPAD-SOL | 125 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | SWOLF-SOL | 100 | 1d 21 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | MEMECHAN-SOL | 125 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | train | PAWS-SOL | 125 | 1d 16 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | QUBIT-SOL | 100 | 0d 12 × 1h | meteora | volume-history |
| fresh-memecoin | train | KAIA-USDC | 2 | 0d 9 × 1h | meteora | volume-history |
| fresh-memecoin | train | MON-USDC | 2 | 0d 9 × 1h | meteora | volume-history |
| fresh-memecoin | train | ZIL-USDC | 2 | 0d 9 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | BERA-USDC | 2 | 0d 9 × 1h | meteora | volume-history |
| fresh-memecoin | train | ROSE-USDC | 2 | 0d 9 × 1h | meteora | volume-history |
| fresh-memecoin | train | CFX-USDC | 2 | 0d 9 × 1h | meteora | volume-history |
| fresh-memecoin | train | JCT-USDC | 2 | 0d 9 × 1h | meteora | volume-history |
| fresh-memecoin | train | PEAQ-USDC | 2 | 0d 9 × 1h | meteora | volume-history |
| fresh-memecoin | train | QI-USDC | 80 | 1d 13 × 1h | meteora | volume-history |
| high-vol-trending | holdout | STRK-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | SPCX-SOL | 10 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | PQC-SOL | 100 | 2d 14 × 4h | meteora | volume-history |
| high-vol-trending | train | MUSK-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | HeeHaw-SOL | 100 | 40d 41 × 24h | meteora | volume-history |
| high-vol-trending | train | BORDR-SOL | 100 | 2d 14 × 4h | meteora | volume-history |
| high-vol-trending | train | CLAUDIA-SOL | 125 | 3d 20 × 4h | meteora | volume-history |
| high-vol-trending | train | HOTBOT-SOL | 100 | 8d 49 × 4h | meteora | volume-history |
| high-vol-trending | train | CRAWL-SOL | 100 | 6d 39 × 4h | meteora | volume-history |
| high-vol-trending | holdout | TWEETCRAFT-SOL | 100 | 3d 20 × 4h | meteora | volume-history |
| high-vol-trending | holdout | RACE-USDC | 10 | 3d 21 × 4h | meteora | volume-history |
| high-vol-trending | train | HIGGS-SOL | 100 | 6d 35 × 4h | meteora | volume-history |
| high-vol-trending | train | CALI-SOL | 100 | 16d 97 × 4h | meteora | volume-history |
| high-vol-trending | train | INJ-USDC | 15 | 23d 24 × 24h | meteora | volume-history |
| high-vol-trending | holdout | PLAY-USDC | 50 | 1d 34 × 1h | meteora | volume-history |
| high-vol-trending | train | NINJACAT-SOL | 200 | 23d 24 × 24h | meteora | volume-history |
| high-vol-trending | train | ALLINU-SOL | 50 | 29d 30 × 24h | meteora | volume-history |
| high-vol-trending | train | pill-SOL | 200 | 27d 28 × 24h | meteora | volume-history |
| high-vol-trending | holdout | STRK-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | SPCX-USDC | 75 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | RACE-SOL | 20 | 4d 22 × 4h | meteora | volume-history |
| high-vol-trending | train | BORDR-USDC | 80 | 2d 14 × 4h | meteora | volume-history |
| high-vol-trending | train | CRAWL-SOL | 80 | 6d 37 × 4h | meteora | volume-history |
| high-vol-trending | train | PQC-USDC | 50 | 1d 28 × 1h | meteora | volume-history |
| high-vol-trending | train | ALLINU-SOL | 100 | 29d 30 × 24h | meteora | volume-history |
| high-vol-trending | train | INJ-SOL | 50 | 12d 70 × 4h | meteora | volume-history |
| high-vol-trending | train | pill-baton | 400 | 4d 24 × 4h | meteora | volume-history |
| high-vol-trending | holdout | PLAY-SOL | 200 | 1d 27 × 1h | meteora | volume-history |
| high-vol-trending | train | NINJACAT-SOL | 160 | 21d 22 × 24h | meteora | volume-history |
| established-midcap | train | BP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | STONK-SOL | 20 | 59d 60 × 24h | meteora | volume-history |
| established-midcap | train | SOL-HYPE | 4 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANTFUN-USDT | 16 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | SI-SOL | 30 | 11d 64 × 4h | meteora | volume-history |
| established-midcap | train | CARDS-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANSEM-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | PENGU-USDC | 25 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | GOOGLx-SOL | 20 | 81d 82 × 24h | meteora | volume-history |
| established-midcap | holdout | MASK-SOL | 200 | 14d 87 × 4h | meteora | volume-history |
| established-midcap | train | ZEC-SOL | 15 | 50d 51 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | NVDAx-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZCAT-SOL | 80 | 34d 35 × 24h | meteora | volume-history |
| established-midcap | train | Bonk-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | USELESS-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | HYPE-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 4 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | SI-SOL | 100 | 16d 97 × 4h | meteora | volume-history |
| established-midcap | train | STONK-USDC | 8 | 22d 23 × 24h | meteora | volume-history |
| established-midcap | train | BP-SOL | 20 | 33d 34 × 24h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZEC-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CARDS-SOL | 100 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZCAT-USDC | 20 | 33d 34 × 24h | meteora | volume-history |
| established-midcap | holdout | MASK-SOL | 20 | 13d 81 × 4h | meteora | volume-history |
| established-midcap | train | PENGU-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | Bonk-SOL | 100 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | wNEAR-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | HOOKED-SOL | 50 | 11d 69 × 4h | meteora | volume-history |
| older-memecoin | train | DARK-SOL | 75 | 3d 21 × 4h | meteora | volume-history |
| older-memecoin | train | MU-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | ANTHROPIC-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | JEANPHIL-SOL | 100 | 20d 21 × 24h | meteora | volume-history |
| older-memecoin | train | Agency-SOL | 50 | 7d 40 × 4h | meteora | volume-history |
| older-memecoin | train | baton-SOL | 80 | 30d 31 × 24h | meteora | volume-history |
| older-memecoin | holdout | SKHY-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | PAID-SOL | 30 | 22d 23 × 24h | meteora | volume-history |
| older-memecoin | holdout | PEPE-SOL | 20 | 22d 23 × 24h | meteora | volume-history |
| older-memecoin | train | ENA-USDC | 100 | 88d 89 × 24h | meteora | volume-history |
| older-memecoin | train | swordcat-SOL | 100 | 12d 72 × 4h | meteora | volume-history |
| older-memecoin | holdout | XMR-USDC | 10 | 30d 31 × 24h | meteora | volume-history |
| older-memecoin | train | EMBER-SOL | 50 | 28d 29 × 24h | meteora | volume-history |
| older-memecoin | train | e/acc-SOL | 50 | 14d 86 × 4h | meteora | volume-history |
| older-memecoin | holdout | tSpaceX-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | Jimothy-SOL | 50 | 85d 86 × 24h | meteora | volume-history |
| older-memecoin | train | baton-SOL | 50 | 26d 27 × 24h | meteora | volume-history |
| older-memecoin | holdout | ANTHROPIC-USDC | 15 | 59d 60 × 24h | meteora | volume-history |
| older-memecoin | train | HOOKED-SOL | 30 | 7d 45 × 4h | meteora | volume-history |
| older-memecoin | train | Agency-SOL | 100 | 8d 48 × 4h | meteora | volume-history |
| older-memecoin | train | DARK-SOL | 50 | 8d 48 × 4h | meteora | volume-history |
| older-memecoin | train | e/acc-SOL | 200 | 14d 86 × 4h | meteora | volume-history |
| older-memecoin | holdout | PEPE-SOL | 10 | 16d 97 × 4h | meteora | volume-history |
| older-memecoin | holdout | XMR-SOL | 20 | 32d 33 × 24h | meteora | volume-history |
| older-memecoin | train | PAID-SOL | 80 | 25d 26 × 24h | meteora | volume-history |
| older-memecoin | train | JEANPHIL-SOL | 50 | 2d 13 × 4h | meteora | volume-history |
| older-memecoin | train | MU-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | EMBER-USDC | 200 | 31d 32 × 24h | meteora | volume-history |
| older-memecoin | train | swordcat-USDC | 80 | 7d 44 × 4h | meteora | volume-history |

## stable

No strategy has 8 or more train trials, so nothing is promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | `grid-bidask-wide-two-oor` | 5 | 0.12% | 0.07% | 1 | 1.18% | $5.31 |  |
| — | `grid-bidask-wide-two-rebalance` | 5 | 0.12% | 0.07% | 1 | -3.63% | $-6.71 |  |
| — | `grid-bidask-wide-two-timeout` | 5 | 0.12% | 0.07% | 1 | -0.65% | $0.73 |  |
| — | `grid-bidask-wide-two-tp` | 5 | 0.12% | 0.07% | 1 | 1.18% | $5.31 |  |
| — | `grid-spot-wide-two-oor` | 5 | 0.12% | 0.06% | 1 | 0.94% | $4.69 |  |
| — | `grid-spot-wide-two-rebalance` | 5 | 0.12% | 0.06% | 1 | -4.81% | $-9.68 |  |
| — | `grid-spot-wide-two-timeout` | 5 | 0.12% | 0.07% | 1 | -0.82% | $0.30 |  |
| — | `grid-spot-wide-two-tp` | 5 | 0.12% | 0.06% | 1 | 0.94% | $4.69 |  |
| — | `grid-curve-wide-two-oor` | 5 | 0.12% | 0.06% | 1 | 0.69% | $4.08 |  |
| — | `grid-curve-wide-two-rebalance` | 5 | 0.12% | 0.06% | 1 | -5.99% | $-12.62 |  |

Top train row vs holding: train $0.38, time-split $0.08, holdout $5.31 (mean dollars versus buying and holding the entry tokens).

## bluechip

grid-bidask-medium-two-oor led the time-split test among the top 5 train strategies, but the test median (-0.13%) and mean (-0.78%) are not both positive, so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-wide-two-tp` | 18 | 0.14% | -0.18% | 7 | 1.04% | $-105.85 |  |
| 2 | `grid-spot-wide-two-tp` | 18 | 0.11% | -0.23% | 7 | 0.79% | $-106.48 |  |
| 3 | `grid-bidask-medium-two-timeout` | 18 | 0.06% | -1.01% | 7 | 0.43% | $-107.11 |  |
| 4 | `grid-bidask-medium-two-oor` | 18 | 0.06% | -0.13% | 7 | 0.43% | $-106.39 |  |
| 5 | `grid-bidask-medium-two-tp` | 18 | 0.06% | -0.13% | 7 | 0.43% | $-106.39 |  |
| 6 | `grid-spot-medium-two-timeout` | 18 | 0.05% | -1.11% | 7 | 0.34% | $-107.35 |  |
| 7 | `grid-spot-medium-two-oor` | 18 | 0.05% | -0.15% | 7 | 0.34% | $-106.63 |  |
| 8 | `grid-spot-medium-two-tp` | 18 | 0.05% | -0.15% | 7 | 0.34% | $-106.63 |  |
| 9 | `grid-curve-medium-two-timeout` | 18 | 0.04% | -1.21% | 7 | 0.24% | $-107.59 |  |
| 10 | `grid-curve-medium-two-oor` | 18 | 0.04% | -0.18% | 7 | 0.24% | $-106.87 |  |

Top train row vs holding: train $-9.43, time-split $-7.98, holdout $-105.85 (mean dollars versus buying and holding the entry tokens).

## fresh-memecoin

grid-bidask-narrow-two-oor led the time-split test among the top 5 train strategies, but the test median (0.00%) and mean (-5.07%) are not both positive, so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-narrow-two-tp` | 11 | 0.01% | 0.00% | 4 | 0.82% | $-20.14 |  |
| 2 | `grid-spot-narrow-two-tp` | 11 | 0.01% | 0.00% | 4 | 0.77% | $-20.36 |  |
| 3 | `grid-curve-narrow-two-tp` | 11 | 0.01% | 0.00% | 4 | 0.73% | $-20.57 |  |
| 4 | `grid-bidask-narrow-two-oor` | 11 | 0.01% | 0.00% | 4 | 0.82% | $-20.14 |  |
| 5 | `grid-spot-narrow-two-oor` | 11 | 0.01% | 0.00% | 4 | 0.77% | $-20.36 |  |
| 6 | `grid-curve-narrow-two-oor` | 11 | 0.01% | 0.00% | 4 | 0.73% | $-20.57 |  |
| 7 | `grid-spot-medium-quote-timeout` | 11 | 0.01% | 0.00% | 4 | -12.31% | $56.05 |  |
| 8 | `grid-spot-wide-token-timeout` | 11 | 0.01% | 0.00% | 4 | -27.03% | $-92.25 |  |
| 9 | `grid-spot-wide-two-timeout` | 11 | 0.01% | 0.00% | 4 | -12.85% | $68.31 |  |
| 10 | `grid-spot-wide-two-oor` | 11 | 0.01% | 0.00% | 4 | -12.85% | $8.91 |  |

Top train row vs holding: train $-13.04, time-split $-9.30, holdout $-20.14 (mean dollars versus buying and holding the entry tokens).

## high-vol-trending

grid-bidask-narrow-two-oor passed the time split (median 1.19%, mean 4.86%) but the cross-coin holdout did not clear n≥4 with a positive median (-2.18%) and mean (-7.19%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-narrow-two-oor` | 20 | 0.47% | 1.19% | 9 | -2.18% | $-29.93 |  |
| 2 | `grid-bidask-narrow-two-tp` | 20 | 0.47% | 1.19% | 9 | -2.18% | $-32.64 |  |
| 3 | `grid-spot-narrow-two-oor` | 20 | 0.45% | 1.11% | 9 | -2.34% | $-30.17 |  |
| 4 | `grid-spot-narrow-two-tp` | 20 | 0.45% | 1.11% | 9 | -2.34% | $-32.86 |  |
| 5 | `grid-curve-narrow-two-oor` | 20 | 0.42% | 1.02% | 9 | -2.51% | $-30.41 |  |
| 6 | `grid-curve-narrow-two-tp` | 20 | 0.42% | 1.02% | 9 | -2.51% | $-33.08 |  |
| 7 | `grid-bidask-wide-quote-oor` | 20 | 0.17% | 0.43% | 9 | 0.00% | $-5.83 |  |
| 8 | `grid-bidask-wide-quote-tp` | 20 | 0.17% | 0.33% | 9 | 0.00% | $-8.35 |  |
| 9 | `grid-spot-wide-quote-oor` | 20 | 0.11% | 0.33% | 9 | 0.00% | $-7.55 |  |
| 10 | `grid-spot-wide-quote-tp` | 20 | 0.11% | 0.33% | 9 | 0.00% | $-8.47 |  |

Top train row vs holding: train $-242.93, time-split $-120.09, holdout $-29.93 (mean dollars versus buying and holding the entry tokens).

## established-midcap

grid-bidask-wide-two-timeout led the time-split test among the top 5 train strategies, but the test median (0.92%) and mean (-1.64%) are not both positive, so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-wide-two-timeout` | 23 | 1.57% | 0.92% | 8 | -4.62% | $-45.73 |  |
| 2 | `grid-spot-wide-two-timeout` | 23 | 1.20% | 0.73% | 8 | -5.10% | $-47.46 |  |
| 3 | `grid-curve-wide-two-timeout` | 23 | 0.83% | 0.53% | 8 | -5.59% | $-49.19 |  |
| 4 | `grid-spot-wide-quote-timeout` | 23 | 0.03% | 0.11% | 8 | 0.01% | $-3.18 |  |
| 5 | `grid-bidask-wide-quote-timeout` | 23 | 0.03% | 0.13% | 8 | 0.01% | $-5.49 |  |
| 6 | `grid-curve-wide-quote-timeout` | 23 | 0.02% | 0.11% | 8 | -0.84% | $-10.62 |  |
| 7 | `grid-bidask-medium-quote-timeout` | 23 | 0.01% | 0.01% | 8 | -2.05% | $-8.46 |  |
| 8 | `grid-spot-medium-quote-timeout` | 23 | 0.01% | 0.01% | 8 | -2.44% | $-9.14 |  |
| 9 | `grid-curve-medium-quote-timeout` | 23 | 0.01% | 0.01% | 8 | -2.83% | $-8.94 |  |
| 10 | `grid-bidask-wide-quote-tp` | 23 | 0.00% | 0.05% | 8 | 0.01% | $0.84 |  |

Top train row vs holding: train $-130.47, time-split $-8.09, holdout $-45.73 (mean dollars versus buying and holding the entry tokens).

## older-memecoin

grid-bidask-wide-quote-oor is promoted: train rank 4, time-split n=23 median 0.17%, holdout n=8 median 0.26%.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-wide-quote-timeout` | 23 | 0.34% | 0.09% | 8 | 0.32% | $-10.50 |  |
| 2 | `grid-spot-wide-quote-timeout` | 23 | 0.09% | 0.09% | 8 | 0.32% | $-10.87 |  |
| 3 | `grid-curve-wide-quote-timeout` | 23 | 0.02% | 0.09% | 8 | 0.26% | $-11.23 |  |
| 4 | `grid-bidask-wide-quote-oor` | 23 | 0.01% | 0.17% | 8 | 0.26% | $1.27 | yes |
| 5 | `grid-bidask-wide-quote-tp` | 23 | 0.01% | 0.17% | 8 | 0.26% | $1.27 |  |
| 6 | `grid-spot-wide-quote-oor` | 23 | 0.01% | 0.17% | 8 | 0.26% | $1.06 |  |
| 7 | `grid-spot-wide-quote-tp` | 23 | 0.01% | 0.17% | 8 | 0.26% | $1.06 |  |
| 8 | `grid-curve-wide-quote-oor` | 23 | 0.01% | 0.17% | 8 | 0.26% | $0.84 |  |
| 9 | `grid-bidask-medium-quote-timeout` | 23 | 0.00% | 0.09% | 8 | 0.00% | $-23.54 |  |
| 10 | `grid-spot-medium-quote-timeout` | 23 | 0.00% | -12.55% | 8 | 0.00% | $-23.83 |  |

Top train row vs holding: train $-8.91, time-split $-16.05, holdout $-10.50 (mean dollars versus buying and holding the entry tokens).

Full rows, including strategies with no trials, are in `reports/leaderboard.csv`.

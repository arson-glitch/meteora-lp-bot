# Strategy tournament leaderboard

Generated 2026-10-09T18:43:25.091Z. Paper only. Deposit size $250 per trial.

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

Accepted pools: 145. Skipped: 7.

| Bucket | Role | Pool | Bin step | History | Source | Fees |
| --- | --- | --- | --- | --- | --- | --- |
| stable | train | USDe-USDG | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | train | USDC-USDT | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | train | PYUSD-USDC | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | holdout | EURC-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| stable | train | USDC-USDT | 8 | 90d 91 × 24h | meteora | volume-history |
| stable | train | USDC-USDT | 16 | 90d 91 × 24h | meteora | volume-history |
| stable | holdout | EURC-USDC | 1 | 89d 90 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-SOL | 2 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-SOL | 10 | 82d 83 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-SOL | 5 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JitoSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | BTC-SOL | 200 | 33d 34 × 24h | meteora | volume-history |
| bluechip | holdout | mSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 16 | 57d 58 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-USDC | 100 | 89d 90 × 24h | meteora | volume-history |
| bluechip | train | USDC-JitoSOL | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-hSOL | 10 | 89d 90 × 24h | meteora | volume-history |
| bluechip | train | SOL-ETH | 50 | 90d 91 × 24h | meteora | volume-history |
| fresh-memecoin | train | TikTok-SOL | 100 | 1d 24 × 1h | meteora | volume-history |
| fresh-memecoin | train | QI-SOL | 100 | 1d 13 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | vamp-SOL | 100 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | PLAY-USDC | 50 | 1d 21 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | Animal-SOL | 100 | 1d 21 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | SWOLF-SOL | 100 | 0d 8 × 1h | meteora | volume-history |
| fresh-memecoin | train | OP_CAT-USDC | 400 | 1d 19 × 1h | meteora | volume-history |
| fresh-memecoin | train | DRV-USDC | 2 | 1d 13 × 1h | meteora | volume-history |
| fresh-memecoin | train | STRK-USDC | 2 | 1d 13 × 1h | meteora | volume-history |
| fresh-memecoin | train | BEAM-USDC | 2 | 1d 13 × 1h | meteora | volume-history |
| fresh-memecoin | train | STX-USDC | 2 | 1d 13 × 1h | meteora | volume-history |
| fresh-memecoin | train | TIA-USDC | 2 | 1d 13 × 1h | meteora | volume-history |
| fresh-memecoin | train | CARDS-USDC | 2 | 1d 13 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | PRL-USDC | 2 | 1d 13 × 1h | meteora | volume-history |
| fresh-memecoin | train | QTC-USDC | 2 | 1d 13 × 1h | meteora | volume-history |
| fresh-memecoin | train | 0,1-ANSEM | 80 | 1d 16 × 1h | meteora | volume-history |
| fresh-memecoin | train | GFUD-USDT | 10 | 0d 12 × 1h | meteora | volume-history |
| fresh-memecoin | train | TikTok-SOL | 20 | 1d 23 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | PLAY-SOL | 200 | 1d 14 × 1h | meteora | volume-history |
| high-vol-trending | holdout | STRK-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | HOOKED-SOL | 50 | 11d 66 × 4h | meteora | volume-history |
| high-vol-trending | train | PQC-SOL | 100 | 2d 11 × 4h | meteora | volume-history |
| high-vol-trending | train | HeeHaw-SOL | 100 | 39d 40 × 24h | meteora | volume-history |
| high-vol-trending | train | MUSK-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | baton-SOL | 80 | 29d 30 × 24h | meteora | volume-history |
| high-vol-trending | train | Agency-SOL | 50 | 6d 37 × 4h | meteora | volume-history |
| high-vol-trending | train | JEANPHIL-SOL | 100 | 16d 97 × 4h | meteora | volume-history |
| high-vol-trending | train | BORDR-SOL | 100 | 2d 11 × 4h | meteora | volume-history |
| high-vol-trending | holdout | SKHY-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | RACE-USDC | 10 | 3d 18 × 4h | meteora | volume-history |
| high-vol-trending | holdout | MASK-SOL | 200 | 14d 84 × 4h | meteora | volume-history |
| high-vol-trending | train | INJ-USDC | 15 | 22d 23 × 24h | meteora | volume-history |
| high-vol-trending | train | HIGGS-SOL | 100 | 5d 32 × 4h | meteora | volume-history |
| high-vol-trending | train | CLAUDIA-SOL | 125 | 3d 17 × 4h | meteora | volume-history |
| high-vol-trending | train | RARI-SOL | 80 | 3d 18 × 4h | meteora | volume-history |
| high-vol-trending | train | fone-SOL | 20 | 43d 44 × 24h | meteora | volume-history |
| high-vol-trending | holdout | OTC-SOL | 100 | 2d 14 × 4h | meteora | volume-history |
| high-vol-trending | holdout | STRK-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | baton-SOL | 50 | 25d 26 × 24h | meteora | volume-history |
| high-vol-trending | train | HOOKED-SOL | 30 | 7d 42 × 4h | meteora | volume-history |
| high-vol-trending | train | Agency-SOL | 100 | 7d 45 × 4h | meteora | volume-history |
| high-vol-trending | train | RARI-SOL | 125 | 3d 19 × 4h | meteora | volume-history |
| high-vol-trending | train | HeeHaw-USDC | 80 | 39d 40 × 24h | meteora | volume-history |
| high-vol-trending | train | BORDR-USDC | 80 | 2d 11 × 4h | meteora | volume-history |
| high-vol-trending | holdout | RACE-USDC | 8 | 3d 18 × 4h | meteora | volume-history |
| high-vol-trending | train | fone-SOL | 100 | 43d 44 × 24h | meteora | volume-history |
| high-vol-trending | train | JEANPHIL-USDC | 50 | 16d 97 × 4h | meteora | volume-history |
| high-vol-trending | train | INJ-SOL | 50 | 11d 67 × 4h | meteora | volume-history |
| high-vol-trending | holdout | OTC-USDC | 125 | 33d 34 × 24h | meteora | volume-history |
| high-vol-trending | holdout | MASK-SOL | 20 | 13d 78 × 4h | meteora | volume-history |
| high-vol-trending | train | PQC-SOL | 125 | 1d 27 × 1h | meteora | volume-history |
| established-midcap | train | STONK-SOL | 20 | 58d 59 × 24h | meteora | volume-history |
| established-midcap | train | BP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | SOL-HYPE | 4 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | SI-SOL | 100 | 16d 97 × 4h | meteora | volume-history |
| established-midcap | train | CARDS-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANTFUN-USDT | 16 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANSEM-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZCAT-SOL | 80 | 33d 34 × 24h | meteora | volume-history |
| established-midcap | train | ZEC-SOL | 15 | 49d 50 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | NVDAx-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | GOOGLx-SOL | 20 | 80d 81 × 24h | meteora | volume-history |
| established-midcap | train | PENGU-USDC | 25 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CATE-SOL | 50 | 74d 75 × 24h | meteora | volume-history |
| established-midcap | train | Bonk-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | FO-USDT | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | SI-SOL | 30 | 10d 61 × 4h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 4 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | HYPE-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | STONK-USDC | 8 | 21d 22 × 24h | meteora | volume-history |
| established-midcap | train | BP-SOL | 20 | 32d 33 × 24h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CATE-USDC | 20 | 68d 69 × 24h | meteora | volume-history |
| established-midcap | train | ZEC-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CARDS-SOL | 100 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZCAT-USDC | 20 | 32d 33 × 24h | meteora | volume-history |
| established-midcap | train | Bonk-SOL | 100 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | PENGU-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANSEM-SOL | 10 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | wNEAR-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | SPCX-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | DARK-SOL | 75 | 3d 18 × 4h | meteora | volume-history |
| older-memecoin | holdout | ANTHROPIC-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | MU-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | XMR-USDC | 10 | 29d 30 × 24h | meteora | volume-history |
| older-memecoin | train | TWEETCRAFT-SOL | 100 | 3d 17 × 4h | meteora | volume-history |
| older-memecoin | train | swordcat-SOL | 100 | 11d 69 × 4h | meteora | volume-history |
| older-memecoin | train | ENA-USDC | 100 | 87d 88 × 24h | meteora | volume-history |
| older-memecoin | train | NINJACAT-SOL | 200 | 22d 23 × 24h | meteora | volume-history |
| older-memecoin | train | e/acc-SOL | 50 | 14d 83 × 4h | meteora | volume-history |
| older-memecoin | train | CRAWL-SOL | 100 | 6d 36 × 4h | meteora | volume-history |
| older-memecoin | train | EMBER-SOL | 50 | 27d 28 × 24h | meteora | volume-history |
| older-memecoin | holdout | tSpaceX-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | PEPE-SOL | 20 | 21d 22 × 24h | meteora | volume-history |
| older-memecoin | train | PAID-SOL | 30 | 21d 22 × 24h | meteora | volume-history |
| older-memecoin | train | HOTBOT-SOL | 100 | 8d 46 × 4h | meteora | volume-history |
| older-memecoin | train | CALI-SOL | 100 | 16d 97 × 4h | meteora | volume-history |
| older-memecoin | holdout | ANTHROPIC-USDC | 15 | 58d 59 × 24h | meteora | volume-history |
| older-memecoin | train | DARK-SOL | 50 | 7d 45 × 4h | meteora | volume-history |
| older-memecoin | train | e/acc-SOL | 200 | 14d 83 × 4h | meteora | volume-history |
| older-memecoin | holdout | XMR-SOL | 20 | 31d 32 × 24h | meteora | volume-history |
| older-memecoin | holdout | SPCX-USDC | 75 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | MU-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | holdout | PEPE-SOL | 10 | 16d 97 × 4h | meteora | volume-history |
| older-memecoin | train | CRAWL-SOL | 80 | 6d 34 × 4h | meteora | volume-history |
| older-memecoin | train | NINJACAT-SOL | 160 | 16d 97 × 4h | meteora | volume-history |
| older-memecoin | train | swordcat-USDC | 80 | 7d 41 × 4h | meteora | volume-history |
| older-memecoin | train | PAID-SOL | 100 | 24d 25 × 24h | meteora | volume-history |
| older-memecoin | train | EMBER-SOL | 100 | 28d 29 × 24h | meteora | volume-history |

## stable

No strategy has 8 or more train trials, so nothing is promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | `grid-bidask-wide-two-timeout` | 5 | 0.13% | 0.07% | 2 | -0.31% | $0.86 |  |
| — | `grid-bidask-medium-two-timeout` | 5 | 0.13% | 0.07% | 2 | 0.30% | $2.38 |  |
| — | `grid-spot-wide-two-timeout` | 5 | 0.13% | 0.07% | 2 | -0.41% | $0.61 |  |
| — | `grid-curve-wide-two-timeout` | 5 | 0.13% | 0.07% | 2 | -0.51% | $0.35 |  |
| — | `grid-spot-medium-two-timeout` | 5 | 0.13% | 0.07% | 2 | 0.25% | $2.25 |  |
| — | `grid-curve-medium-two-timeout` | 5 | 0.13% | 0.07% | 2 | 0.20% | $2.13 |  |
| — | `grid-bidask-wide-quote-rebalance` | 5 | 0.11% | 0.06% | 2 | -3.12% | $-7.79 |  |
| — | `grid-bidask-wide-two-rebalance` | 5 | 0.10% | 0.07% | 2 | -4.13% | $-8.69 |  |
| — | `grid-bidask-wide-two-oor` | 5 | 0.10% | 0.07% | 2 | 0.64% | $3.24 |  |
| — | `grid-bidask-wide-two-tp` | 5 | 0.10% | 0.07% | 2 | 0.64% | $3.24 |  |

Top train row vs holding: train $0.42, time-split $0.29, holdout $0.86 (mean dollars versus buying and holding the entry tokens).

## bluechip

grid-bidask-wide-two-tp passed the time split (median 0.06%, mean 0.95%) but the cross-coin holdout did not clear n≥4 with a positive median (0.22%) and mean (-0.33%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-wide-two-tp` | 18 | 0.16% | 0.06% | 7 | 0.22% | $-96.57 |  |
| 2 | `grid-bidask-medium-two-oor` | 18 | 0.15% | -0.08% | 7 | 0.05% | $-97.65 |  |
| 3 | `grid-bidask-medium-two-tp` | 18 | 0.15% | -0.08% | 7 | 0.05% | $-97.65 |  |
| 4 | `grid-bidask-wide-two-oor` | 18 | 0.14% | -0.50% | 7 | 0.22% | $-96.57 |  |
| 5 | `grid-spot-medium-two-oor` | 18 | 0.13% | -0.09% | 7 | 0.05% | $-97.90 |  |
| 6 | `grid-spot-medium-two-tp` | 18 | 0.13% | -0.09% | 7 | 0.05% | $-97.90 |  |
| 7 | `grid-spot-wide-two-tp` | 18 | 0.11% | 0.05% | 7 | 0.18% | $-97.20 |  |
| 8 | `grid-spot-wide-two-oor` | 18 | 0.11% | -0.51% | 7 | 0.18% | $-97.20 |  |
| 9 | `grid-curve-medium-two-oor` | 18 | 0.10% | -0.59% | 7 | 0.04% | $-98.14 |  |
| 10 | `grid-curve-medium-two-tp` | 18 | 0.10% | -0.10% | 7 | 0.04% | $-98.14 |  |

Top train row vs holding: train $-7.49, time-split $-5.20, holdout $-96.57 (mean dollars versus buying and holding the entry tokens).

## fresh-memecoin

grid-bidask-wide-quote-oor led the time-split test among the top 5 train strategies, but the test median (0.00%) and mean (-0.61%) are not both positive, so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-spot-wide-two-oor` | 13 | 0.01% | 0.00% | 6 | -28.20% | $-103.44 |  |
| 2 | `grid-spot-wide-two-tp` | 13 | 0.01% | 0.00% | 6 | -5.58% | $-69.03 |  |
| 3 | `grid-bidask-wide-quote-tp` | 13 | 0.01% | 0.00% | 6 | 1.21% | $-10.31 |  |
| 4 | `grid-bidask-wide-quote-oor` | 13 | 0.01% | 0.00% | 6 | 1.21% | $-10.31 |  |
| 5 | `grid-bidask-wide-two-oor` | 13 | 0.01% | 0.00% | 6 | -25.44% | $-99.14 |  |
| 6 | `grid-bidask-wide-two-tp` | 13 | 0.01% | 0.00% | 6 | -4.87% | $-65.63 |  |
| 7 | `grid-curve-wide-two-oor` | 13 | 0.01% | 0.00% | 6 | -23.29% | $-101.36 |  |
| 8 | `grid-curve-wide-two-tp` | 13 | 0.01% | 0.00% | 6 | -6.29% | $-72.42 |  |
| 9 | `grid-bidask-medium-quote-oor` | 13 | 0.01% | 0.00% | 6 | 1.20% | $-11.93 |  |
| 10 | `grid-bidask-medium-quote-tp` | 13 | 0.01% | 0.00% | 6 | 1.20% | $-11.93 |  |

Top train row vs holding: train $4.91, time-split $-12.73, holdout $-103.44 (mean dollars versus buying and holding the entry tokens).

## high-vol-trending

grid-bidask-wide-quote-tp is promoted: train rank 3, time-split n=23 median 0.35%, holdout n=9 median 0.28%.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-wide-quote-timeout` | 23 | 0.78% | 0.01% | 9 | 4.72% | $18.46 |  |
| 2 | `grid-bidask-wide-quote-oor` | 23 | 0.31% | 0.35% | 9 | 0.28% | $4.34 |  |
| 3 | `grid-bidask-wide-quote-tp` | 23 | 0.31% | 0.35% | 9 | 0.28% | $4.34 | yes |
| 4 | `grid-spot-wide-quote-oor` | 23 | 0.30% | 0.35% | 9 | 0.28% | $4.28 |  |
| 5 | `grid-spot-wide-quote-tp` | 23 | 0.30% | 0.35% | 9 | 0.28% | $4.28 |  |
| 6 | `grid-curve-wide-quote-oor` | 23 | 0.07% | 0.35% | 9 | 0.28% | $4.23 |  |
| 7 | `grid-curve-wide-quote-tp` | 23 | 0.07% | 0.27% | 9 | 0.28% | $4.23 |  |
| 8 | `grid-spot-medium-quote-oor` | 23 | 0.00% | 0.27% | 9 | 0.28% | $4.21 |  |
| 9 | `grid-bidask-medium-quote-oor` | 23 | 0.00% | 0.27% | 9 | 0.28% | $4.26 |  |
| 10 | `grid-bidask-medium-quote-tp` | 23 | 0.00% | 0.27% | 9 | 0.28% | $4.26 |  |

Top train row vs holding: train $-7.18, time-split $116.22, holdout $18.46 (mean dollars versus buying and holding the entry tokens).

## established-midcap

grid-bidask-wide-quote-oor led the time-split test among the top 5 train strategies, but the test median (0.04%) and mean (-0.50%) are not both positive, so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-wide-quote-timeout` | 25 | 0.03% | 0.01% | 7 | 0.00% | $-10.09 |  |
| 2 | `grid-spot-wide-quote-timeout` | 25 | 0.03% | 0.01% | 7 | 0.00% | $-7.43 |  |
| 3 | `grid-curve-wide-quote-timeout` | 25 | 0.02% | 0.01% | 7 | 0.00% | $-8.99 |  |
| 4 | `grid-bidask-wide-quote-oor` | 25 | 0.00% | 0.04% | 7 | 0.00% | $0.02 |  |
| 5 | `grid-bidask-wide-quote-tp` | 25 | 0.00% | 0.04% | 7 | 0.00% | $0.02 |  |
| 6 | `grid-spot-wide-quote-oor` | 25 | 0.00% | 0.04% | 7 | 0.00% | $0.02 |  |
| 7 | `grid-spot-wide-quote-tp` | 25 | 0.00% | 0.04% | 7 | 0.00% | $0.02 |  |
| 8 | `grid-curve-wide-quote-oor` | 25 | 0.00% | 0.04% | 7 | 0.00% | $0.02 |  |
| 9 | `grid-curve-wide-quote-tp` | 25 | 0.00% | 0.04% | 7 | 0.00% | $0.02 |  |
| 10 | `grid-bidask-medium-quote-timeout` | 25 | 0.00% | 0.00% | 7 | -2.42% | $-5.79 |  |

Top train row vs holding: train $-11.77, time-split $-5.61, holdout $-10.09 (mean dollars versus buying and holding the entry tokens).

## older-memecoin

grid-bidask-wide-two-oor passed the time split (median 4.54%, mean 4.27%) but the cross-coin holdout did not clear n≥4 with a positive median (-3.53%) and mean (-9.50%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-wide-two-oor` | 21 | 2.13% | 4.54% | 9 | -3.53% | $-16.80 |  |
| 2 | `grid-bidask-wide-quote-oor` | 21 | 0.35% | 0.22% | 9 | 0.07% | $-1.47 |  |
| 3 | `grid-bidask-wide-quote-tp` | 21 | 0.35% | 0.22% | 9 | 0.07% | $-1.47 |  |
| 4 | `grid-spot-wide-quote-oor` | 21 | 0.35% | 0.22% | 9 | 0.07% | $-2.85 |  |
| 5 | `grid-spot-medium-quote-oor` | 21 | 0.15% | 0.16% | 9 | 0.00% | $-2.42 |  |
| 6 | `grid-curve-wide-quote-oor` | 21 | 0.15% | 0.22% | 9 | 0.07% | $-3.20 |  |
| 7 | `grid-spot-wide-quote-tp` | 21 | 0.15% | 0.22% | 9 | 0.07% | $-1.24 |  |
| 8 | `grid-bidask-medium-quote-oor` | 21 | 0.15% | 0.17% | 9 | 0.00% | $-1.70 |  |
| 9 | `grid-bidask-medium-quote-tp` | 21 | 0.15% | 0.17% | 9 | 0.00% | $-1.70 |  |
| 10 | `grid-curve-wide-quote-tp` | 21 | 0.15% | 0.22% | 9 | 0.07% | $-1.53 |  |

Top train row vs holding: train $-218.48, time-split $-104.02, holdout $-16.80 (mean dollars versus buying and holding the entry tokens).

Full rows, including strategies with no trials, are in `reports/leaderboard.csv`.

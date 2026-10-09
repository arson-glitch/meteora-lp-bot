# Strategy tournament leaderboard

Generated 2026-10-09T15:32:42.961Z. Paper only. Deposit size $250 per trial.

## How a winner is chosen

Strategies are ranked on the first 70% of each pool's candles by median net return (equity minus deposit, divided by deposit). Net return includes simulated LP fees and the inventory mark, so impermanent loss is inside it. A strategy needs at least 3 train trials to be ranked. The top 5 train strategies are re-ranked on the last 30% of candles, which is a separate replay that opens a new position. A config is written to `strategies/winners/` only when that test sample has at least 3 trials and both the test median and the test mean are positive. The other cells never see the test window.

## Caveats

- Fee share is `candle LP fees × position mark / pool TVL`, capped at 100% of the candle's LP fees. It is not per-bin concentration. A tight range does not earn a higher fee rate while it is in range; it just falls out of range sooner. TVL is frozen at the scan snapshot, and our deposit is not added into it, so small pools overstate the share.
- When Meteora volume history has an LP fee on the same timestamp, that figure is used (it is already the LP slice). Otherwise volume × `(baseFeePct + dynamicFeePct) / 100` × the pool's observed 24h LP share. `dynamicFeePct` is the current snapshot, not the historical variable fee.
- The intra-candle path is open, nearer extreme, other extreme, close. A wick can stop out or exit a range that the close would have survived.
- Quote-token USD is frozen. Token X is marked at `price × frozen quote USD`. There is no gas, no rebalance rent, and no extra composition fee.
- After an exit the trial sits in cash. It does not re-enter. Hodl is the initial token amounts marked at the window's last close, so an early exit is compared with holding through the rest of the window.
- The train/test split is temporal, on the same pools. It checks whether a rule survived the later part of this sample. It is not a new set of coins. Each bucket keeps at most four pools, and only one pool per coin: stable pairs are deduped by both mints, and every other bucket by the non-quote mint. Two bin steps of SOL-USDC are one trial.
- `sharpeLike` is mean trial return divided by the sample standard deviation of those trial returns. It is not annualized and it is not a bar-by-bar Sharpe.
- Bin step is the pool's step. The grid does not vary it, and winners are not split into bin-step bands.

## Samples

| Bucket | Pool | Bin step | Candles | Source | Fees |
| --- | --- | --- | --- | --- | --- |
| stable | USDe-USDG | 1 | 85 × 4h | meteora | volume-history |
| stable | USDC-USDT | 1 | 85 × 4h | meteora | volume-history |
| stable | PYUSD-USDC | 1 | 85 × 4h | meteora | volume-history |
| stable | EURC-USDC | 1 | 60 × 4h | meteora | volume-history |
| bluechip | SOL-USDC | 4 | 85 × 4h | meteora | volume-history |
| bluechip | JUP-SOL | 80 | 85 × 4h | meteora | volume-history |
| bluechip | cbBTC-SOL | 2 | 85 × 4h | meteora | volume-history |
| bluechip | PUMP-USDC | 20 | 85 × 4h | meteora | volume-history |
| fresh-memecoin | TikTok-SOL | 100 | 21 × 1h | meteora | volume-history |
| fresh-memecoin | QI-SOL | 100 | 10 × 1h | meteora | volume-history |
| fresh-memecoin | vamp-SOL | 100 | 16 × 1h | meteora | volume-history |
| fresh-memecoin | JPAD-SOL | 125 | only 3 candles | — | — |
| fresh-memecoin | MEMECHAN-SOL | 125 | only 3 candles | — | — |
| fresh-memecoin | Animal-SOL | 100 | 18 × 1h | meteora | volume-history |
| high-vol-trending | SOL-HYPE | 4 | 85 × 4h | meteora | volume-history |
| high-vol-trending | STRK-USDC | 100 | 85 × 4h | meteora | volume-history |
| high-vol-trending | SI-SOL | 100 | 85 × 4h | meteora | volume-history |
| high-vol-trending | PQC-SOL | 100 | 10 × 4h | meteora | volume-history |
| established-midcap | STONK-SOL | 20 | 85 × 4h | meteora | volume-history |
| established-midcap | BP-USDC | 50 | 85 × 4h | meteora | volume-history |
| established-midcap | TRUMP-USDC | 10 | 85 × 4h | meteora | volume-history |
| established-midcap | MET-SOL | 20 | 85 × 4h | meteora | volume-history |
| older-memecoin | wNEAR-USDC | 20 | 85 × 4h | meteora | volume-history |
| older-memecoin | HOOKED-SOL | 50 | 65 × 4h | meteora | volume-history |
| older-memecoin | MU-USDC | 20 | 85 × 4h | meteora | volume-history |
| older-memecoin | SPCX-USDC | 10 | 85 × 4h | meteora | volume-history |

## stable

grid-bidask-wide-token-rebalance led the test window among the top 5 train strategies, but the test median (0.03%) and mean (-0.00%) are not both positive, so it is not promoted.

| Rank | Strategy | Train n | Train median | Win rate | Max DD | Sharpe-like | Test n | Test median | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-wide-token-rebalance` | 4 | 0.02% | 75.00% | 2.69% | -0.46 | 4 | 0.03% |  |
| 2 | `grid-spot-wide-token-rebalance` | 4 | 0.02% | 75.00% | 2.67% | -0.47 | 4 | -0.00% |  |
| 3 | `grid-bidask-wide-two-oor` | 4 | 0.02% | 75.00% | 0.39% | -0.21 | 4 | -0.04% |  |
| 4 | `grid-bidask-wide-two-tp` | 4 | 0.02% | 75.00% | 0.39% | -0.21 | 4 | -0.04% |  |
| 5 | `grid-bidask-wide-two-timeout` | 4 | 0.02% | 75.00% | 0.62% | -0.29 | 4 | 0.02% |  |
| 6 | `grid-bidask-wide-two-rebalance` | 4 | 0.02% | 75.00% | 2.58% | -0.45 | 4 | -0.04% |  |
| 7 | `grid-bidask-medium-two-timeout` | 4 | 0.02% | 75.00% | 0.67% | -0.34 | 4 | 0.02% |  |
| 8 | `grid-spot-wide-two-oor` | 4 | 0.02% | 75.00% | 0.41% | -0.23 | 4 | -0.04% |  |
| 9 | `grid-spot-wide-two-tp` | 4 | 0.02% | 75.00% | 0.41% | -0.23 | 4 | -0.04% |  |
| 10 | `grid-spot-wide-two-timeout` | 4 | 0.02% | 75.00% | 0.64% | -0.30 | 4 | 0.02% |  |

Top train row mean fees $0.10, mean IL $-1.07, mean vs hodl $-0.97.

## bluechip

grid-bidask-wide-two-oor led the test window among the top 5 train strategies, but the test median (-0.64%) and mean (0.67%) are not both positive, so it is not promoted.

| Rank | Strategy | Train n | Train median | Win rate | Max DD | Sharpe-like | Test n | Test median | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-wide-two-timeout` | 4 | 1.99% | 75.00% | 6.75% | 1.16 | 4 | -1.29% |  |
| 2 | `grid-spot-wide-two-timeout` | 4 | 1.71% | 75.00% | 5.93% | 1.06 | 4 | -1.36% |  |
| 3 | `grid-curve-wide-two-timeout` | 4 | 1.44% | 75.00% | 5.08% | 0.94 | 4 | -1.44% |  |
| 4 | `grid-bidask-wide-two-oor` | 4 | 1.26% | 75.00% | 6.75% | 0.50 | 4 | -0.64% |  |
| 5 | `grid-bidask-wide-two-tp` | 4 | 1.26% | 75.00% | 6.75% | 0.50 | 4 | -0.64% |  |
| 6 | `grid-spot-wide-two-oor` | 4 | 0.99% | 75.00% | 5.93% | 0.43 | 4 | -0.72% |  |
| 7 | `grid-spot-wide-two-tp` | 4 | 0.99% | 75.00% | 5.93% | 0.43 | 4 | -0.72% |  |
| 8 | `grid-curve-wide-two-oor` | 4 | 0.71% | 75.00% | 5.08% | 0.35 | 4 | -0.79% |  |
| 9 | `grid-curve-wide-two-tp` | 4 | 0.71% | 75.00% | 5.08% | 0.35 | 4 | -0.79% |  |
| 10 | `grid-bidask-narrow-two-timeout` | 4 | 0.15% | 75.00% | 3.76% | -0.18 | 4 | -0.66% |  |

Top train row mean fees $2.56, mean IL $-6.57, mean vs hodl $-14.45.

## fresh-memecoin

grid-bidask-wide-token-tp led the test window among the top 5 train strategies, but the test median (-7.87%) and mean (-11.41%) are not both positive, so it is not promoted.

| Rank | Strategy | Train n | Train median | Win rate | Max DD | Sharpe-like | Test n | Test median | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-wide-token-tp` | 4 | 31.38% | 75.00% | 11.49% | 0.96 | 4 | -7.87% |  |
| 2 | `grid-spot-wide-token-tp` | 4 | 26.14% | 75.00% | 11.49% | 0.90 | 4 | -7.87% |  |
| 3 | `grid-bidask-wide-two-tp` | 4 | 22.66% | 100.00% | 0.00% | 2.25 | 4 | -9.21% |  |
| 4 | `grid-curve-wide-token-tp` | 4 | 20.90% | 75.00% | 11.49% | 0.81 | 4 | -7.88% |  |
| 5 | `grid-bidask-medium-token-tp` | 4 | 20.65% | 75.00% | 11.49% | 0.80 | 4 | -7.87% |  |
| 6 | `grid-spot-wide-two-tp` | 4 | 20.49% | 100.00% | 0.00% | 2.05 | 4 | -11.00% |  |
| 7 | `grid-curve-wide-two-tp` | 4 | 18.31% | 100.00% | 0.00% | 1.83 | 4 | -12.80% |  |
| 8 | `grid-bidask-wide-two-oor` | 4 | 17.41% | 75.00% | 56.32% | 0.18 | 4 | 7.60% |  |
| 9 | `grid-spot-medium-token-tp` | 4 | 16.78% | 75.00% | 11.49% | 0.71 | 4 | -7.88% |  |
| 10 | `grid-spot-wide-two-oor` | 4 | 14.44% | 75.00% | 56.82% | 0.11 | 4 | 6.06% |  |

Top train row mean fees $31.72, mean IL $-65.64, mean vs hodl $88.87.

## high-vol-trending

grid-bidask-wide-two-oor is promoted: train rank 1, test n=4, test median return 6.39%.

| Rank | Strategy | Train n | Train median | Win rate | Max DD | Sharpe-like | Test n | Test median | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-wide-two-oor` | 4 | 6.01% | 75.00% | 13.52% | 0.22 | 4 | 6.39% | yes |
| 2 | `grid-spot-wide-two-oor` | 4 | 4.55% | 75.00% | 15.59% | 0.06 | 4 | 5.04% |  |
| 3 | `grid-curve-wide-two-oor` | 4 | 3.09% | 75.00% | 17.66% | -0.11 | 4 | 3.69% |  |
| 4 | `grid-bidask-narrow-two-oor` | 4 | 0.07% | 50.00% | 21.45% | -0.46 | 4 | -0.30% |  |
| 5 | `grid-bidask-narrow-two-tp` | 4 | 0.07% | 50.00% | 21.45% | -0.46 | 4 | -0.30% |  |
| 6 | `grid-spot-narrow-two-oor` | 4 | 0.02% | 50.00% | 21.58% | -0.47 | 4 | -0.34% |  |
| 7 | `grid-spot-narrow-two-tp` | 4 | 0.02% | 50.00% | 21.58% | -0.47 | 4 | -0.34% |  |
| 8 | `grid-bidask-wide-quote-oor` | 4 | 0.02% | 75.00% | 2.90% | -0.03 | 4 | 0.03% |  |
| 9 | `grid-bidask-wide-quote-tp` | 4 | 0.02% | 75.00% | 2.90% | -0.03 | 4 | 0.03% |  |
| 10 | `grid-curve-wide-quote-oor` | 4 | 0.02% | 75.00% | 11.20% | -0.04 | 4 | 0.03% |  |

Top train row mean fees $0.85, mean IL $-14.42, mean vs hodl $-253.23.

## established-midcap

grid-bidask-wide-quote-timeout led the test window among the top 5 train strategies, but the test median (-4.14%) and mean (-5.75%) are not both positive, so it is not promoted.

| Rank | Strategy | Train n | Train median | Win rate | Max DD | Sharpe-like | Test n | Test median | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-wide-quote-timeout` | 4 | 0.05% | 75.00% | 17.37% | -0.48 | 4 | -4.14% |  |
| 2 | `grid-bidask-medium-quote-timeout` | 4 | 0.05% | 75.00% | 19.60% | -0.49 | 4 | -6.12% |  |
| 3 | `grid-spot-wide-quote-timeout` | 4 | 0.05% | 75.00% | 18.36% | -0.48 | 4 | -4.44% |  |
| 4 | `grid-curve-wide-quote-timeout` | 4 | 0.05% | 75.00% | 19.34% | -0.48 | 4 | -6.08% |  |
| 5 | `grid-spot-medium-quote-timeout` | 4 | 0.05% | 75.00% | 20.14% | -0.49 | 4 | -6.41% |  |
| 6 | `grid-curve-medium-quote-timeout` | 4 | 0.05% | 75.00% | 20.67% | -0.49 | 4 | -6.57% |  |
| 7 | `grid-bidask-wide-quote-oor` | 4 | 0.03% | 100.00% | 1.75% | 0.63 | 4 | 0.01% |  |
| 8 | `grid-bidask-wide-quote-tp` | 4 | 0.03% | 100.00% | 1.75% | 0.63 | 4 | 0.01% |  |
| 9 | `grid-spot-wide-quote-oor` | 4 | 0.03% | 100.00% | 4.00% | 0.64 | 4 | 0.01% |  |
| 10 | `grid-spot-wide-quote-tp` | 4 | 0.03% | 100.00% | 4.00% | 0.64 | 4 | 0.01% |  |

Top train row mean fees $0.68, mean IL $-10.93, mean vs hodl $-10.25.

## older-memecoin

grid-bidask-wide-two-oor is promoted: train rank 1, test n=4, test median return 1.90%.

| Rank | Strategy | Train n | Train median | Win rate | Max DD | Sharpe-like | Test n | Test median | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-wide-two-oor` | 4 | 0.73% | 75.00% | 17.75% | -0.35 | 4 | 1.90% | yes |
| 2 | `grid-bidask-wide-two-tp` | 4 | 0.73% | 75.00% | 17.75% | -0.35 | 4 | -1.58% |  |
| 3 | `grid-spot-wide-two-oor` | 4 | 0.57% | 75.00% | 18.78% | -0.38 | 4 | 1.53% |  |
| 4 | `grid-spot-wide-two-tp` | 4 | 0.57% | 75.00% | 18.78% | -0.38 | 4 | -1.95% |  |
| 5 | `grid-curve-wide-two-oor` | 4 | 0.42% | 75.00% | 19.81% | -0.41 | 4 | 1.16% |  |
| 6 | `grid-curve-wide-two-tp` | 4 | 0.42% | 75.00% | 19.81% | -0.41 | 4 | -2.31% |  |
| 7 | `grid-bidask-wide-quote-timeout` | 4 | 0.23% | 75.00% | 19.74% | -0.46 | 4 | -0.30% |  |
| 8 | `grid-spot-wide-quote-timeout` | 4 | 0.23% | 75.00% | 12.88% | -0.44 | 4 | -0.79% |  |
| 9 | `grid-curve-wide-quote-timeout` | 4 | 0.23% | 75.00% | 15.78% | -0.45 | 4 | -1.28% |  |
| 10 | `grid-bidask-medium-quote-timeout` | 4 | 0.20% | 75.00% | 15.85% | -0.46 | 4 | -1.25% |  |

Top train row mean fees $1.12, mean IL $-6.85, mean vs hodl $-179.20.

Full rows, including strategies with no trials, are in `reports/leaderboard.csv`.

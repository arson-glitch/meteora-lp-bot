# Strategy tournament leaderboard

Generated 2026-10-10T12:16:34.993Z. Paper only. Deposit size $250 per trial.

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

Accepted pools: 142. Skipped: 3.

| Bucket | Role | Pool | Bin step | History | Source | Fees |
| --- | --- | --- | --- | --- | --- | --- |
| stable | train | USDe-USDG | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | train | USDC-USDT | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | train | PYUSD-USDC | 1 | 90d 91 × 24h | meteora | volume-history |
| stable | holdout | EURC-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| stable | train | USDC-USDT | 16 | 90d 91 × 24h | meteora | volume-history |
| stable | train | USDC-USDT | 8 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-SOL | 2 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-SOL | 10 | 83d 84 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-SOL | 5 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JitoSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | BTC-SOL | 200 | 34d 35 × 24h | meteora | volume-history |
| bluechip | holdout | mSOL-SOL | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 1 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | PUMP-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| bluechip | holdout | cbBTC-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | JUP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 4 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | WBTC-USDC | 16 | 58d 59 × 24h | meteora | volume-history |
| bluechip | train | ETH-SOL | 15 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | USDC-JitoSOL | 80 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | INF-hSOL | 10 | 90d 91 × 24h | meteora | volume-history |
| bluechip | train | SOL-ETH | 50 | 90d 91 × 24h | meteora | volume-history |
| fresh-memecoin | train | SIB-SOL | 100 | 0d 12 × 1h | meteora | volume-history |
| fresh-memecoin | train | JPAD-SOL | 125 | 1d 24 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | QUBIT-SOL | 250 | 1d 17 × 1h | meteora | volume-history |
| fresh-memecoin | train | SWITCHED-SOL | 250 | 0d 8 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | BDAG-USDC | 2 | 0d 9 × 1h | meteora | volume-history |
| fresh-memecoin | train | RAD-USDC | 2 | 0d 9 × 1h | meteora | volume-history |
| fresh-memecoin | train | ORBIO-USDC | 2 | 0d 9 × 1h | meteora | volume-history |
| fresh-memecoin | train | PIXEL-USDC | 2 | 0d 9 × 1h | meteora | volume-history |
| fresh-memecoin | train | KAIA-USDC | 2 | 1d 14 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | LQR-USDC | 2 | 0d 9 × 1h | meteora | volume-history |
| fresh-memecoin | train | MON-USDC | 2 | 1d 14 × 1h | meteora | volume-history |
| fresh-memecoin | train | ZIL-USDC | 2 | 1d 14 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | MAGIC-USDC | 2 | 0d 9 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | BERA-USDC | 2 | 1d 14 × 1h | meteora | volume-history |
| fresh-memecoin | train | ROSE-USDC | 2 | 1d 14 × 1h | meteora | volume-history |
| fresh-memecoin | train | CFX-USDC | 2 | 1d 14 × 1h | meteora | volume-history |
| fresh-memecoin | train | JCT-USDC | 2 | 1d 14 × 1h | meteora | volume-history |
| fresh-memecoin | train | PEAQ-USDC | 2 | 1d 14 × 1h | meteora | volume-history |
| fresh-memecoin | holdout | QUBIT-SOL | 100 | 1d 17 × 1h | meteora | volume-history |
| fresh-memecoin | train | JPAD-SOL | 200 | 1d 24 × 1h | meteora | volume-history |
| high-vol-trending | train | STRK-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | SPCX-SOL | 10 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | PQC-SOL | 100 | 3d 16 × 4h | meteora | volume-history |
| high-vol-trending | train | QI-SOL | 100 | 1d 27 × 1h | meteora | volume-history |
| high-vol-trending | train | MUSK-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | HOOKED-SOL | 50 | 12d 71 × 4h | meteora | volume-history |
| high-vol-trending | train | HOTBOT-SOL | 100 | 8d 51 × 4h | meteora | volume-history |
| high-vol-trending | train | CLAUDIA-SOL | 125 | 4d 22 × 4h | meteora | volume-history |
| high-vol-trending | holdout | MU-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | HeeHaw-SOL | 100 | 40d 41 × 24h | meteora | volume-history |
| high-vol-trending | train | BORDR-SOL | 100 | 3d 16 × 4h | meteora | volume-history |
| high-vol-trending | train | CRAWL-SOL | 100 | 7d 41 × 4h | meteora | volume-history |
| high-vol-trending | holdout | TWEETCRAFT-SOL | 100 | 4d 22 × 4h | meteora | volume-history |
| high-vol-trending | holdout | RACE-USDC | 10 | 4d 23 × 4h | meteora | volume-history |
| high-vol-trending | train | HIGGS-SOL | 100 | 6d 37 × 4h | meteora | volume-history |
| high-vol-trending | train | INJ-USDC | 15 | 23d 24 × 24h | meteora | volume-history |
| high-vol-trending | train | CALI-SOL | 100 | 16d 97 × 4h | meteora | volume-history |
| high-vol-trending | holdout | SWOLF-SOL | 100 | 1d 26 × 1h | meteora | volume-history |
| high-vol-trending | train | STRK-USDC | 100 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | train | HOOKED-SOL | 30 | 8d 47 × 4h | meteora | volume-history |
| high-vol-trending | train | QI-USDC | 80 | 1d 18 × 1h | meteora | volume-history |
| high-vol-trending | train | CLAUDIA-USDC | 80 | 0d 9 × 1h | meteora | volume-history |
| high-vol-trending | train | HOTBOT-USDC | 80 | 0d 9 × 1h | meteora | volume-history |
| high-vol-trending | holdout | SPCX-USDC | 75 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | MU-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| high-vol-trending | holdout | RACE-SOL | 20 | 4d 24 × 4h | meteora | volume-history |
| high-vol-trending | train | PQC-USDC | 50 | 1d 33 × 1h | meteora | volume-history |
| high-vol-trending | train | BORDR-USDC | 80 | 3d 16 × 4h | meteora | volume-history |
| high-vol-trending | train | CRAWL-SOL | 80 | 6d 39 × 4h | meteora | volume-history |
| high-vol-trending | train | INJ-SOL | 50 | 12d 72 × 4h | meteora | volume-history |
| established-midcap | train | STONK-SOL | 20 | 59d 60 × 24h | meteora | volume-history |
| established-midcap | train | BP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | SOL-HYPE | 4 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 10 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | PENGU-USDC | 25 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ANTFUN-USDT | 16 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | SI-SOL | 30 | 11d 66 × 4h | meteora | volume-history |
| established-midcap | train | ANSEM-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CARDS-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | GOOGLx-SOL | 20 | 81d 82 × 24h | meteora | volume-history |
| established-midcap | holdout | MASK-SOL | 200 | 15d 89 × 4h | meteora | volume-history |
| established-midcap | train | ZCAT-SOL | 80 | 34d 35 × 24h | meteora | volume-history |
| established-midcap | train | ZEC-SOL | 15 | 50d 51 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | Bonk-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | NVDAx-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | USELESS-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | HYPE-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | MET-SOL | 4 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | SI-SOL | 100 | 16d 97 × 4h | meteora | volume-history |
| established-midcap | train | STONK-USDC | 8 | 22d 23 × 24h | meteora | volume-history |
| established-midcap | train | TRUMP-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | BP-SOL | 20 | 33d 34 × 24h | meteora | volume-history |
| established-midcap | train | ZEC-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | CARDS-SOL | 100 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | ORE-USDC | 50 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | train | ZCAT-USDC | 20 | 33d 34 × 24h | meteora | volume-history |
| established-midcap | train | PENGU-SOL | 20 | 90d 91 × 24h | meteora | volume-history |
| established-midcap | holdout | MASK-SOL | 20 | 14d 83 × 4h | meteora | volume-history |
| older-memecoin | train | wNEAR-USDC | 20 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | DARK-SOL | 75 | 4d 23 × 4h | meteora | volume-history |
| older-memecoin | train | Agency-SOL | 50 | 7d 42 × 4h | meteora | volume-history |
| older-memecoin | train | baton-SOL | 80 | 30d 31 × 24h | meteora | volume-history |
| older-memecoin | holdout | ANTHROPIC-SOL | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | JEANPHIL-SOL | 100 | 20d 21 × 24h | meteora | volume-history |
| older-memecoin | holdout | SKHY-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | PAID-SOL | 30 | 22d 23 × 24h | meteora | volume-history |
| older-memecoin | holdout | PEPE-SOL | 20 | 22d 23 × 24h | meteora | volume-history |
| older-memecoin | train | ENA-USDC | 100 | 88d 89 × 24h | meteora | volume-history |
| older-memecoin | train | swordcat-SOL | 100 | 12d 74 × 4h | meteora | volume-history |
| older-memecoin | train | EMBER-SOL | 50 | 28d 29 × 24h | meteora | volume-history |
| older-memecoin | holdout | XMR-USDC | 10 | 30d 31 × 24h | meteora | volume-history |
| older-memecoin | train | e/acc-SOL | 50 | 15d 88 × 4h | meteora | volume-history |
| older-memecoin | holdout | tSpaceX-USDC | 80 | 90d 91 × 24h | meteora | volume-history |
| older-memecoin | train | NINJACAT-SOL | 200 | 23d 24 × 24h | meteora | volume-history |
| older-memecoin | train | ALLINU-SOL | 50 | 29d 30 × 24h | meteora | volume-history |
| older-memecoin | train | Jimothy-SOL | 50 | 85d 86 × 24h | meteora | volume-history |
| older-memecoin | train | baton-SOL | 50 | 26d 27 × 24h | meteora | volume-history |
| older-memecoin | holdout | ANTHROPIC-USDC | 15 | 59d 60 × 24h | meteora | volume-history |
| older-memecoin | train | Agency-SOL | 100 | 8d 50 × 4h | meteora | volume-history |
| older-memecoin | train | DARK-USDC | 50 | 3d 16 × 4h | meteora | volume-history |
| older-memecoin | train | e/acc-SOL | 200 | 15d 88 × 4h | meteora | volume-history |
| older-memecoin | train | PAID-SOL | 80 | 25d 26 × 24h | meteora | volume-history |
| older-memecoin | holdout | PEPE-SOL | 10 | 16d 97 × 4h | meteora | volume-history |
| older-memecoin | holdout | XMR-SOL | 20 | 32d 33 × 24h | meteora | volume-history |
| older-memecoin | train | JEANPHIL-SOL | 50 | 2d 15 × 4h | meteora | volume-history |
| older-memecoin | train | EMBER-USDC | 200 | 31d 32 × 24h | meteora | volume-history |
| older-memecoin | train | swordcat-USDC | 80 | 8d 46 × 4h | meteora | volume-history |
| older-memecoin | train | ALLINU-SOL | 100 | 29d 30 × 24h | meteora | volume-history |
| older-memecoin | train | NINJACAT-SOL | 160 | 21d 22 × 24h | meteora | volume-history |

## stable

No strategy has 8 or more train trials, so nothing is promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | `grid-curve-medium-token-stay-array` | 5 | 1.80% | 1.02% | 1 | -2.31% | $-0.82 |  |
| — | `grid-curve-medium-token-patient-array` | 5 | 1.80% | 1.02% | 1 | -1.23% | $1.88 |  |
| — | `grid-spot-narrow-token-stay-array` | 5 | 1.80% | 1.79% | 1 | -2.28% | $-0.75 |  |
| — | `grid-spot-narrow-token-patient-array` | 5 | 1.80% | 1.79% | 1 | -1.22% | $1.89 |  |
| — | `grid-curve-narrow-token-stay-array` | 5 | 1.79% | 1.79% | 1 | -2.36% | $-0.96 |  |
| — | `grid-curve-narrow-token-patient-array` | 5 | 1.79% | 1.79% | 1 | -1.22% | $1.89 |  |
| — | `grid-curve-narrow-two-stay-array` | 5 | 1.77% | 1.79% | 1 | -2.47% | $-3.71 |  |
| — | `grid-spot-medium-two-stay-array` | 5 | 1.77% | 1.23% | 1 | -2.14% | $-2.89 |  |
| — | `grid-curve-narrow-two-patient-array` | 5 | 1.77% | 0.52% | 1 | -1.46% | $-1.17 |  |
| — | `grid-spot-medium-two-patient-array` | 5 | 1.77% | 1.23% | 1 | -2.17% | $-2.96 |  |

Top train row vs holding: train $3.09, time-split $29.25, holdout $-0.82 (mean dollars versus buying and holding the entry tokens).

## bluechip

grid-curve-narrow-two-stay-array beat cash on the holdout but did not beat holding the token (median -$2.92, mean -$194.22), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-spot-narrow-two-patient-array` | 18 | 1.51% | 1.58% | 7 | 0.16% | $-95.67 |  |
| 2 | `grid-curve-narrow-two-patient-array` | 18 | 1.39% | 1.79% | 7 | 0.16% | $-96.25 |  |
| 3 | `grid-curve-narrow-two-stay-array` | 18 | 1.32% | 2.06% | 7 | 0.16% | $-85.58 |  |
| 4 | `grid-spot-narrow-two-stay-array` | 18 | 0.97% | 2.05% | 7 | 0.16% | $-85.84 |  |
| 5 | `grid-curve-narrow-token-stay-array` | 18 | 0.70% | 1.23% | 7 | 0.43% | $-205.91 |  |
| 6 | `grid-curve-medium-quote-stay-array` | 18 | 0.69% | 0.17% | 7 | 0.13% | $13.94 |  |
| 7 | `grid-spot-narrow-token-stay-array` | 18 | 0.55% | 1.56% | 7 | 0.51% | $-206.68 |  |
| 8 | `grid-curve-narrow-quote-stay-array` | 18 | 0.49% | 1.76% | 7 | 0.08% | $28.71 |  |
| 9 | `grid-curve-narrow-quote-patient-array` | 18 | 0.26% | 2.89% | 7 | 0.08% | $12.00 |  |
| 10 | `grid-spot-narrow-quote-stay-array` | 18 | 0.24% | 0.70% | 7 | 0.08% | $24.13 |  |

Top train row vs holding: train $-5.83, time-split $12.85, holdout $-95.67 (mean dollars versus buying and holding the entry tokens).

## fresh-memecoin

grid-curve-narrow-quote-patient-array beat cash and the token on the holdout, but one coin is 99.96% of positive PnL, above the 50.00% cap, so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-quote-patient-array` | 14 | 0.24% | 0.04% | 6 | 0.25% | $1043.82 |  |
| 2 | `grid-curve-narrow-quote-stay-array` | 14 | 0.24% | 0.04% | 6 | 0.25% | $1043.82 |  |
| 3 | `grid-spot-narrow-quote-patient-array` | 14 | 0.24% | 0.04% | 6 | 0.25% | $1046.12 |  |
| 4 | `grid-spot-narrow-quote-stay-array` | 14 | 0.24% | 0.04% | 6 | 0.25% | $1046.12 |  |
| 5 | `grid-curve-medium-quote-patient-array` | 14 | 0.24% | 0.04% | 6 | 0.25% | $1069.55 |  |
| 6 | `grid-curve-medium-quote-stay-array` | 14 | 0.24% | 0.04% | 6 | 0.25% | $1069.55 |  |
| 7 | `grid-curve-narrow-quote-timeout` | 14 | 0.24% | 0.04% | 6 | 0.25% | $1043.82 |  |
| 8 | `grid-spot-narrow-quote-timeout` | 14 | 0.24% | 0.04% | 6 | 0.25% | $1046.12 |  |
| 9 | `grid-curve-medium-quote-timeout` | 14 | 0.24% | 0.03% | 6 | 0.25% | $1068.57 |  |
| 10 | `grid-spot-narrow-quote-rebalance` | 14 | 0.24% | 0.04% | 6 | 0.25% | $1371.60 |  |

Top train row vs holding: train $285.06, time-split $24.60, holdout $1043.82 (mean dollars versus buying and holding the entry tokens).

## high-vol-trending

grid-curve-narrow-token-stay-array beat cash and the token on the holdout, but one coin is 79.25% of positive PnL, above the 50.00% cap, so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-curve-narrow-token-patient-array` | 22 | 12.08% | 8.62% | 8 | 26.31% | $479.21 |  |
| 2 | `grid-curve-narrow-token-stay-array` | 22 | 11.90% | 10.93% | 8 | 27.46% | $476.25 |  |
| 3 | `grid-spot-narrow-token-stay-array` | 22 | 11.39% | 7.05% | 8 | -2.69% | $79.10 |  |
| 4 | `grid-spot-narrow-token-patient-array` | 22 | 11.39% | 6.30% | 8 | -3.00% | $82.06 |  |
| 5 | `grid-curve-narrow-two-patient-array` | 22 | 10.30% | 9.62% | 8 | 36.74% | $541.65 |  |
| 6 | `grid-spot-narrow-two-patient-array` | 22 | 9.89% | 8.72% | 8 | 33.24% | $540.12 |  |
| 7 | `grid-curve-narrow-quote-patient-array` | 22 | 9.21% | 11.55% | 8 | 23.43% | $491.60 |  |
| 8 | `grid-curve-narrow-quote-stay-array` | 22 | 8.79% | 11.55% | 8 | 20.24% | $486.77 |  |
| 9 | `grid-spot-narrow-quote-patient-array` | 22 | 8.02% | 9.51% | 8 | 22.85% | $495.13 |  |
| 10 | `grid-spot-narrow-quote-stay-array` | 22 | 6.80% | 9.51% | 8 | 19.14% | $490.29 |  |

Top train row vs holding: train $55.31, time-split $485.77, holdout $479.21 (mean dollars versus buying and holding the entry tokens).

## established-midcap

grid-curve-narrow-quote-patient-array passed the time split (median 5.57%, mean 4.16%) but the cost-adjusted holdout did not beat cash (n=8, median -2.13%, mean 7.89%), so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-spot-narrow-quote-patient-array` | 22 | 0.32% | 5.16% | 8 | -1.98% | $9.71 |  |
| 2 | `grid-curve-narrow-quote-patient-array` | 22 | 0.31% | 5.57% | 8 | -2.13% | $19.72 |  |
| 3 | `grid-curve-narrow-token-patient-array` | 22 | 0.07% | 4.78% | 8 | -4.37% | $-40.97 |  |
| 4 | `grid-curve-narrow-token-timeout` | 22 | 0.03% | -1.09% | 8 | -1.73% | $-36.06 |  |
| 5 | `grid-spot-narrow-token-patient-array` | 22 | -0.06% | 4.59% | 8 | -4.77% | $-52.20 |  |
| 6 | `grid-spot-narrow-token-timeout` | 22 | -0.22% | -1.84% | 8 | -1.73% | $-47.19 |  |
| 7 | `grid-curve-narrow-quote-stay-array` | 22 | -0.33% | 4.32% | 8 | -6.11% | $4.70 |  |
| 8 | `grid-bidask-narrow-token-timeout` | 22 | -0.57% | -2.52% | 8 | -1.73% | $-63.41 |  |
| 9 | `grid-spot-narrow-two-patient-array` | 22 | -0.69% | 5.65% | 8 | -4.23% | $-22.44 |  |
| 10 | `grid-curve-narrow-two-patient-array` | 22 | -0.71% | 5.76% | 8 | -4.70% | $-12.25 |  |

Top train row vs holding: train $3.65, time-split $7.00, holdout $9.71 (mean dollars versus buying and holding the entry tokens).

## older-memecoin

grid-curve-narrow-quote-oor beat cash and the token on the holdout, but one coin is 63.46% of positive PnL, above the 50.00% cap, so it is not promoted.

| Rank | Strategy | Train n | Train median | Time-test median | Holdout n | Holdout median | Holdout vs hold | Promoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `grid-bidask-narrow-token-timeout` | 23 | 1.28% | -15.02% | 8 | 1.03% | $17.70 |  |
| 2 | `grid-spot-narrow-token-timeout` | 23 | 1.11% | -13.04% | 8 | 1.39% | $51.02 |  |
| 3 | `grid-curve-narrow-token-timeout` | 23 | 0.94% | -5.31% | 8 | 1.76% | $84.34 |  |
| 4 | `grid-curve-narrow-quote-timeout` | 23 | 0.02% | -4.02% | 8 | 2.08% | $132.55 |  |
| 5 | `grid-spot-narrow-quote-timeout` | 23 | 0.01% | -4.13% | 8 | 1.23% | $117.23 |  |
| 6 | `grid-curve-narrow-quote-oor` | 23 | 0.00% | 0.74% | 8 | 2.19% | $22.75 |  |
| 7 | `grid-curve-narrow-quote-tp` | 23 | 0.00% | 0.74% | 8 | 2.19% | $22.75 |  |
| 8 | `grid-bidask-narrow-quote-timeout` | 23 | -0.00% | -4.24% | 8 | 0.38% | $101.68 |  |
| 9 | `grid-spot-narrow-quote-oor` | 23 | -0.25% | 0.13% | 8 | 1.28% | $13.59 |  |
| 10 | `grid-spot-narrow-quote-tp` | 23 | -0.25% | 0.13% | 8 | 1.28% | $13.59 |  |

Top train row vs holding: train $-256.94, time-split $-292.22, holdout $17.70 (mean dollars versus buying and holding the entry tokens).

Full rows, including strategies with no trials, are in `reports/leaderboard.csv`.

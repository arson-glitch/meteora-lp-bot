# High-vol winner edge

Generated 2026-10-09T20:07:10.935Z. Paper only. Strategy `frozen-high-vol-bidask-wide-quote-tp-2026-10-09`. Deposit $250. SOL marked at $108.55 for rent and priority fees. Cost model 2026-10-09. 32 leaderboard pools were requested.

The promoted cell is Bid-Ask, wide (40 bins on the quote side), close when the active bin leaves the range, 8% stop, 15% take-profit. Train is the first 70% of each train coin. Time-split is the last 30% of those same coins. Holdout coins are absent from both.

## Fee share

The leaderboard model gives the whole in-range position a share of the candle's LP fees equal to position value / pool TVL. It does not look at which bin is active. A wide Bid-Ask therefore earns the same fee rate as a position that sits entirely in the active bin, until it goes out of range.

The active-bin model pays fees only to liquidity in the active bin. Pool TVL is spread evenly across both sides of a one-day move (at least 20 bins, using the frozen 24h price change). Our share of a candle slice is our dollars in that bin divided by the pool's dollars in that bin, capped at 100%. Bid-Ask puts its largest weight on the outer bins, so the active bin is thin and the fee estimate falls.

## Costs

Exit sells the non-SOL token inventory, including unclaimed fees, back to SOL by walking pool bins. Depth is the same uniform TVL split. The pool's current base plus dynamic fee is charged on the input. A non-SOL quote is then sold to SOL against a $10M reserve at 4 bps. Position rent (0.05740608 SOL per account) is refundable on close and is not in the PnL cost. Bin arrays other than the active bin's array cost 0.07143744 SOL each and are not refunded, because the close does not call closeBinArray. Open and close each pay a 5,000-lamport base fee plus a priority fee (0.00004 SOL open, 0.00003 SOL close). Jupiter quotes are live only, so they are not applied to these historical exits. A live Jupiter quote of 1 SOL to USDC returned about $108.65 with price impact under 0.0001%, which is why the stablecoin-to-SOL hop uses a deep-book estimate instead of meme-pool depth.

## Edge

Dollars are the mean per trial on a $250 deposit. Versus hold compares terminal equity with holding the entry tokens. This strategy deposits only the quote asset, and quote USD is frozen, so holding that entry is flat in USD and versus-hold matches the strategy PnL. Costs are subtracted from the LP result only.

| Measurement | Split | n | Median return | Mean return | Mean PnL | Mean vs hold |
| --- | --- | --- | --- | --- | --- | --- |
| TVL share, no costs | train | 23 | 0.31% | -3.01% | -$7.53 | -$7.53 |
| TVL share, no costs | time-split | 23 | 0.34% | 3.33% | $8.31 | $8.31 |
| TVL share, no costs | holdout | 9 | 0.28% | 1.71% | $4.27 | $4.27 |
| TVL share, with costs | train | 23 | -3.03% | -6.65% | -$16.62 | -$16.62 |
| TVL share, with costs | time-split | 23 | -2.69% | 0.60% | $1.51 | $1.51 |
| TVL share, with costs | holdout | 9 | -2.62% | -1.07% | -$2.67 | -$2.67 |
| Active-bin share, no costs | train | 23 | 0.00% | -9.46% | -$23.65 | -$23.65 |
| Active-bin share, no costs | time-split | 23 | 0.00% | -2.09% | -$5.22 | -$5.22 |
| Active-bin share, no costs | holdout | 9 | 0.00% | 0.32% | $0.80 | $0.80 |
| Active-bin share, with costs | train | 23 | -3.11% | -13.20% | -$33.00 | -$33.00 |
| Active-bin share, with costs | time-split | 23 | -3.10% | -5.16% | -$12.90 | -$12.90 |
| Active-bin share, with costs | holdout | 9 | -3.11% | -2.44% | -$6.11 | -$6.11 |

## Distribution

Returns are per trial. Drawdown per trial is the peak-to-trough of that trial's equity. The aggregate drawdown lines every trial in the split up at bar 0, as if they were funded together, and keeps a finished trial at its final equity. Train and time-split are separate windows on the same coins, so they are not one portfolio.

### TVL share, no costs

| Split | n | Mean | Median | 5th percentile | Mean max DD | Worst trial DD | Aggregate DD |
| --- | --- | --- | --- | --- | --- | --- | --- |
| train | 23 | -3.01% | 0.31% | -46.07% | 8.57% | 57.66% | 0.00% |
| time-split | 23 | 3.33% | 0.34% | 0.04% | 0.60% | 10.56% | 0.00% |
| holdout | 9 | 1.71% | 0.28% | 0.00% | 0.13% | 1.09% | 0.00% |

train: top 3 coins (fone-SOL $108.51; HeeHaw-SOL $66.81; RARI-SOL $65.43) are -139.02% of net PnL and 96.23% of positive coin PnL. time-split: top 3 coins (HeeHaw-SOL $118.77; PQC-SOL $44.95; fone-SOL $12.67) are 92.25% of net PnL and 92.25% of positive coin PnL. holdout: top 3 coins (OTC-SOL $20.02; MASK-SOL $11.09; RACE-USDC $7.29) are 99.99% of net PnL and 99.99% of positive coin PnL.

### Active-bin share, with costs

| Split | n | Mean | Median | 5th percentile | Mean max DD | Worst trial DD | Aggregate DD |
| --- | --- | --- | --- | --- | --- | --- | --- |
| train | 23 | -13.20% | -3.11% | -53.03% | 4.73% | 16.36% | 4.12% |
| time-split | 23 | -5.16% | -3.10% | -15.57% | 6.01% | 66.25% | 5.45% |
| holdout | 9 | -2.44% | -3.11% | -3.11% | 2.76% | 3.11% | 2.73% |

train: top 3 coins (HeeHaw-SOL $64.39; CLAUDIA-SOL -$7.30; MUSK-USDC -$7.35) are -6.55% of net PnL and 100.00% of positive coin PnL. time-split: top 3 coins (JEANPHIL-SOL -$0.02; baton-SOL -$6.40; CLAUDIA-SOL -$7.56) are 4.71% of net PnL and — of positive coin PnL. holdout: top 3 coins (MASK-SOL -$6.51; SKHY-USDC -$7.76; OTC-SOL -$9.66) are 43.53% of net PnL and — of positive coin PnL.

## TikTok-SOL

TikTok-SOL (TikTok-SOL, 5k7rNmiq9bYbnvNmnGuz53PRVxFwL6Zy377kbPE6fJ5m) is classified as **high-vol-trending** at 2026-10-09T20:07:10.935Z. Pool age 24.7 hours. The fresh-memecoin rule is age under 24 hours, and it wins over high-vol. 24h volume/TVL 62.72 ≥ 8 The original forward book opened it in the fresh-memecoin bucket on 2026-10-09, while the pool was under a day old.

# Hypothesis check H10–H14 2026-10-10

Paper only. Deposit $250. SOL $110.54. 142 pools with candles from a discovered universe of 895. Replay is crossed-bin LP fees plus exit slippage, transaction fees, and non-refundable bin-array rent. Train coins replay the first 70% of bars as train and the last 30% as test. Holdout coins are the sorted 30% sample-key split; their features use the first 70% of bars and the replay is the last 30%. A gate that fails produces no trial.

H26 and H27 are not tested. Perps, borrowed leverage, and lending are rejected by the strategy loader.

## Leverage term

Full-range LVR is σ²/8 of position value per day (Milionis et al.). At 5% daily vol that is 3.13 bp. The brief's factor L = 1/(1−√(p_low/p_high)) is 50.8 on a 5-bin range at bin step 100. A one-bin finite-difference gamma of the same Spot position is 65.2, about 1.28× the brief. On an 80-bin range at the same step the discrete factor is 1.3 and the brief's factor is 1.8. Discrete gamma is steeper than the brief on narrow ranges and can be lower once the range is many wide bins. Cartea's 4/δ is about twice the brief for a narrow range. The gates below use the discrete factor when the position is concave, and the brief's factor otherwise. This factor is concentration, not borrowed leverage.

## H10 Fee yield versus LVR

**rejected.** The cell is broad two-sided Spot, 96-hour out-of-range hold. H2's gate is the top quintile of candle fee/TVL divided by absolute price change over the feature window (floor 1%), the same ratio as the earlier check. H10 enters when daily fee/TVL > k · σ²/8 · L. σ is the dailyized standard deviation of log closes in that window.

OOS (time-split test plus holdout) mean net: ungated -$15.05 (n=133), H2 quintile -$0.98 (n=28), k=1 -$9.85 (n=65), k=2 -$10.60 (n=44), k=4 -$6.98 (n=30).

Week-ahead replay, OOS weeks only, 108 pools had at least two weeks: ungated -$19.22 (n=512), H2 -$17.54 (n=176), k=1 -$17.25 (n=204).

## H11 Minimum hold

**confirmed.** Same broad Spot range. A minimum hold blocks the out-of-range close until that many hours; stop-loss still fires. For 24/48/72h the entry also requires expected fee/TVL over the hold to clear a 3% cost floor plus σ²/8·L over that hold. The 0h row is immediate out-of-range close with no fee screen, so it is the cost-churn baseline.

- 0h: OOS mean net -$16.42 (n=133), share of OOS trades where cost exceeds half of fees 96.2% (n=133)
- 24h: OOS mean net -$8.63 (n=31), share of OOS trades where cost exceeds half of fees 83.9% (n=31)
- 48h: OOS mean net -$13.87 (n=37), share of OOS trades where cost exceeds half of fees 86.5% (n=37)
- 72h: OOS mean net -$14.40 (n=39), share of OOS trades where cost exceeds half of fees 87.2% (n=39)

## H12 Cartea–Drissi–Monga width

**confirmed.** On the H2 quintile. μ = 0, so δ* = 4γ / (8π − σ²) (their equation 34). δ* > 4 or a non-positive denominator withdraws. Bins each side are round(ln(1+δ*/2) / ln(1+binStep/10000)), clamped to 1..80. The best fixed width is the train-window mean, then that width is frozen for test and holdout. Train picked 2 bins each side.

OOS mean net: best fixed $68.45 (n=28), γ=5e-7 (their ETH/USDC study) $125.60 (n=25, withdrew 3), γ=1e-3 (their figure scale) $122.08 (n=25, withdrew 3). The published γ=5e-7 collapses toward one bin on daily units, so the comparison that can move width is γ=1e-3.

## H13 Variance-ratio regime

**untestable.** 5-minute closes from Meteora ohlcv, last 48 hours. VR is the variance of 12-bar (1 hour) log returns divided by 12 times the 5-minute variance. Entry also requires the latest 1-hour absolute log return to sit under the median of those hourly moves in the same 48 hours. The VR>1.2 exit is not applied inside the candle replay: the 5-minute series is an entry screen, not a path through the position. Pools with a VR: 0. Passed the screen: 0.

OOS mean net on the H2 quintile: unfiltered n/a (n=0), VR<1 screen n/a (n=0).

## H14 Inventory unwind

**rejected.** Wide two-sided Spot that closes on the first out-of-range mark, versus the same path when a book that is at least 70% one token is placed on a 10-bin single-sided Bid-Ask for 6 hours and then closed. The reshape uses the tokens already in the position. Armed unwinds: 127.

OOS mean net: market exit -$10.79 (n=142), unwind -$8.98 (n=142). OOS mean exit slippage: market $1.03, unwind $2.13.

## Promotion

Nothing promotes. These cells were scored with the same gates as the tournament (beat cash and beat holding the token on the holdout, no coin above 50% of positive PnL, walk-forward time split, at least 8 train / 5 test / 4 holdout trials). They were not mixed into the 108-cell grid.

- stable: No strategy has 8 or more train trials, so nothing is promoted.
- bluechip: h14-unwind-6h led the time-split test among the top 5 yield strategies, but the test median (-1.44%) and mean (-1.74%) are not both positive, so it is not promoted.
- fresh-memecoin: h14-unwind-6h led the time-split test among the top 5 yield strategies, but the test median (-3.21%) and mean (10.38%) are not both positive, so it is not promoted.
- high-vol-trending: h12-best-fixed beat cash and the token on the holdout, but one coin is 60.43% of positive PnL, above the 50.00% cap, so it is not promoted.
- established-midcap: h14-unwind-6h led the time-split test among the top 5 yield strategies, but the test median (-3.84%) and mean (-3.73%) are not both positive, so it is not promoted.
- older-memecoin: h12-best-fixed passed the time split (median 18.57%, mean 10.24%) but the cost-adjusted holdout did not beat cash (n=1, median 88.49%, mean 88.49%), so it is not promoted.

## Swap tape and the Helius plan

Meteora's DLMM data API does not publish a swap count. The pool payload, `/ohlcv`, and `/volume/history` have volume and LP fees. That was checked on the swagger and on SOL-USDC. The counts here are DexScreener buys plus sells for the last 24 hours on the same Meteora pair address. One day is not a long average.

Pools in the candle set: 142. DexScreener returned a count for 142. Missing 0. Sum 534314 swaps/day. Median 1828. 90th percentile 9522.

The recorder dropped about 286,000 signatures in 17 minutes across 142 logsSubscribe subscriptions. That is 24,225,882 mentions/day, or 170,605 per pool per day, if that rate held. Mentions include non-swap transactions. Measured swaps are 45.3× fewer than that mention rate, so the socket is not a swap tape.

Credits add 10% for liquidity transactions. getSignaturesForAddress is about one call per 1,000 signatures. getTransactionsForAddress is 0.1 credit per transaction and needs Developer. Archival getTransaction at 10 credits is the pricing-page conflict.

| Book | Tx/day | getTransaction @1 | archival @10 | getTransactionsForAddress @0.1 | parsed stream @1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Median × pools | 285534 | 8.57M/mo | 85.66M/mo | 857k/mo | 8.57M/mo |
| Sum of measured | 587745 | 17.65M/mo | 176.32M/mo | 1.76M/mo | 17.63M/mo |
| 90th × pools | 1487336 | 44.66M/mo | 446.20M/mo | 4.46M/mo | 44.62M/mo |

Cheapest plan that covers the measured sum on getTransactionsForAddress: Developer ($49, 10M) via getTransactionsForAddress. The same book on parsed streams needs Business ($499, 100M). Plain getTransaction at 1 credit needs Business ($499, 100M).

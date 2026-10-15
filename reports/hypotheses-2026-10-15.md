# Hypothesis check 2026-10-15

Paper only. Deposit baseline $250. SOL $102.39. Trials already include crossed-bin LP fees, exit slippage, transaction fees, and non-refundable bin-array rent. Position rent is locked capital and is not in PnL.

## Fee model

- **Multi-bin fees: partial.** The SDK and the program events show a swap from `start_bin_id` to `end_bin_id` paying a fee in each bin it crosses. This run splits each candle's observed LP fee across the bins the candle path walked, by our liquidity in those bins. A one-bin move matches the old active-bin model. A full `Swap2Evt` replay is untestable: the public candle API does not include per-swap bin ranges.
- **Dynamic fee: partial.** Volume-history fees are the fees LPs were actually paid, so they already include the variable fee. The fallback estimator uses the pool's current `dynamicFeePct` and caps base plus variable at 10%, which is `MAX_FEE_RATE` in `@meteora-ag/dlmm`. It is not the historical volatility accumulator.
- **Protocol fee: confirmed.** Meteora's volume history `fees` field is the LP slice. `protocol_fees` is separate. The fallback multiplies by the observed LP share, which is about 90% on standard pools and follows the pool when the API reports a different split. Launch pools at 20% are handled by that observed share, not by a hard-coded 10%.

## H1 Wide high-fee Spot versus holding

**rejected.** Two-sided Spot, 80 bins each side, 96-hour out-of-range hold, on memecoin pools with bin step 80–200 and base fee 1–5%. n=24. Mean net -$17.92. Mean versus holding the token -$487.19.

Only 0 of those trials have deposit/TVL ≥ 30%. A $250 deposit is a small share of almost every scanned pool, and historical per-bin liquidity is not in the public candle API, so the ≥30% in-range-share clause is untestable.

## H2 Fee/TVL over realized volatility

**confirmed.** Rank is 24h fee/TVL divided by absolute 24h price change (floor 1%). Top quintile train mean net -$15.30 (n=23) versus the rest -$22.57 (n=75), on the broad Spot stay cell. This is the same backtest window, not a separate forward 24h entry test. In-range TVL is not available, so the ratio uses pool TVL.

## H3 Rebalance timing

**untestable.** Spot wide two-sided. Immediate rebalance mean net -$34.77 (n=136). Rebalance after 6 hours out of range -$13.45 (n=136). No rebalance, 48-hour close, single bin array n/a (n=0). The brief's extra gate, rebalance only when expected fees exceed the cost, is untestable without a fee forecast. Meteora's `rebalance_liquidity` instruction may be cheaper than close plus reopen; that cost was not measured on devnet.

## H4 Bin-array rent only when the array is new

**Partial.** `@meteora-ag/dlmm` sets `MAX_BIN_PER_ARRAY` to 70, `BIN_ARRAY_FEE` to 0.07143744 SOL, and charges that rent only for accounts that do not yet exist (`uninitializedBinArrayCount`). Position rent is 0.05740608 SOL. The brief's 0.075 and 0.059 figures are rounded. This backtest charges every array except the one holding the active bin, and it does not read `getBinArrays`. Historical account existence is untestable from candles. Single-array grid cells are clipped so they cover no second array.

## H5 Minimum size

**confirmed.** The same broad Spot stay cell replayed at several deposits. Fixed rent and fees hurt the small deposit more if the verdict is confirmed. This is one cell and one pool per bucket, not the whole grid.

- $50: mean net -$18.94 over 6 pools
- $250: mean net -$16.68 over 6 pools
- $1000: mean net -$8.41 over 6 pools
- $5000: mean net $30.30 over 6 pools

## H6 Position rent is locked capital

**Confirmed.** `pnlCostUsd` includes transaction fees, non-refundable bin-array rent, and exit slippage. Refundable position-account rent is reported separately and is not subtracted from PnL. The SDK's `POSITION_FEE` is 0.05740608 SOL per position account.

## H7 Meteora blacklist-style filters

**confirmed.** Flagged pools are blacklisted, have freeze authority enabled, have 100 or fewer holders, or have TVL under $5,000. Train mean net on the single-array Spot stay cell: flagged $6.46 (n=17), others $14.04 (n=81). Discovery already drops Meteora's `is_blacklisted` pools, so that clause has almost no in-sample contrast. Top-holder percentages and "dev is the LP" are not in the pool list payload, so those two blacklist clauses are untestable here. The paper rug gate's holder floor is 100, matching the published criterion, and TVL under $5,000 still fails.

## H8 Trader concentration

**Untestable.** The pool list, OHLCV, and volume-history endpoints do not include swapper addresses. A top-5 trader share needs `Swap2Evt` or a paid swap tape. It is not in this run.

## H9 Composite exit

**confirmed.** The guard closes when equity is 8% off its peak and the candle's volume is under a quarter of the prior median. It does not see TVL-drain events or a live RugCheck change; those are untestable from candles. Broad Spot stay return 5th percentile -53.46% (n=136) versus the guard -51.87% (n=136). Mean net -$18.08 versus -$17.25.

## Bid-Ask

Bid-Ask is excluded from promotion. Holdout trials: 1368. Single-sided holdout trials ahead of holding the token: 431/912. That comparison is the market-sell alternative at the window's end price, not a TWAP.

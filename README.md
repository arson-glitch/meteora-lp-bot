# Meteora LP bot

Paper-trading foundation for an automated liquidity provider on [Meteora](https://docs.meteora.ag/get-started). The default path discovers live DLMM pools, scores token risk, picks a strategy from JSON files, and simulates the position. It does not sign or send transactions unless live mode is turned on explicitly.

DLMM (Dynamic Liquidity Market Maker) is the primary product. DAMM v2 can be listed for discovery and is not executed.

## Architecture

```text
scanner  ->  rug checker  ->  strategy picker  ->  risk limits  ->  paper executor  ->  monitor
                              ^
tournament (paper)  ->  strategies/winners/*.json
     classify, 108-cell grid, historical replay, forward paper book
   |              |                  |                                    |
   |              |                  |                                    +-- live executor (gated)
 Meteora       RugCheck          strategies/*.json
 DLMM API      + local checks    Spot / Curve / Bid-Ask
 DexScreener
 Birdeye (optional)
```

| Module | Role |
| --- | --- |
| `src/scanner` | Pulls DLMM pools from `https://dlmm.datapi.meteora.ag` (volume leaders and newly created pools) and attaches DexScreener price change. Ranks by volume, fee yield, a volatility hump, and age. |
| `src/rugcheck` | Pass/fail for the non-quote mint. Local checks cover blacklist, freeze authority, holder count, and TVL. Remote checks use RugCheck's free summary endpoint. |
| `src/strategy` | Loads every `strategies/*.json` file. The picker chooses the highest-priority match. |
| `src/executor` | Paper-opens, marks, rebalances, and closes. Enforces size, open-count, and daily-loss caps. Logs simulated PnL. |
| `src/executor/live.ts` | Builds real DLMM transactions with `@meteora-ag/dlmm` only after every live gate passes. |
| `src/tournament` | Classifies pools, replays a 108-cell strategy grid on historical candles, writes a leaderboard, and paper-trades the grid forward. |

The shipped strategies are **placeholders**. The widths and triggers come from Meteora's public strategy guide, not from a private course. Each file says so in `placeholderNote`.

## What the docs say, and what the code does

Primary source: [docs.meteora.ag/get-started](https://docs.meteora.ag/get-started) and the pages linked from it.

| Behavior | Doc |
| --- | --- |
| Bin price `P_i = (1 + binStep / 10_000) ^ i` | [DLMM formulas](https://docs.meteora.ag/core-products/dlmm/formulas) |
| Base fee, variable fee, 10% cap, 90/10 LP/protocol split on standard pools (80/20 on launch pools), host fee | [DLMM formulas](https://docs.meteora.ag/core-products/dlmm/formulas) |
| Spot, Curve, Bid-Ask, Spot-Concentrated (1–3 bins), Spot-Spread (20–30), Spot-Wide (~50), DCA in/out | [Strategies and use cases](https://docs.meteora.ag/core-products/dlmm/strategies-and-use-cases) |
| One active bin; out-of-range liquidity stops earning fees | [What is DLMM?](https://docs.meteora.ag/core-products/dlmm/what-is-dlmm) |
| Default position is 70 bins; dynamic positions extend to 1,400 | [Dynamic positions](https://docs.meteora.ag/core-products/dlmm/dynamic-positions) |
| `InputOnly` vs `OnlyY` fee token | [Collect fee mode](https://docs.meteora.ag/core-products/dlmm/collect-fee-mode) |
| Freeze authority, RugCheck, thin liquidity | [Staying safe](https://docs.meteora.ag/user-guides/staying-safe-on-meteora) |
| `DLMM.create`, `StrategyType`, `initializePositionAndAddLiquidityByStrategy`, `removeLiquidity`, `claimSwapFee` | [SDK getting started](https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/getting-started), [examples](https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/examples), [reference](https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/reference) |
| Pool list API | [DLMM pools](https://docs.meteora.ag/api-reference/dlmm/pools/pools) |
| DAMM v2 is a separate constant-product program | [What is DAMM v2?](https://docs.meteora.ag/core-products/damm-v2/what-is-damm-v2) |

Paper distribution uses the same ladders as `@meteora-ag/dlmm` `toAmountsBothSideByStrategy`:

- **Spot** — equal weight. Token Y sits on `[min, active]`, token X on `[active + 1, max]`.
- **Curve** — weight increases toward the active bin.
- **Bid-Ask** — weight increases toward the outer bins (the inverse of Curve).
- **Single-sided X** — token X from the active bin upward (`singleSidedX` on the live path).
- **Single-sided Y** — token Y from the bottom of the range through the active bin.

When the active bin moves, bins it has crossed convert fully (X becomes Y at that bin's price on the way up, and the reverse on the way down). The active bin itself is left as-is until price moves through it. Fee accrual uses the pool's observed LP fees (`fees` on the DLMM API, which is the LP slice after the protocol share) times our share of TVL, and only while the active bin is inside the range. A move that starts in range and ends outside accrues half the window. This is a simulation: the program uses Q64.64 prices and integer fee math. `tests/sdk-parity.test.ts` checks the bin-price helper against `DLMM.getPriceOfBinByBinId`.

## Setup

Requires Node 20+.

```bash
npm install
cp .env.example .env
npm test
npm run simulate
```

`npm run simulate` forces `MODE=paper`, resets the local paper book, and fast-forwards one hour of fees at the current fee velocity. No wallet and no RPC are required.

Useful commands:

```bash
npm run scan          # rank pools only
npm start             # same pipeline as simulate, keeps the existing paper book
npm run monitor       # mark open paper positions with wall-clock time since the last mark
npm run book          # print the paper book
npx tsx src/index.ts run --include-damm --horizon-hours 1
npx tsx src/index.ts run --strategy bid-ask-volatile
npx tsx src/index.ts run --strategy dca-out-bidask --force-strategy
```

State:

- `data/paper-book.json` — simulated positions (gitignored)
- `logs/pnl.jsonl` — one JSON line per open, mark, rebalance, and close (gitignored)

## Risk limits

Set in `.env`. Defaults:

| Limit | Default | Effect |
| --- | --- | --- |
| `MAX_POSITION_USD` | 250 | Size of each new position |
| `MAX_OPEN_POSITIONS` | 3 | Refuses another open while this many are open |
| `DAILY_LOSS_CAP_USD` | 100 | Today's realized losses plus current unrealized losses. Gains do not offset it |
| `MIN_TVL_USD` | 5000 | Rug check and the open gate |
| `MIN_VOLUME_24H_USD` | 10000 | Open gate |

`RUG_FAIL_SCORE` (default 60) is applied to RugCheck's normalised score, treated as higher-is-riskier. Any danger-level risk, or a risk whose name mentions mint or freeze authority, fails the token. Quote mints (SOL, USDC, USDT, and a few other stables) are not treated as the risk asset, because USDC's freeze authority would otherwise fail every SOL-USDC pool. If RugCheck itself errors, the token fails closed (`RUG_FAIL_CLOSED=true`).

## Strategy tournament

The tournament is paper-only. It does not import the live executor and does not use the 3-position cap. `npm run tournament` writes `reports/leaderboard.md`, `.csv`, and `.json`, and replaces `strategies/winners/*.json` when a bucket clears both the time split and the cross-coin holdout. It creates `data/tournament-forward.json` only when that file is missing, so a rerun does not wipe marked paper positions.

```bash
npm run tournament
npm run tournament-mark
npm run daily
```

`tournament-mark` advances the forward book against live pool prices. `npm run daily` marks that book, opens the 108-cell grid on one new unscanned coin per bucket, reruns the tournament, opens the frozen high-vol strategy on every newly qualifying high-vol pool, and writes `reports/daily/YYYY-MM-DD.md` with the forward PnL, winner changes, dollars versus simply holding the entry tokens, and the frozen book's liquidation PnL.

The promoted high-vol cell is frozen in `strategies/frozen/high-vol-2026-10-09.json`. `loadFrozenStrategy` rejects the file if the parameter hash does not match. Its paper book is `data/frozen-high-vol-forward.json`, separate from the 108-cell book. `npm run high-vol-edge` reprices that cell on the leaderboard's high-vol pools with and without exit costs, and with TVL fee share versus active-bin fee share.

Each bucket targets 18 coins. A second pool is added when the same coin has another bin step, and a third when the bucket has fewer than 15 coins. About 30% of coin keys are a holdout: those coins are replayed on their full history and never used to rank strategies. Older pools use daily Meteora bars over up to 90 days. Younger pools stay on 4-hour or 1-hour bars because the API rejects longer intraday windows.

### Coin types

Classification is exclusive. The first matching rule wins. Features are pool age, the non-quote asset's market cap and holder count, 24h volume / TVL, and absolute 24h price change when DexScreener has one.

| Bucket | Rule |
| --- | --- |
| `stable` | Both symbols are stables (USDC, USDT, USD1, PYUSD, USDS, UXD, USDH, EURC, FDUSD, USDe, USDG). |
| `bluechip` | Paired with a quote asset, and the other leg is a named major (SOL, BTC, ETH, JUP, and liquid staking wrappers) at any age, or has market cap at least $1B after the pool is 72 hours old. |
| `fresh-memecoin` | Pool age under 24 hours. A named major is already bluechip, so a new SOL-USDC pool is not a fresh memecoin. |
| `high-vol-trending` | Age at least 24 hours, and either the absolute 24h move is at least 25% or 24h volume / TVL is at least 8. |
| `established-midcap` | Asset market cap at least $20M and under $1B, pool age at least 7 days, and at least 2,000 holders when the API reports a holder count. |
| `older-memecoin` | Anything that matched none of the above. |

A coin younger than a day stays in `fresh-memecoin` even if the move is already large. A mid-cap with a 25% day is `high-vol-trending`, not `established-midcap`.

### Strategy grid

108 cells: shape (Spot, Curve, Bid-Ask) × width (narrow / medium / wide) × side (two-sided, quote only, token only) × exit.

| Width | Two-sided bins | Single-sided bins |
| --- | --- | --- |
| narrow | 2 below, 2 above | 5 on the chosen side |
| medium | 12 below, 12 above | 20 on the chosen side |
| wide | 30 below, 30 above | 40 on the chosen side |

Quote versus token is resolved per pool. Price is token Y per token X. Y is the quote when Y is a quote asset, when both legs are quotes, or when neither is.

| Exit id | Behaviour |
| --- | --- |
| `oor` | Close on the first out-of-range mark. Stop-loss 12%. |
| `timeout` | Stay out of range for 12 hours before closing. Stop-loss 12%. |
| `rebalance` | Recenter when the active bin leaves the range. Stop-loss 18%. |
| `tp` | Close out of range immediately. Stop-loss 8%, take-profit 15%. |

Bin step is not a cell. The pool creator sets it. The grid does not search it, and winners are not split by bin-step band.

### Backtest and scoring

Older pools use daily Meteora candles over 90 days when that series covers at least 20 days. Pools younger than 20 days use 4-hour candles over 16 days. Pools younger than 36 hours use 1-hour candles over 48 hours. GeckoTerminal is the fallback when Meteora returns fewer than eight bars. Fee math is the same pro-rata estimate as the paper executor.

Ranking uses train coins and the first 70% of their candles. The top five are re-ranked on the last 30% of those same candles. A winner also has to make money on the held-out coins, which are replayed on their full history and never appear in the ranking. The time-split sample needs at least eight train trials and five test trials, and the holdout needs at least four trials, each with a positive median and a positive mean. Otherwise that bucket keeps the hand-written placeholder.

## Adding a strategy

Strategies are data. The loader reads every `strategies/*.json` file.

1. Copy `strategies/spot-spread.json` to `strategies/my-rule.json`.
2. Set a new lowercase `id`. Keep `placeholder: true` until you have reviewed the numbers. The note should say these are not production parameters.
3. Set `shape` to `Spot`, `Curve`, or `BidAsk` and choose `binsBelow` / `binsAbove`. The total width is `binsBelow + binsAbove + 1`. The program allows at most 1,400 bins; widths above 70 need a dynamic position.
4. Set `sidedness` to `two-sided`, `single-sided-x`, or `single-sided-y`.
5. `requires` is a set of conditions that must all pass. `when` is optional: if it is non-empty, at least one clause must also pass. Leave `when` empty for a fallback rule. Set `manualOnly: true` if the rule should run only when requested with `--strategy <id>`.
6. `priority` breaks ties. Higher wins.
7. `exit.onOutOfRange` is `close` or `rebalance`. `stopLossPct` is a fraction (`0.08` = 8%).
8. `docs` must include at least one `https://docs.meteora.ag/` URL. Cite the page the rule came from.
9. Run `npm test`. The new file is picked up with no code change.

Force a file that does not match its own entry rules with:

```bash
npx tsx src/index.ts run --strategy my-rule --force-strategy
```

`--force-strategy` does not bypass the rug check or the risk limits.

## Live mode

Live mode is off unless all three are set:

1. `MODE=live`
2. `WALLET_PRIVATE_KEY` (base58 secret key, or a JSON array of bytes)
3. CLI flag `--confirm-live`

`npm run simulate` sets `MODE=paper` and never passes `--confirm-live`. Do not commit a key. `.env` is gitignored; `.env.example` has an empty key.

When those gates pass, `openLivePosition` loads `@meteora-ag/dlmm` (via the package's CommonJS entry; the ESM build currently trips a directory import in Node 22), reads the on-chain active bin, and sends `initializePositionAndAddLiquidityByStrategy` with `StrategyType.Spot`, `Curve`, or `BidAsk`. Closes use `removeLiquidity` at 100% with `shouldClaimAndClose: true`. Fee claims use `claimSwapFee`. The paper monitor does not send transactions. A live rebalance in this build is close-and-reopen; the program also exposes a single `rebalancePosition` instruction, documented in the [SDK reference](https://docs.meteora.ag/developer-guides/dlmm/typescript-sdk/reference).

## Tests

```bash
npm test
npm run typecheck
```

Unit tests cover bin prices, the fee formulas, distribution shapes, ranking, rug decisions, the strategy picker, paper marks (fee accrual, conversion, out-of-range, rebalance, stop-loss), risk caps, the live gate, SDK bin-price parity, a full paper pipeline with a fake scanner, the coin classifier, the 108-cell grid, synthetic replays, and the train/test promotion guards. `npm run simulate` is the live-data run of the small paper book. `npm run tournament` is the live-data backtest.

## Limits of this foundation

- Paper fees are a TVL pro-rata share of the pool's recent LP fees. They do not reproduce per-bin concentration, so a tight range does not earn more per dollar than a wide one while both are in range. It does go out of range sooner.
- Price-to-bin uses floating point. The program uses Q64.64. The parity test keeps that gap under 1e-8 relative.
- Birdeye is optional and unused without `BIRDEYE_API_KEY`. DexScreener is the free price-change source.
- DAMM v2 pools can be printed with `--include-damm`. There is no DAMM position executor and no `@meteora-ag/cp-amm-sdk` dependency yet.
- Nothing here is a recommendation to provide liquidity. Meteora's own guide says these shapes do not remove impermanent loss.

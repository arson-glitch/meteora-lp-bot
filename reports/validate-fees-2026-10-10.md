# Fee model check

Paper only. Database `/workspace/data/recorder/recorder.sqlite`. Hypothetical deposit $250, two-sided Spot, 10 bins each side. A swap is scored when a snapshot of the same pool is at most 30 minutes older.

Pools in the overlap: 0. Snapshots: 0. Swaps: 0. Swaps with a snapshot and positive LP fee: 0.

Median snapshot active-bin share of TVL: n/a. Even-spread model share: n/a.

Mean absolute error versus snapshot-weighted fees: active-bin n/a, crossed-bin n/a.

Database not found at /workspace/data/recorder/recorder.sqlite. No overlapping swap and snapshot, so neither model was scored.

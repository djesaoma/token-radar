![token-radar-01](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/djesaoma/token-radar/rank.svg)
![reward](https://make.fun/badge/token-radar-01/djesaoma/token-radar/reward.svg)

# token-radar

Build the best token launch radar. A Node 22 program that reads a sealed DefiLlama snapshot of 758 protocols, ranks the 40 pre-token protocols on the watchlist (plus 186 more rankable pre-token protocols, 226 rows total) by an implied value fitted on the snapshot's own live-token protocols, and ships a static web dashboard with a farm plan per protocol.

[Bounty page](https://make.fun/bounty/token-radar-01)

## How it works

- **Value model (peer-calibrated, fitted on the snapshot):** for each category, the median `mcap_usd / tvl_usd` among live-token protocols in that category (min 4 peers; fewer peers shrink toward the global median 0.205). Implied value = TVL × category multiple × growth factor (from 7-day change) × maturity factor (hump-shaped by age since listing). Per-peer ratios are winsorized at 5.0× so one outlier cannot dominate. No hardcoded protocol names anywhere — every parameter is computed from the sealed snapshot at run time.
- **Holdout validation:** the 129 live-token comps are split 80/20 by a deterministic slug hash; the model is fitted on the 80% and predicts the 20%. Reported in the dashboard model panel (median absolute % error, share within 2×).
- **Farm plans:** 6 steps per protocol, each stating cost and time, with category-specific actions and per-chain gas costs. A protocol "records no token" — the plan never promises an airdrop.
- **Dashboard:** sortable, filterable board (search, category filter, chain filter, pre-token / live-token tabs), per-protocol detail drawer with the implied-value breakdown, model panel with the fitted multiples and holdout metrics. No network anywhere; all data comes from `data.js`.

## Run it

Requires Node ≥ 22.18. The program reads the sealed snapshot and writes everything to the output directory (default `/output`).

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

Outputs: `board.json` (226 rows), `data.js` (dashboard dataset), `dashboard/` (static page), `screenshots/` (3 real captures), `dossier.json` (built last via `vendor/makefun-board.ts`).

Run it twice into two empty directories and the outputs are byte-identical (no clock, no randomness, no network).

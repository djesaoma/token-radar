![token-radar-01](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/djesaoma/token-radar/rank.svg)
![reward](https://make.fun/badge/token-radar-01/djesaoma/token-radar/reward.svg)

# token-radar

Build the best token launch radar. A Node 22 program that reads a sealed DefiLlama snapshot of 758 protocols, ranks the 40 pre-token protocols on the watchlist (plus 186 more rankable pre-token protocols, 226 rows total) by an implied value fitted on the snapshot's own live-token protocols, and ships a static web dashboard with a farm plan per protocol.

[Bounty page](https://make.fun/bounty/token-radar-01)

## How it works

- **Value model:** fits log-market-cap against log-TVL, then shrinks category residuals toward the global fit. A deterministic development-only search compares 216 generic estimator/shrinkage/growth/age/breadth configurations. The snapshot selects log OLS, 16 prior peers, a mild quarter-power age curve, and neutral growth/breadth factors. Every fitted coefficient and displayed metric is calculated at run time; no protocol-specific overrides or external data.
- **Validation:** preserves the original 26-peer holdout membership before removing nonpositive market-cap sentinels. Hyperparameters are selected on five slug-hash folds of the other 102 valid peers. Also reports nested five-fold and leave-one-category-out results, reselecting solely on each training partition, and a full ablation audit in `data.js` and the model panel. The same prediction function is used for validation and ranking. This historical holdout is not a fresh external dataset; broader validation remains noisy. See [VALIDATION.md](VALIDATION.md).
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

## Reproduce validation

```sh
node tests/validate.ts /absolute/path/to/input/snapshot.json
```

This runs the entry twice from the OS temporary directory using both output options, compares every output byte, checks the board and dossier, smoke-tests the dashboard data binding, and perturbs only holdout market caps to check selection isolation. No submission is made.

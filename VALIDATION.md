# Valuation validation audit

Reproduce with `node tests/validate.ts /absolute/path/to/input/snapshot.json`. Metrics below were generated from the sealed snapshot during this revision; the dashboard independently reads its runtime `data.js` values.

## Design

- Preserve the legacy hash-sorted, every-fifth-row holdout membership before filtering invalid prices. Exactly the same 26 positive-market-cap protocols are tested.
- Exclude nonpositive market caps from log fits by numeric rule. The former 129-comp pool includes one negative sentinel, leaving 128 valid peers and 102 development rows.
- Select among 216 generic candidates solely on development five-fold mean absolute log error: FNV-1a(slug) modulo 5. This loss treats over- and under-prediction symmetrically; it does not reward tiny estimates just for improving percentage error.
- Candidate grid: raw-ratio median, log median, geometric mean, log OLS; 0/4/16 prior peers; growth off/linear/exponential; age off/old hump/quarter-power; chain breadth off/on. Fixed 365-day missing age, -50/+100 growth clip, 0.5 growth weight and quarter-power curve are declared generic constants. Coefficients and category locations are fitted from training data only.
- Nested five-fold and leave-one-category-out reselect hyperparameters independently on each outer training partition. Category-out falls back to the global size fit for unseen categories. Results below pool predictions at protocol level, rather than averaging category medians.
- Original holdout has prior project exposure and all ablations are exploratory. It is not a new external test. Broad validation remains weak, so these are ranking signals, not reliable price forecasts.

## Measured results

| Evaluation | Median absolute percentage error | Within 2× | Mean absolute log error |
|---|---:|---:|---:|
| Original reported holdout (n=26) | 94.03% | 26.92% | 1.578 |
| Original full scoring formula (n=26) | 95.14% | 26.92% | 1.552 |
| Revised holdout (same n=26) | 71.62% | 42.31% | 1.274 |
| Development CV (selection score; n=102) | 86.97% | 27.45% | 1.680 |
| Nested five-fold (n=128) | 86.41% | 28.12% | 1.610 |
| Nested leave-one-category-out (n=128) | 86.34% | 31.25% | 1.627 |

## Selected fit

`{"breadth": false, "estimator": "log-ols", "growth": "off", "maturity": "power", "shrink": 16}`

All-peer TVL exponent: **0.526033**; TVL pivot: **$49,104,944.16**. Category multiples apply at this pivot; each row stores its effective category/size multiple so the detail breakdown multiplies back to exactly the emitted value.

Age factor: `((age_days + 365) / 730)^0.25`; growth and breadth factors are 1. The OLS/category fit first removes enabled factors from its training target, then reapplies precisely the same factors for every validation and board prediction.

## One-component ablation

Only one selected component changes in each row. The first score determines selection; the same historical holdout is reported after selection, not used to choose a winner. Stronger holdout-only alternatives are deliberately not cherry-picked.

| Configuration | Development mean absolute log error | Holdout median error | Holdout within 2× |
|---|---:|---:|---:|
| Selected | 1.680 | 71.62% | 42.31% |
| breadth=True | 1.682 | 77.58% | 38.46% |
| maturity=off | 1.684 | 76.92% | 42.31% |
| growth=exponential | 1.684 | 72.21% | 38.46% |
| growth=linear | 1.685 | 72.34% | 38.46% |
| maturity=hump | 1.698 | 80.53% | 42.31% |
| shrink=4 | 1.701 | 74.05% | 46.15% |
| estimator=geometric | 1.873 | 82.14% | 34.62% |
| estimator=log-median | 1.876 | 83.62% | 26.92% |
| shrink=0 | 1.881 | 70.84% | 42.31% |
| estimator=median | 1.895 | 83.34% | 26.92% |

## Verification and capture status

- First implementation was run twice from `/tmp` into empty directories, and `diff -r` was clean; all 226-row board constraints passed. A later revision expanded the grid from 84 isolated-factor candidates to the full 216 combinations, without changing the selected model.
- Revised verification: `tests/validate.ts` exited 0. Both child runs used `/tmp` as their working directory, one with `--output`, one with `MAKEFUN_OUTPUT_DIR`; all 9 output files matched byte for byte. `diff -r /tmp/token-radar-verify-v1wEov/one /tmp/token-radar-verify-v1wEov/two` was clean. Board constraints, dossier reconstruction and runtime model-panel data binding passed. Multiplying only the 26 held-out market caps by 17 left the selected configuration and development CV metrics unchanged.
- Available execution runtime: Node v24.22.1. No Node 22 binary was available; source uses the existing erasable TypeScript / Node standard-library approach.
- **Screenshots are still the previous captures and must be recaptured before any future submission.** Dashboard changes: `dashboard/app.js` and `dashboard/index.html`; no CSS changes. Both installed Chromium builds fail under the current sandbox with `Operation not permitted`, including with the packaged browser configured with an empty WebGL domain allowlist. No screenshots were fabricated or overwritten.
- No commit, push, submission or transcript-bundle modification was performed.

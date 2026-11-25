/* Snapshot-fitted log/ratio estimators are selected using development-only CV.
   Holdout, nested hash folds, category-out tests and board share one prediction path. */
export type Protocol = {
  slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number;
  change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null;
};
export type Snapshot = { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] };
export type Metrics = {
  count: number; median_absolute_pct_error: number; within_2x_share: number;
  mean_absolute_log_error: number; median_error_factor: number;
};
type Config = {
  estimator: 'median' | 'log-median' | 'geometric' | 'log-ols'; shrink: number;
  growth: 'off' | 'linear' | 'exponential'; maturity: 'off' | 'hump' | 'power'; breadth: boolean;
};
type FittedModel = {
  config: Config; tvl_pivot_usd: number; tvl_exponent: number;
  global_multiple: number; global_peer_count: number; shrink_peers: number; min_category_peers: number;
  growth_floor: number; growth_cap: number; growth_weight: number; unknown_age_days: number;
  maturity_peak_days: number; maturity_old_days: number; maturity_floor: number; maturity_peak: number;
  maturity_old: number; chain_step: number; chain_cap: number;
  category_multiples: Record<string, { multiple: number; peers: number; raw_median: number }>;
};
export type Model = FittedModel & {
  version: string; formula: string; validation_note: string; holdout: Metrics;
  validation: {
    selection_rule: string; candidate_count: number; development_count: number; excluded_nonpositive_count: number;
    legacy_holdout: Metrics; legacy_full_formula: Metrics; development_cv: Metrics;
    k_fold: Metrics; leave_one_category_out: Metrics;
    folds: Metrics[]; category_tests: { category: string; metrics: Metrics }[];
    ablation: { config: Config; development_cv: Metrics; holdout: Metrics }[];
  };
};
export type BoardRow = Protocol & {
  rank: number; age_days: number | null; implied_value_usd: number; category_multiple: number;
  growth_multiplier: number; maturity_multiplier: number; chain_breadth_multiplier: number; farm_steps: string[];
};

const own = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';

export function parseSnapshot(value: unknown): Snapshot {
  if (!own(value) || !Array.isArray(value.protocols) || !Array.isArray(value.watchlist) || typeof value.as_of !== 'string' || typeof value.source !== 'string' || typeof value.floor_usd !== 'number') throw new Error('snapshot: invalid top-level structure');
  const fields = ['slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'mcap_usd', 'listed_at', 'gecko_id', 'symbol'];
  const protocols = value.protocols.map((raw, i): Protocol => {
    if (!own(raw) || Object.keys(raw).sort().join('|') !== fields.slice().sort().join('|')) throw new Error(`snapshot: protocol ${i} must contain exactly ten fields`);
    const p = raw as Record<string, unknown>;
    if (typeof p.slug !== 'string' || !p.slug || typeof p.name !== 'string' || !p.name || !(p.category === null || typeof p.category === 'string') || !Array.isArray(p.chains) || !p.chains.every(c => typeof c === 'string') || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd) || p.tvl_usd <= 0 || !(p.change_7d === null || typeof p.change_7d === 'number' && Number.isFinite(p.change_7d)) || !(p.mcap_usd === null || typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd)) || !isNullableString(p.listed_at) || !isNullableString(p.gecko_id) || !isNullableString(p.symbol)) throw new Error(`snapshot: malformed protocol ${i}`);
    return p as unknown as Protocol;
  });
  const seen = new Set<string>();
  for (const p of protocols) { if (seen.has(p.slug)) throw new Error(`snapshot: duplicate slug ${p.slug}`); seen.add(p.slug); }
  const watchlist = value.watchlist as unknown[];
  if (!watchlist.every(s => typeof s === 'string' && seen.has(s))) throw new Error('snapshot: watchlist contains an unknown slug');
  return { as_of: value.as_of, source: value.source, floor_usd: value.floor_usd, protocols, watchlist: watchlist as string[] };
}

const median = (values: number[]): number => {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const hashSlug = (slug: string): number => {
  let h = 2166136261;
  for (let i = 0; i < slug.length; i++) h = Math.imul(h ^ slug.charCodeAt(i), 16777619) >>> 0;
  return h;
};
// Positive market cap is necessary for a meaningful logarithm. Zero and negative
// sentinels are excluded by value, never by protocol identity.
const livePeers = (protocols: Protocol[]): Protocol[] => protocols.filter(p => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
const categoryKey = (p: Protocol): string => p.category || 'Uncategorized';
const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  return Math.max(0, Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`)) / 86400000));
}
export function maturityFactor(age: number | null, model: FittedModel): number {
  const days = age === null ? model.unknown_age_days : age;
  if (model.config.maturity === 'off') return 1;
  // A generic quarter-power age curve is a mild alternative to the old hump.
  if (model.config.maturity === 'power') return Math.pow((days + 365) / 730, 0.25);
  if (days <= model.maturity_peak_days) return model.maturity_floor + (model.maturity_peak - model.maturity_floor) * days / model.maturity_peak_days;
  const progress = Math.min(1, (days - model.maturity_peak_days) / (model.maturity_old_days - model.maturity_peak_days));
  return model.maturity_peak + (model.maturity_old - model.maturity_peak) * progress;
}
export function growthFactor(change: number | null, model: FittedModel): number {
  const bounded = Math.max(model.growth_floor, Math.min(model.growth_cap, change ?? 0));
  if (model.config.growth === 'off') return 1;
  const effect = bounded / 100 * model.growth_weight;
  return model.config.growth === 'exponential' ? Math.exp(effect) : 1 + effect;
}
export function chainFactor(chains: string[], model: FittedModel): number {
  return Math.min(model.chain_cap, 1 + Math.max(0, chains.length - 1) * model.chain_step);
}
function factors(p: Protocol, asOf: string, model: FittedModel): number {
  return growthFactor(p.change_7d, model) * maturityFactor(ageDays(p.listed_at, asOf), model) * chainFactor(p.chains, model);
}
function effectiveMultiple(p: Protocol, model: FittedModel): number {
  const base = model.category_multiples[categoryKey(p)]?.multiple ?? model.global_multiple;
  return base * Math.pow(p.tvl_usd / model.tvl_pivot_usd, model.tvl_exponent - 1);
}
export function impliedValue(p: Protocol, age: number | null, multiple: number, model: FittedModel): number {
  return Math.max(1, Math.round(p.tvl_usd * multiple * growthFactor(p.change_7d, model) * maturityFactor(age, model) * chainFactor(p.chains, model)));
}
function predict(p: Protocol, asOf: string, model: FittedModel): number {
  return impliedValue(p, ageDays(p.listed_at, asOf), effectiveMultiple(p, model), model);
}

function fitModel(peers: Protocol[], asOf: string, config: Config): FittedModel {
  if (!peers.length) throw new Error('model: no positive-market-cap training peers');
  const model: FittedModel = {
    config, tvl_pivot_usd: 1, tvl_exponent: 1, global_multiple: 1,
    global_peer_count: peers.length, shrink_peers: config.shrink, min_category_peers: 0,
    growth_floor: -50, growth_cap: 100, growth_weight: config.growth === 'off' ? 0 : 0.5,
    unknown_age_days: 365, maturity_peak_days: 730, maturity_old_days: 1460,
    maturity_floor: 0.6, maturity_peak: 1, maturity_old: 0.85,
    chain_step: config.breadth ? 0.025 : 0, chain_cap: config.breadth ? 1.1 : 1,
    category_multiples: {}
  };
  const x = peers.map(p => Math.log(p.tvl_usd));
  // Remove enabled factors before fitting: validation and board use precisely the same formula.
  const y = peers.map(p => Math.log(p.mcap_usd!) - Math.log(factors(p, asOf, model)));
  const mx = mean(x), my = mean(y);
  model.tvl_pivot_usd = Math.exp(mx);
  if (config.estimator === 'log-ols') {
    const variance = x.reduce((sum, v) => sum + (v - mx) ** 2, 0);
    model.tvl_exponent = variance > 0 ? x.reduce((sum, v, i) => sum + (v - mx) * (y[i] - my), 0) / variance : 1;
  }
  const residuals = y.map((v, i) => v - x[i] - (model.tvl_exponent - 1) * (x[i] - mx));
  const center = (logs: number[]): number => config.estimator === 'median' ? Math.log(median(logs.map(Math.exp)))
    : config.estimator === 'log-median' ? median(logs) : mean(logs);
  const globalLog = center(residuals);
  model.global_multiple = Math.exp(globalLog);
  const categories = new Map<string, number[]>();
  peers.forEach((p, i) => { const key = categoryKey(p); const group = categories.get(key) || []; group.push(residuals[i]); categories.set(key, group); });
  for (const key of [...categories.keys()].sort()) {
    const values = categories.get(key)!; const n = values.length; const raw = center(values);
    const multiple = config.estimator === 'median'
      ? (n * Math.exp(raw) + config.shrink * model.global_multiple) / (n + config.shrink)
      : Math.exp((n * raw + config.shrink * globalLog) / (n + config.shrink));
    model.category_multiples[key] = { multiple, peers: n, raw_median: Math.exp(median(values)) };
  }
  return model;
}

type Prediction = { actual: number; predicted: number };
function summarize(pairs: Prediction[]): Metrics {
  if (!pairs.length) return { count: 0, median_absolute_pct_error: 0, within_2x_share: 0, mean_absolute_log_error: 0, median_error_factor: 1 };
  const ratios = pairs.map(p => p.predicted / p.actual);
  const logs = ratios.map(r => Math.abs(Math.log(r)));
  return { count: pairs.length, median_absolute_pct_error: median(ratios.map(r => Math.abs(r - 1) * 100)),
    within_2x_share: ratios.filter(r => r >= 0.5 && r <= 2).length / pairs.length,
    mean_absolute_log_error: mean(logs), median_error_factor: Math.exp(median(logs)) };
}
function evaluate(training: Protocol[], testing: Protocol[], asOf: string, config: Config): Prediction[] {
  const model = fitModel(training, asOf, config);
  return testing.map(p => ({ actual: p.mcap_usd!, predicted: predict(p, asOf, model) }));
}
// Declared generic grid: 4 estimators, 0/4/16 prior peers, three growth
// shapes, three age shapes and breadth on/off. The full factorial also tests
// each factor with and without the selected alternatives of the other factors.
function candidates(): Config[] {
  const result: Config[] = [];
  for (const estimator of ['median', 'log-median', 'geometric', 'log-ols'] as const) {
    for (const shrink of [0, 4, 16]) {
      for (const growth of ['off', 'linear', 'exponential'] as const) {
        for (const maturity of ['off', 'hump', 'power'] as const) {
          for (const breadth of [false, true]) result.push({ estimator, shrink, growth, maturity, breadth });
        }
      }
    }
  }
  return result;
}
function crossValidate(peers: Protocol[], asOf: string, config: Config): Metrics {
  const pairs: Prediction[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const testing = peers.filter(p => hashSlug(p.slug) % 5 === fold);
    if (testing.length) pairs.push(...evaluate(peers.filter(p => hashSlug(p.slug) % 5 !== fold), testing, asOf, config));
  }
  return summarize(pairs);
}
function selectConfig(peers: Protocol[], asOf: string): { config: Config; development_cv: Metrics }[] {
  return candidates().map(config => ({ config, development_cv: crossValidate(peers, asOf, config) }))
    .sort((a, b) => a.development_cv.mean_absolute_log_error - b.development_cv.mean_absolute_log_error || JSON.stringify(a.config).localeCompare(JSON.stringify(b.config)));
}
// Reproduce the exact old split BEFORE removing invalid price sentinels, so
// cleaning the data cannot silently move protocols between training and test.
function legacySplit(protocols: Protocol[]): { training: Protocol[]; testing: Protocol[] } {
  const sorted = protocols.filter(p => p.mcap_usd !== null && p.mcap_usd !== 0 && p.tvl_usd > 0)
    .sort((a, b) => hashSlug(a.slug) - hashSlug(b.slug) || a.slug.localeCompare(b.slug));
  return { training: sorted.filter((_, i) => i % 5 !== 0), testing: sorted.filter((_, i) => i % 5 === 0) };
}
function legacyPredictions(training: Protocol[], testing: Protocol[], asOf: string, fullFormula: boolean): Prediction[] {
  const ratio = (p: Protocol): number => Math.min(5, p.mcap_usd! / p.tvl_usd);
  const global = median(training.map(ratio));
  return testing.filter(p => p.mcap_usd! > 0).map(p => {
    const group = training.filter(q => categoryKey(q) === categoryKey(p));
    const raw = group.length ? median(group.map(ratio)) : global;
    const multiple = group.length >= 4 ? raw : (group.length * raw + 4 * global) / (group.length + 4);
    const age = ageDays(p.listed_at, asOf) ?? 365;
    const maturity = age <= 730 ? 0.6 + 0.4 * age / 730 : 1 - 0.15 * Math.min(1, (age - 730) / 730);
    const extra = fullFormula ? (1 + Math.max(-50, Math.min(100, p.change_7d ?? 0)) * 0.005) * maturity * Math.min(1.1, 1 + Math.max(0, p.chains.length - 1) * 0.025) : 1;
    return { actual: p.mcap_usd!, predicted: p.tvl_usd * multiple * extra };
  });
}
function validate(protocols: Protocol[], asOf: string): { config: Config; holdout: Metrics; validation: Model['validation'] } {
  const split = legacySplit(protocols);
  const development = livePeers(split.training), testing = livePeers(split.testing);
  const ranked = selectConfig(development, asOf); const selected = ranked[0];
  // Outer folds reselect using only their training data. These are nested CV,
  // not optimistic scores for a winner picked using the same outer test rows.
  const peers = livePeers(protocols); const pairs: Prediction[] = []; const folds: Metrics[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const training = peers.filter(p => hashSlug(p.slug) % 5 !== fold);
    const test = peers.filter(p => hashSlug(p.slug) % 5 === fold);
    if (!test.length) { folds.push(summarize([])); continue; }
    const predictions = evaluate(training, test, asOf, selectConfig(training, asOf)[0].config);
    pairs.push(...predictions); folds.push(summarize(predictions));
  }
  const loco: Prediction[] = []; const categoryTests: Model['validation']['category_tests'] = [];
  for (const category of [...new Set(peers.map(categoryKey))].sort()) {
    const training = peers.filter(p => categoryKey(p) !== category);
    const test = peers.filter(p => categoryKey(p) === category);
    const predictions = evaluate(training, test, asOf, selectConfig(training, asOf)[0].config);
    loco.push(...predictions); categoryTests.push({ category, metrics: summarize(predictions) });
  }
  const ablation = ranked.filter(r => r.config.estimator === selected.config.estimator ||
    r.config.shrink === selected.config.shrink && r.config.growth === selected.config.growth && r.config.maturity === selected.config.maturity && r.config.breadth === selected.config.breadth)
    .map(r => ({ ...r, holdout: summarize(evaluate(development, testing, asOf, r.config)) }));
  return { config: selected.config, holdout: summarize(evaluate(development, testing, asOf, selected.config)), validation: {
    selection_rule: 'Minimize mean absolute log error on five development folds (FNV-1a(slug) % 5); the legacy 26-row holdout is excluded from selection. Outer CV and category-out each reselect on training only.',
    candidate_count: ranked.length, development_count: development.length,
    excluded_nonpositive_count: split.training.length + split.testing.length - peers.length,
    legacy_holdout: summarize(legacyPredictions(split.training, split.testing, asOf, false)),
    legacy_full_formula: summarize(legacyPredictions(split.training, split.testing, asOf, true)),
    development_cv: selected.development_cv, k_fold: summarize(pairs), leave_one_category_out: summarize(loco),
    folds, category_tests: categoryTests, ablation
  } };
}
export function holdoutMetrics(protocols: Protocol[], asOf: string): Metrics {
  const split = legacySplit(protocols); const training = livePeers(split.training);
  return summarize(evaluate(training, livePeers(split.testing), asOf, selectConfig(training, asOf)[0].config));
}

function gasRange(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return '$3–15';
  if (c.includes('solana')) return '$0.01–0.05';
  if (['arbitrum', 'base', 'monad'].includes(c)) return '$0.10–1';
  if (c.includes('binance')) return '$0.10–0.50';
  return '$0.10–2';
}
function capitalFor(tvl: number): number { return tvl >= 5e9 ? 250 : tvl >= 1e9 ? 150 : tvl >= 1e8 ? 100 : 50; }
function holdFor(age: number | null): number { return age !== null && age < 180 ? 60 : age !== null && age < 365 ? 45 : 30; }
function categoryAction(p: Protocol, capital: number, chain: string): string {
  const category = (p.category || '').toLowerCase();
  if (category.includes('curator') || category.includes('allocator')) return `Deposit $${capital} into a vault on ${p.name} via ${chain}; keep the receipt shares.`;
  if (category.includes('rwa')) return `Mint or acquire $${capital} of the yield asset on ${p.name} via ${chain}; hold it.`;
  if (category.includes('lend') || category.includes('cdp')) return `Supply $${capital} USDC on ${p.name} via ${chain}; keep the position open.`;
  if (category.includes('dex')) return `Add $${capital} liquidity to a main pool on ${p.name} via ${chain}, then make one small swap.`;
  if (category.includes('yield')) return `Deposit $${capital} into a vault on ${p.name} via ${chain}; retain the vault shares.`;
  if (category.includes('basis')) return `Deposit $${capital} margin on ${p.name} via ${chain} and open one small hedged position.`;
  if (category.includes('bridge')) return `Bridge $${capital} USDC through ${p.name} to ${chain}, then use it in the app.`;
  if (category.includes('chain')) return `Bridge $${capital} USDC to ${chain} and make one application transaction.`;
  if (category.includes('restak')) return `Restake a supported receipt worth $${capital} through ${p.name} on ${chain}.`;
  if (category.includes('prediction')) return `Fund $${capital} on ${p.name} via ${chain} and place one small market position.`;
  return `Deposit $${capital} USDC into ${p.name} via ${chain} and keep the position open.`;
}
export function farmSteps(p: Protocol, age: number | null): string[] {
  const chain = p.chains[0] || 'the primary chain';
  const gas = gasRange(chain); const capital = capitalFor(p.tvl_usd); const hold = holdFor(age);
  const actions = [
    [`Create a fresh wallet for ${p.name}; record its address and keep the seed phrase offline.`, 'Gas: $0; time: 5 minutes.'],
    [categoryAction(p, capital, chain), `Capital: $${capital}; estimated gas ${gas} for setup; time: 15 minutes.`],
    [`Once each week, repeat a qualifying ${p.category || 'protocol'} action on ${p.name} and save the transaction link.`, `Gas: ${gas} per action; time: 10 minutes weekly.`],
    [`Keep the position active for ${hold} days; review exposure weekly and exit if its risk changes.`, `Capital: $${capital} remains exposed; time: ${hold} days.`],
    [`Check ${p.name}'s own published rewards page; claim only through a link published there.`, 'Cost: no claim fee should be prepaid; time: 10 minutes.'],
    [`Log wallet, dates, amounts and transaction references for every ${p.name} interaction before unwinding.`, 'Cost: $0; time: 5 minutes.']
  ];
  return actions.map(([action, cost]) => `${action} ${cost}`);
}

function isExcluded(p: Protocol): boolean {
  return (p.category || '').toLowerCase() === 'cex' || /\s(?:v\d+(?:\.\d+)?|\d+\.\d+)$/i.test(p.name);
}
export function liveRows(snapshot: Snapshot): Protocol[] {
  return livePeers(snapshot.protocols).slice().sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || a.slug.localeCompare(b.slug)).slice(0, 24);
}
export function buildBoard(snapshot: Snapshot): { rows: BoardRow[]; model: Model; live: Protocol[] } {
  const checked = validate(snapshot.protocols, snapshot.as_of);
  const model: Model = { ...fitModel(livePeers(snapshot.protocols), snapshot.as_of, checked.config),
    version: 'nested-log-comps-2.1', formula: '', validation_note: '', holdout: checked.holdout, validation: checked.validation };
  model.formula = `round(TVL × category_multiple_at_pivot × (TVL / $${Math.round(model.tvl_pivot_usd)})^(${model.tvl_exponent.toFixed(4)} − 1) × growth × maturity × breadth)`;
  model.validation_note = `Category multiples are fitted at the geometric-mean training TVL pivot. Row multiples include the TVL size adjustment. Estimator: ${model.config.estimator}; shrinkage: ${model.shrink_peers} prior peers; growth: ${model.config.growth}; maturity: ${model.config.maturity}; chain breadth: ${model.config.breadth ? 'on' : 'off'}. Positive mcap only; no ratio cap in the new fit. All metrics are computed from this snapshot. Ranking signal, not a price forecast.`;
  const watch = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter(p => p.gecko_id === null && p.symbol === null && !isExcluded(p) && (watch.has(p.slug) || p.tvl_usd < snapshot.floor_usd));
  const scored = candidates.map(p => {
    const age = ageDays(p.listed_at, snapshot.as_of);
    const multiple = effectiveMultiple(p, model);
    return { ...p, age_days: age, category_multiple: multiple, growth_multiplier: growthFactor(p.change_7d, model), maturity_multiplier: maturityFactor(age, model), chain_breadth_multiplier: chainFactor(p.chains, model), implied_value_usd: impliedValue(p, age, multiple, model), rank: 0, farm_steps: farmSteps(p, age) };
  }).sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  const rows = scored.map((row, i) => ({ ...row, rank: i + 1 }));
  return { rows, model, live: liveRows(snapshot) };
}
export function boardIssue(snapshot: Snapshot, rows: BoardRow[]): string | null {
  if (rows.length !== 226) return `expected 226 rows; got ${rows.length}`;
  const seen = new Set(rows.map(r => r.slug));
  const missing = snapshot.watchlist.filter(s => !seen.has(s));
  if (missing.length) return `missing watchlist slugs: ${missing.join(', ')}`;
  if (rows.some((r, i) => r.rank !== i + 1)) return 'ranks are not contiguous';
  if (rows.some((r, i) => i > 0 && rows[i - 1].implied_value_usd < r.implied_value_usd)) return 'implied values rise with rank';
  if (new Set(rows.map(r => r.implied_value_usd)).size < 2) return 'all implied values are equal';
  if (rows.some(r => r.farm_steps.length !== 6 || r.farm_steps.some(s => s.trim().length < 20 || s.trim().length > 600))) return 'farm step length check failed';
  return null;
}

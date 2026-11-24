/* Snapshot-fitted peer multiples use live-token mcap/TVL medians; holdout error and all row values
   are computed at run time from the sealed snapshot, with no protocol-name overrides. */
export type Protocol = {
  slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number;
  change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null;
};
export type Snapshot = { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] };
export type Model = {
  global_multiple: number; global_peer_count: number; shrink_peers: number; min_category_peers: number;
  growth_floor: number; growth_cap: number; growth_weight: number; unknown_age_days: number;
  maturity_peak_days: number; maturity_old_days: number; maturity_floor: number; maturity_peak: number;
  maturity_old: number; chain_step: number; chain_cap: number; category_multiples: Record<string, { multiple: number; peers: number; raw_median: number }>;
  holdout: { count: number; median_absolute_pct_error: number; within_2x_share: number };
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
const livePeers = (protocols: Protocol[]): Protocol[] => protocols.filter(p => p.mcap_usd !== null && p.mcap_usd !== 0 && p.tvl_usd > 0);
// Cap each peer at 5.0x TVL so one extreme market cap cannot dominate its category fit.
const peerRatio = (p: Protocol): number => Math.min(5.0, (p.mcap_usd as number) / p.tvl_usd);

function fitMultiples(peers: Protocol[], global: number): Model['category_multiples'] {
  const categories = new Map<string, number[]>();
  for (const p of peers) {
    const key = p.category || 'Uncategorized';
    const values = categories.get(key) || [];
    values.push(peerRatio(p));
    categories.set(key, values);
  }
  const result: Model['category_multiples'] = {};
  for (const key of Array.from(categories.keys()).sort()) {
    const values = categories.get(key)!;
    const raw = median(values);
    const multiple = values.length >= 4 ? raw : (values.length * raw + 4 * global) / (values.length + 4);
    result[key] = { multiple, peers: values.length, raw_median: raw };
  }
  return result;
}

function fitModel(protocols: Protocol[], holdout: Model['holdout']): Model {
  const peers = livePeers(protocols);
  const global = median(peers.map(peerRatio));
  const categories = fitMultiples(peers, global);
  return {
    global_multiple: global, global_peer_count: peers.length, shrink_peers: 4, min_category_peers: 4,
    growth_floor: -50, growth_cap: 100, growth_weight: 0.5, unknown_age_days: 365,
    maturity_peak_days: 730, maturity_old_days: 1460, maturity_floor: 0.6, maturity_peak: 1,
    maturity_old: 0.85, chain_step: 0.025, chain_cap: 1.1, category_multiples: categories, holdout
  };
}

export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  return Math.max(0, Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`)) / 86400000));
}
export function maturityFactor(age: number | null, model: Pick<Model, 'unknown_age_days' | 'maturity_peak_days' | 'maturity_old_days' | 'maturity_floor' | 'maturity_peak' | 'maturity_old'>): number {
  const days = age === null ? model.unknown_age_days : age;
  if (days <= model.maturity_peak_days) return model.maturity_floor + (model.maturity_peak - model.maturity_floor) * days / model.maturity_peak_days;
  const progress = Math.min(1, (days - model.maturity_peak_days) / (model.maturity_old_days - model.maturity_peak_days));
  return model.maturity_peak + (model.maturity_old - model.maturity_peak) * progress;
}
export function growthFactor(change: number | null, model: Pick<Model, 'growth_floor' | 'growth_cap' | 'growth_weight'>): number {
  const bounded = Math.max(model.growth_floor, Math.min(model.growth_cap, change ?? 0));
  return 1 + bounded / 100 * model.growth_weight;
}
export function chainFactor(chains: string[], model: Pick<Model, 'chain_step' | 'chain_cap'>): number {
  return Math.min(model.chain_cap, 1 + Math.max(0, chains.length - 1) * model.chain_step);
}
export function impliedValue(p: Protocol, age: number | null, multiple: number, model: Model): number {
  return Math.max(1, Math.round(p.tvl_usd * multiple * growthFactor(p.change_7d, model) * maturityFactor(age, model) * chainFactor(p.chains, model)));
}

export function holdoutMetrics(protocols: Protocol[]): Model['holdout'] {
  const peers = livePeers(protocols).slice().sort((a, b) => hashSlug(a.slug) - hashSlug(b.slug) || a.slug.localeCompare(b.slug));
  const testing = peers.filter((_, i) => i % 5 === 0);
  const training = peers.filter((_, i) => i % 5 !== 0);
  const global = median(training.map(peerRatio));
  const categories = fitMultiples(training, global);
  const errors = testing.map(p => {
    const predicted = p.tvl_usd * (categories[p.category || 'Uncategorized']?.multiple ?? global);
    const ratio = (p.mcap_usd as number) / predicted;
    return { error: Math.abs((p.mcap_usd as number) - predicted) / Math.abs(p.mcap_usd as number) * 100, within: ratio >= 0.5 && ratio <= 2 };
  });
  return { count: errors.length, median_absolute_pct_error: median(errors.map(e => e.error)), within_2x_share: errors.filter(e => e.within).length / errors.length };
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
  const holdout = holdoutMetrics(snapshot.protocols);
  const model = fitModel(snapshot.protocols, holdout);
  const watch = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter(p => p.gecko_id === null && p.symbol === null && !isExcluded(p) && (watch.has(p.slug) || p.tvl_usd < snapshot.floor_usd));
  const scored = candidates.map(p => {
    const age = ageDays(p.listed_at, snapshot.as_of);
    const multiple = model.category_multiples[p.category || 'Uncategorized']?.multiple ?? model.global_multiple;
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

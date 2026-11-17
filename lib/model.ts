// Token Radar's model (radar-2): one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol that could plausibly launch a token: pre-token by
// DefiLlama's record, and not a wrapped, staked or bridged product, an exchange, or a
// versioned pool. That is the house watchlist's own rule with the TVL floor lifted, so
// the board holds all 40 watchlist slugs plus the 158 launchable protocols below the
// floor. Live-token protocols are kept apart and shown with their market caps, never
// mixed into the ranking.
//
// Implied value is calibrated from the snapshot's own trading protocols, never from a
// hardcoded list of names:
//
//   multiple(cat) = shrunk category median mcap/TVL (shrinkage k=8 toward the global
//                   median, computed from the snapshot's own trading protocols —
//                   0.2138 for this snapshot; categories with fewer than 3 trading
//                   protocols use the global median outright)
//   growthMult    = 1 + clamp(change_7d, -60, 120)/100 * 0.5
//   maturityMult  = 0.6 + min(age_days, 1095)/1095 * 0.4   (age unknown: 365 days)
//   breadthMult   = 1 + 0.02 * min(max(chains-1, 0), 5)
//   implied       = max(1, round(tvl_usd * multiple * growthMult * maturityMult * breadthMult))
//
// Every farm plan comes from an archetype template table keyed by the protocol's
// category, with the protocol's own name, chain, capital tier and hold window filled
// in. The same table is written into data.js, so the page expands exactly the steps
// board.json carries: screenshots and code agree by construction.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  shrink_k: number;
  global_median: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_max_chains: 5,
  shrink_k: 8,
  // The global median is computed from the snapshot at build time (0.2138 for the
  // 2026-11-14 snapshot); this constant is only a placeholder that buildRadar
  // overwrites with the computed value, so the dashboard never shows a stale one.
  global_median: 0.2138,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of the calibration table the dashboard shows. */
export interface CalibrationRow {
  category: string;
  n: number;
  median: number | null;
  multiple: number;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty number list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the house rule keeps off the watchlist: wrapped, staked, bridged products and exchanges. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Whether a protocol could plausibly launch a token of its own: pre-token, not an
 * excluded category, not a versioned pool, not a wrapped/staked product, not an
 * exchange's own product. This is the watchlist's rule with the TVL floor lifted.
 */
export function isLaunchable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/** The calibration: the global median and one row per category that trades. */
export function calibrate(snapshot: Snapshot): { globalMedian: number; rows: CalibrationRow[] } {
  const trading = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const ratios = trading.map((p) => p.mcap_usd! / p.tvl_usd);
  const globalMedian = median(ratios);
  const byCategory = new Map<string, number[]>();
  for (const p of trading) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(key, list);
  }
  const rows: CalibrationRow[] = [...byCategory.entries()].map(([category, list]) => {
    const med = median(list);
    const multiple =
      list.length >= 3 ? (list.length * med + MODEL.shrink_k * globalMedian) / (list.length + MODEL.shrink_k) : globalMedian;
    return { category, n: list.length, median: round4(med), multiple: round4(multiple) };
  });
  rows.sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { globalMedian: round4(globalMedian), rows };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The multiple one category scores under a calibration. */
export function multipleFor(category: string | null, calibration: { globalMedian: number; rows: CalibrationRow[] }): number {
  if (category === null) return calibration.globalMedian;
  const row = calibration.rows.find((r) => r.category === category);
  return row === undefined ? calibration.globalMedian : row.multiple;
}

/** The multipliers and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: { globalMedian: number; rows: CalibrationRow[] },
  model: ModelConstants = MODEL,
): {
  implied: number;
  multiple: number;
  base: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
} {
  const multiple = multipleFor(protocol.category, calibration);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const age = ageDays(asOf, protocol.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, multiple, base: Math.round(base), growthPct, growthMult, maturityMult, breadthMult, age };
}

/** The farm-plan archetype for a category: the action the plan is built around. */
export function archetypeFor(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('index')) return 'indexes';
  if (c.includes('dex')) return 'dex';
  if (c.includes('yield') || c.includes('farm')) return 'yield';
  if (c.includes('perpetual') || c.includes('derivative')) return 'perpetual';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('curator') || c.includes('allocator')) return 'curator';
  if (c.includes('stable')) return 'stable';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('basis')) return 'basis';
  if (c.includes('privacy')) return 'privacy';
  if (c.includes('payment')) return 'payments';
  if (c.includes('launchpad')) return 'launchpad';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('btc')) return 'btc';
  if (c.includes('chain')) return 'chain';
  if (c.includes('liquidity') || c.includes('manager')) return 'manager';
  if (c.includes('marketplace') || c.includes('otc')) return 'marketplace';
  return 'default';
}

/**
 * The farm-plan template table. Each archetype holds six steps; the page and the board
 * expand the same strings with {name} {chain} {capital} {gas} {hold}. Step 2 is the
 * archetype's action, step 3 its weekly habit; steps 1, 4, 5 and 6 are the shared
 * discipline every farm needs.
 */
export const STEP_TEMPLATES: Record<string, string[]> = {
  lending: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    'Supply ${capital} of USDC to {name} on {chain} and keep the position open. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.',
    'Make one qualifying action each week, such as a deposit, a borrow, or a repayment. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  dex: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    "Provide ${capital} of liquidity to {name}'s main pool on {chain} and keep the position open. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.",
    'Swap a small amount through {name} each week and keep the LP position open. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  yield: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    "Deposit ${capital} of USDC into {name}'s highest-TVL vault on {chain} and keep the shares. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.",
    'Harvest or compound the vault yield once a week. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  perpetual: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    'Deposit ${capital} of USDC as margin on {name} and open one small hedged position. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.',
    'Adjust the hedge once a week and keep margin above the maintenance level. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  prediction: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    'Fund ${capital} and place one market position on {name} on {chain}. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.',
    'Place one new market position each week and settle the old ones. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  curator: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    'Deposit ${capital} into a {name} vault on {chain} and keep the shares. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.',
    'Rebalance or top up the vault position once a week. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  stable: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    'Mint or deposit ${capital} of the stable asset through {name} on {chain}. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.',
    'Keep the stable position supplied and check the peg once a week. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  rwa: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    "Mint ${capital} of {name}'s yield asset on {chain} and hold it. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.",
    'Collect the yield payout each week and keep the asset held. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  insurance: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    'Buy ${capital} of cover from {name} on {chain} and keep the policy. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.',
    'Check open claims and keep the policy active each week. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  indexes: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    "Buy ${capital} of {name}'s index token on {chain} and hold it. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.",
    'Rebalance the index holding once a week if the weights moved. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  basis: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    "Deposit ${capital} into {name}'s basis strategy on {chain} and keep the position. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.",
    'Check the funding rate and roll the position once a week. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  privacy: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    "Deposit ${capital} through {name}'s private pool on {chain} and keep the receipt. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.",
    'Make one private transfer a week through the pool. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  payments: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    'Route ${capital} of payments through {name} on {chain} and keep the account active. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.',
    'Send one payment a week through {name}. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  launchpad: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    'Stake ${capital} to join {name} launches on {chain} and keep the stake. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.',
    'Vote or join one launch allocation each week. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  staking: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    "Stake ${capital} of the chain's native asset in {name}'s pool on {chain} and keep the receipt. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.",
    'Restake or top up the stake once a week. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  bridge: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    'Bridge ${capital} of USDC to {chain} through {name} and use the bridged funds in its app. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.',
    'Bridge a small amount each week through {name}. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  btc: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    'Deposit ${capital} of BTC-backed assets through {name} on {chain} and keep the position. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.',
    'Check the BTC peg and the yield once a week. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  chain: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    'Bridge ${capital} of USDC to {name} and use its apps. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.',
    'Use one app on {name} each week and keep the wallet active. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  manager: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    'Deposit ${capital} into a {name} managed vault on {chain} and keep the shares. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.',
    'Check the vault rebalance once a week. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  marketplace: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    'Place ${capital} of orders through {name} on {chain} and keep the position open. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.',
    'Fill or place one order a week through {name}. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
  default: [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    'Deposit ${capital} of USDC into {name} on {chain} and keep the position open. Cost: ${capital} of capital and about ${gas} of gas. Time: 15 minutes to set up.',
    'Make one qualifying action each week, such as a deposit, a swap, or a vote. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least {hold} days so the activity is counted in more than one snapshot. Cost: the ${capital} stays in the position. Time: {hold} days.',
    "Before you withdraw, open {name}'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ],
};

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Fill a step template's placeholders. */
export function expandStep(
  template: string,
  p: SnapshotProtocol,
  capital: number,
  hold: number,
): string {
  const gas = capital >= 150 ? 8 : 4;
  let s = template
    .replaceAll('{name}', p.name)
    .replaceAll('{chain}', chainOf(p))
    .replaceAll('{capital}', String(capital))
    .replaceAll('{gas}', String(gas))
    .replaceAll('{hold}', String(hold));
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A protocol's farm plan: six steps from its archetype's templates. */
export function farmSteps(p: SnapshotProtocol, age: number | null): { steps: string[]; archetype: string; capital: number; hold: number } {
  const archetype = archetypeFor(p.category);
  const templates = STEP_TEMPLATES[archetype] ?? STEP_TEMPLATES['default']!;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return { steps: templates.map((t) => expandStep(t, p, capital, hold)), archetype, capital, hold };
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  model: {
    multiple: number;
    base_value_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  base_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  archetype: string;
  capital: number;
  hold_days: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: CalibrationRow[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  templates: Record<string, string[]>;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  calibration: { globalMedian: number; rows: CalibrationRow[] },
  model: ModelConstants = MODEL,
): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => isLaunchable(p));
  const scored = chosen.map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibration, model);
    const plan = farmSteps(p, v.age);
    return { p, v, plan };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    watchlist: watchlist.has(s.p.slug),
    model: {
      multiple: round4(s.v.multiple),
      base_value_usd: s.v.base,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
    },
    farm_steps: s.plan.steps,
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, plan: { archetype: string; capital: number; hold: number }): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    base_value_usd: row.model.base_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    archetype: plan.archetype,
    capital: plan.capital,
    hold_days: plan.hold,
    watchlist: row.watchlist,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrate(snapshot);
  const board = buildBoard(snapshot, calibration, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const plans = new Map<string, { archetype: string; capital: number; hold: number }>();
  for (const row of board) {
    const p = snapshot.protocols.find((x) => x.slug === row.slug)!;
    plans.set(row.slug, farmSteps(p, row.age_days));
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    // The global median is a property of the snapshot, not of the model: report the
    // computed one so the page's model panel and the calibration table agree.
    model: { ...model, global_median: calibration.globalMedian },
    model_version: MODEL_VERSION,
    calibration: calibration.rows,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, plans.get(r.slug)!)),
    live,
    templates: STEP_TEMPLATES,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100-row floor`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

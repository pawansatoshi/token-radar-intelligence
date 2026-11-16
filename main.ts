import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

// LAUNCHSCOPE consumes only the competition snapshot. It has no network, wallet, or service dependency.
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DAY = 86_400_000;
const MODEL = { base: 0.25, growth_weight: 0.5, growth_low: -60, growth_high: 120, age_floor: 0.6, age_weight: 0.4, age_cap: 1095, unknown_age: 365 };
const VERSION = /\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;
const DERIVATIVE_NAME = /\b(?:wrapped|staked|staking|bridged|restaked)\b/i;
const DERIVATIVE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGES = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

type Protocol = {
  slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number;
  change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null;
};
type FarmStep = { action: string; cost: string; time: string };
type Scored = Protocol & {
  rank: number; token_status: 'no token recorded'; age_days: number | null; implied_value_usd: number;
  confidence: number; risk_score: number; evidence: string[]; farm_steps: string[];
  model_inputs: { growth_multiplier: number; maturity_multiplier: number };
};

function option(name: string, fallback: string): string {
  const equal = process.argv.find((item) => item.startsWith(`--${name}=`));
  const index = process.argv.indexOf(`--${name}`);
  return equal ? equal.slice(name.length + 3) : index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function readSnapshot(path: string): { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] } {
  const text = readFileSync(path, 'utf8');
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('snapshot must be a JSON object');
  const input = value as Record<string, unknown>;
  if (typeof input.as_of !== 'string' || !Array.isArray(input.protocols) || !Array.isArray(input.watchlist)) throw new Error('snapshot is missing as_of, protocols, or watchlist');
  const protocols = input.protocols as Protocol[];
  if (protocols.some((p) => !p || typeof p.slug !== 'string' || typeof p.name !== 'string' || !Number.isFinite(p.tvl_usd))) throw new Error('snapshot contains a protocol without a slug, name, or finite TVL');
  const slugs = new Set(protocols.map((p) => p.slug));
  if (slugs.size !== protocols.length) throw new Error('snapshot protocol slugs are not unique');
  return { as_of: input.as_of, source: String(input.source ?? 'source unreported'), floor_usd: Number(input.floor_usd), protocols, watchlist: input.watchlist as string[] };
}

const recordsNoToken = (p: Protocol): boolean => p.gecko_id === null && p.symbol === null;
function derivative(p: Protocol): boolean {
  return DERIVATIVE_NAME.test(p.name) || DERIVATIVE_CATEGORIES.has(p.category ?? '') || VERSION.test(p.name) || EXCHANGES.test(p.name);
}
function elapsedDays(asOf: string, listed: string | null): number | null {
  if (listed === null) return null;
  const start = Date.parse(`${listed}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / DAY)) : null;
}
function estimate(p: Protocol, asOf: string) {
  const age = elapsedDays(asOf, p.listed_at);
  const growth = Math.min(MODEL.growth_high, Math.max(MODEL.growth_low, p.change_7d ?? 0));
  const growthFactor = 1 + growth / 100 * MODEL.growth_weight;
  const lifetime = age ?? MODEL.unknown_age;
  const maturityFactor = MODEL.age_floor + Math.min(MODEL.age_cap, lifetime) / MODEL.age_cap * MODEL.age_weight;
  const value = Math.max(1, Math.round(p.tvl_usd * MODEL.base * growthFactor * maturityFactor));
  const certainty = 35 + (p.tvl_usd > 0 ? 20 : 0) + (p.change_7d === null ? 0 : 15) + (p.listed_at === null ? 0 : 15) + (p.chains.length ? 10 : 0) + (p.category ? 5 : 0);
  const category = (p.category ?? '').toLowerCase();
  const complex = /perpetual|derivative|restak|bridge|rwa|insurance|basis|leverag/.test(category);
  const common = /lending|cdp|staking|yield|dex|curat|allocator/.test(category);
  const exposure = Math.min(40, Math.abs(p.change_7d ?? 0) * 1.5);
  const risk = Math.min(100, Math.round(25 + exposure + (complex ? 25 : common ? 15 : 20)));
  return { age, value, certainty, risk, growthFactor, maturityFactor };
}

function investableAmount(tvl: number): number {
  return tvl >= 5_000_000_000 ? 250 : tvl >= 1_000_000_000 ? 150 : tvl >= 100_000_000 ? 100 : 50;
}
function candidateAction(p: Protocol, budget: number): string {
  const category = (p.category ?? '').toLowerCase();
  const chain = p.chains[0] ?? 'the chain shown by its official app';
  if (/lending|cdp|collateral/.test(category)) return `If the official app supports it, test a small USDC supply position in ${p.name} on ${chain}, then record the receipt.`;
  if (/dex|yield/.test(category)) return `If the official app supports it, test a small ${p.name} pool position on ${chain}; note both assets and withdrawal terms.`;
  if (/staking|restak/.test(category)) return `Review ${p.name}'s staking terms on ${chain}; use a small position only if you understand the lock and receipt.`;
  if (/perpetual|derivative|basis/.test(category)) return `Read ${p.name}'s margin and liquidation terms first; avoid leverage unless the official app and your risk limit support it.`;
  if (/rwa/.test(category)) return `Check ${p.name}'s jurisdiction and redemption terms; consider a small position only if the official app confirms eligibility.`;
  if (/curat|allocator/.test(category)) return `If the official app supports it, consider a small ${p.name} vault position on ${chain} and save its share receipt.`;
  return `Review ${p.name}'s official documentation for a reversible user action; use up to $${budget} only if its costs and risks are clear.`;
}
function farming(p: Protocol): string[] {
  const budget = investableAmount(p.tvl_usd);
  const plans: FarmStep[] = [
    { action: `Find ${p.name}'s app through its official documentation; verify the domain and chain before connecting. The snapshot has no app URL.`, cost: 'no capital; check network fee quotes before signing', time: 'about 10 minutes' },
    { action: candidateAction(p, budget) + ' This is a category-based candidate, not proof of an active program.', cost: `optional capital up to $${budget}; gas varies and is quoted in-wallet`, time: 'about 15 minutes' },
    { action: 'Keep a dated activity log with transaction IDs; repeat an action only when official documentation gives a reason.', cost: 'no capital to log; transaction gas is optional and variable', time: 'about 5 minutes per action' },
    { action: 'Review positions and terms weekly; close a position when its risks or costs exceed your limit.', cost: 'capital stays exposed only while the position is open', time: 'about 5 minutes weekly' },
    { action: 'Check official announcements for a token, points program, or eligibility rules; this dataset confirms none of these.', cost: 'no cost to check; do not pay a third party to claim', time: 'about 5 minutes monthly' },
    { action: 'Reconcile wallet history and close positions you no longer want; retain native asset for the network exit fee.', cost: 'variable exit gas; inspect the wallet quote first', time: 'about 10 minutes' },
  ];
  return plans.map(({ action, cost, time }) => `${action} Cost: ${cost}. Time: ${time}.`);
}

function rankSnapshot(input: ReturnType<typeof readSnapshot>) {
  const bySlug = new Map(input.protocols.map((p) => [p.slug, p]));
  const forced = new Set(input.watchlist);
  const absent = input.watchlist.filter((slug) => !bySlug.has(slug));
  if (absent.length) throw new Error(`watchlist references unknown protocol: ${absent.slice(0, 5).join(', ')}`);

  const ranked = input.protocols.filter((p) => forced.has(p.slug) || (recordsNoToken(p) && !derivative(p))).map((p) => {
    const m = estimate(p, input.as_of);
    return {
      ...p, rank: 0, token_status: 'no token recorded' as const, age_days: m.age, implied_value_usd: m.value,
      confidence: m.certainty, risk_score: m.risk,
      evidence: [`DefiLlama snapshot: TVL $${p.tvl_usd}; seven-day TVL change ${p.change_7d === null ? 'unreported' : `${p.change_7d}%`}.`, `Listed ${p.listed_at ?? 'date unreported'}; token identifiers absent from this record.`],
      model_inputs: { growth_multiplier: Number(m.growthFactor.toFixed(4)), maturity_multiplier: Number(m.maturityFactor.toFixed(4)) },
      farm_steps: farming(p),
    };
  });
  ranked.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  ranked.forEach((row, index) => { row.rank = index + 1; });

  const active = input.protocols.filter((p) => !recordsNoToken(p)).sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  const excluded = input.protocols.filter((p) => recordsNoToken(p) && !forced.has(p.slug) && derivative(p)).map((p) => ({
    slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
    reason: 'Excluded from launch-value ranking by the wrapped, staked, bridge, exchange, or version-product rule.',
  }));
  const accounted = new Set([...ranked.map((p) => p.slug), ...active.map((p) => p.slug), ...excluded.map((p) => p.slug)]);
  if (accounted.size !== input.protocols.length) throw new Error(`dataset coverage mismatch: ${accounted.size} of ${input.protocols.length}`);
  if (ranked.length < 100 || ranked.some((row) => !Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0)) throw new Error('ranked board has too few rows or an invalid valuation');
  return { ranked, active, excluded };
}

function safeCopy(from: string, to: string): number {
  if (!existsSync(from)) return 0;
  mkdirSync(to, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name)); copied++;
  }
  return copied;
}

const supplied = option('input', '/input');
const snapshotFile = supplied.endsWith('.json') ? supplied : join(supplied, 'snapshot.json');
const destination = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
if (!existsSync(snapshotFile)) throw new Error(`snapshot not found: ${snapshotFile}`);
const snapshot = readSnapshot(snapshotFile);
const { ranked, active, excluded } = rankSnapshot(snapshot);
const outputRows = { rows: ranked };
const dashboardData = {
  as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, model: MODEL,
  model_version: 'launchscope-2', watchlist: snapshot.watchlist, dataset_size: snapshot.protocols.length,
  board_size: ranked.length, live_size: active.length, excluded, live: active, rows: ranked,
};
mkdirSync(destination, { recursive: true });
writeFileSync(join(destination, 'board.json'), `${JSON.stringify(outputRows)}\n`);
writeFileSync(join(destination, 'data.js'), `window.RADAR=${JSON.stringify(dashboardData)};\n`);
const dashboardFiles = safeCopy(join(ROOT, 'dashboard'), join(destination, 'dashboard'));
const screenshotFiles = safeCopy(join(ROOT, 'screenshots'), join(destination, 'screenshots'));
if (screenshotFiles < 3) throw new Error(`screenshots contains ${screenshotFiles} files; three dashboard views are required`);
writeFileSync(join(destination, 'dossier.json'), buildDossier(destination, {
  text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 },
}));
process.stdout.write(`LAUNCHSCOPE ${snapshot.protocols.length} inputs → ${ranked.length} ranked · ${active.length} live · ${excluded.length} excluded\n`);
process.stdout.write(`output ${destination}: board.json, data.js, ${dashboardFiles} dashboard files, ${screenshotFiles} screenshots, dossier.json\n`);

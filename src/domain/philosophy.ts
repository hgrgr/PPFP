/**
 * Investment philosophies (stored as Strategy / StrategyVersion): principles in prose plus
 * closed-schema rules a machine can check — the universe, rebalancing and risk limits.
 * Also the run metrics, a ranking score that discounts short or over-searched records,
 * and a deterministic lint for philosophy text imported from elsewhere.
 * Everything here is pure; hashing and storage live in server/services/philosophy.ts.
 */
import { z } from 'zod';

// ---------------------------------------------------------------- rules (v1: static allocation)

export const RULES_SCHEMA_VERSION = 1;
export const RULE_LIMITS = { assets: 30, principles: 8_000, name: 40, oneLine: 120 };

export const REBALANCE = ['NONE', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'BAND'] as const;
export type Rebalance = (typeof REBALANCE)[number];
export const REBALANCE_LABEL: Record<Rebalance, string> = {
  NONE: '그대로 두기',
  MONTHLY: '매월',
  QUARTERLY: '분기마다',
  YEARLY: '해마다',
  BAND: '허용 오차를 벗어날 때',
};

/** Markets an asset row may name; matches Asset.market values used by the broker adapters. */
export const MARKETS = ['KRX', 'US', 'CRYPTO', 'OTHER'] as const;

const weight = z.number().min(0).max(1);

const AssetRule = z
  .object({
    symbol: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9.\-_^]+$/, '심볼에 쓸 수 없는 글자가 있습니다'),
    market: z.enum(MARKETS),
    currency: z.enum(['KRW', 'USD']),
    weight,
  })
  .strict();

/** Closed v1 schema: unknown keys are rejected so a rule can never carry hidden behaviour. */
export const StrategyRulesSchema = z
  .object({
    schemaVersion: z.literal(RULES_SCHEMA_VERSION),
    assets: z.array(AssetRule).min(1).max(RULE_LIMITS.assets),
    cashWeight: weight,
    rebalance: z.enum(REBALANCE),
    /** Absolute drift (0.05 = 5%p) that triggers BAND and the drift violation */
    band: z.number().min(0.005).max(0.5).default(0.05),
    limits: z
      .object({
        maxWeight: z.number().gt(0).max(1).default(1),
        minCash: weight.default(0),
      })
      .strict(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const sum = r.assets.reduce((s, a) => s + a.weight, 0) + r.cashWeight;
    if (Math.abs(sum - 1) > 0.001) ctx.addIssue({ code: 'custom', path: ['assets'], message: `비중 합이 100%가 아닙니다 (${(sum * 100).toFixed(1)}%)` });
    const seen = new Set<string>();
    r.assets.forEach((a, i) => {
      const key = `${a.market}:${a.symbol.toUpperCase()}`;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['assets', i, 'symbol'], message: `${a.symbol}이(가) 두 번 들어 있습니다` });
      seen.add(key);
      if (a.weight > r.limits.maxWeight + 1e-9) ctx.addIssue({ code: 'custom', path: ['assets', i, 'weight'], message: `${a.symbol} 비중이 종목당 한도를 넘습니다` });
    });
    if (r.cashWeight + 1e-9 < r.limits.minCash) ctx.addIssue({ code: 'custom', path: ['cashWeight'], message: '현금 비중이 최소 현금보다 작습니다' });
  });

export type StrategyRules = z.infer<typeof StrategyRulesSchema>;

export type ParsedRules = { ok: true; rules: StrategyRules } | { ok: false; errors: string[] };

/** Validate rules from a form, a JSON file or an AI draft. Accepts an object or JSON text. */
export function parseRules(input: unknown): ParsedRules {
  let raw = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      return { ok: false, errors: ['규칙 JSON을 읽을 수 없습니다'] };
    }
  }
  const r = StrategyRulesSchema.safeParse(raw);
  if (r.success) return { ok: true, rules: r.data };
  return { ok: false, errors: r.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)) };
}

/** Scale asset and cash weights so they sum to exactly 1 (form rounding, AI drafts). */
export function normalizeWeights<T extends { assets: { weight: number }[]; cashWeight: number }>(r: T): T {
  const sum = r.assets.reduce((s, a) => s + a.weight, 0) + r.cashWeight;
  if (sum <= 0) throw new Error('weights sum to zero');
  return { ...r, assets: r.assets.map((a) => ({ ...a, weight: a.weight / sum })), cashWeight: r.cashWeight / sum };
}

/** Key-sorted JSON so the same principles and rules always hash the same. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Text the version's contentHash is taken over. */
export const hashInput = (principles: string, rules: StrategyRules) => `${principles.trim()}\n${canonicalJson(rules)}`;

export interface Violation {
  code: 'OVER_MAX' | 'OUTSIDE_UNIVERSE' | 'CASH_LOW' | 'DRIFT' | 'MISSING';
  symbol?: string;
  actual: number;
  target: number;
}

/**
 * Compare a portfolio's current weights (by symbol, cash separate; both shares of the
 * same total) with the rules.
 */
export function checkAgainst(rules: StrategyRules, holdings: { symbol: string; weight: number }[], cashWeight: number): Violation[] {
  const out: Violation[] = [];
  const held = new Map<string, number>();
  for (const h of holdings) held.set(h.symbol.toUpperCase(), (held.get(h.symbol.toUpperCase()) ?? 0) + h.weight);
  const inRules = new Set(rules.assets.map((a) => a.symbol.toUpperCase()));
  for (const [symbol, w] of held) {
    if (!inRules.has(symbol) && w > 0) out.push({ code: 'OUTSIDE_UNIVERSE', symbol, actual: w, target: 0 });
    if (w > rules.limits.maxWeight + 1e-9) out.push({ code: 'OVER_MAX', symbol, actual: w, target: rules.limits.maxWeight });
  }
  for (const a of rules.assets) {
    const w = held.get(a.symbol.toUpperCase()) ?? 0;
    if (w === 0 && a.weight > 0) out.push({ code: 'MISSING', symbol: a.symbol, actual: 0, target: a.weight });
    else if (Math.abs(w - a.weight) > rules.band) out.push({ code: 'DRIFT', symbol: a.symbol, actual: w, target: a.weight });
  }
  if (cashWeight + 1e-9 < rules.limits.minCash) out.push({ code: 'CASH_LOW', actual: cashWeight, target: rules.limits.minCash });
  return out;
}

export const VIOLATION_LABEL: Record<Violation['code'], string> = {
  OVER_MAX: '종목당 한도 초과',
  OUTSIDE_UNIVERSE: '규칙에 없는 종목',
  CASH_LOW: '최소 현금 부족',
  DRIFT: '목표 비중에서 벗어남',
  MISSING: '아직 보유하지 않음',
};

/** Starting points; ETF symbols are suggestions the user checks before saving. */
export const TEMPLATES: Record<string, { label: string; oneLine: string; rules: StrategyRules }> = {
  'kr-6040': {
    label: '60/40 (국내 ETF)',
    oneLine: '주식 60, 채권 40을 해마다 맞춘다',
    rules: {
      schemaVersion: 1,
      assets: [
        { symbol: '069500', market: 'KRX', currency: 'KRW', weight: 0.6 },
        { symbol: '148070', market: 'KRX', currency: 'KRW', weight: 0.4 },
      ],
      cashWeight: 0,
      rebalance: 'YEARLY',
      band: 0.05,
      limits: { maxWeight: 0.6, minCash: 0 },
    },
  },
};

/** Equal weight over the given rows after setting aside cash. */
export function equalWeight(rows: { symbol: string; market: (typeof MARKETS)[number]; currency: 'KRW' | 'USD' }[], cashWeight = 0): StrategyRules {
  const w = (1 - cashWeight) / Math.max(1, rows.length);
  return { schemaVersion: 1, assets: rows.map((r) => ({ ...r, weight: w })), cashWeight, rebalance: 'QUARTERLY', band: 0.05, limits: { maxWeight: Math.min(1, w + 0.1), minCash: cashWeight } };
}

/** One-line rules summary for tables. */
export function rulesSummary(r: StrategyRules): string {
  const top = [...r.assets].sort((a, b) => b.weight - a.weight).slice(0, 3);
  const more = r.assets.length > 3 ? ` 외 ${r.assets.length - 3}` : '';
  const cash = r.cashWeight > 0 ? ` · 현금 ${Math.round(r.cashWeight * 100)}%` : '';
  return `${top.map((a) => `${a.symbol} ${Math.round(a.weight * 100)}%`).join(', ')}${more}${cash} · ${REBALANCE_LABEL[r.rebalance]}`;
}

// ---------------------------------------------------------------- metrics

export interface RunMetrics {
  days: number;
  years: number;
  totalReturn: number;
  cagr: number;
  volatility: number;
  maxDrawdown: number;
  sharpe: number | null;
  sortino: number | null;
  /** Average one-way traded share of the portfolio per year */
  turnover: number;
}

const TRADING_DAYS = 252;

/**
 * Metrics of a value path (any start level) on ISO dates. Daily log returns, annualised
 * with 252 days; rf is an annual rate. turnoverTotal is the summed one-way turnover.
 */
export function runMetrics(dates: string[], values: number[], opts: { rf?: number; turnoverTotal?: number } = {}): RunMetrics {
  if (dates.length !== values.length || values.length < 2) throw new Error('need at least two dated values');
  if (values.some((v) => !(v > 0))) throw new Error('values must be positive');
  const days = values.length;
  const years = Math.max(1 / 365, (Date.parse(dates[days - 1]) - Date.parse(dates[0])) / (365.25 * 86_400_000));
  const totalReturn = values[days - 1] / values[0] - 1;
  const rets = values.slice(1).map((v, i) => Math.log(v / values[i]));
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  const downside = Math.sqrt(rets.reduce((s, r) => s + Math.min(0, r) ** 2, 0) / rets.length);
  const rfDaily = Math.log(1 + (opts.rf ?? 0)) / TRADING_DAYS;
  let peak = values[0];
  let mdd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    mdd = Math.min(mdd, v / peak - 1);
  }
  return {
    days,
    years,
    totalReturn,
    cagr: Math.pow(1 + totalReturn, 1 / years) - 1,
    volatility: sd * Math.sqrt(TRADING_DAYS),
    maxDrawdown: mdd,
    sharpe: sd > 0 ? ((mean - rfDaily) / sd) * Math.sqrt(TRADING_DAYS) : null,
    sortino: downside > 0 ? ((mean - rfDaily) / downside) * Math.sqrt(TRADING_DAYS) : null,
    turnover: (opts.turnoverTotal ?? 0) / years,
  };
}

/** One-way turnover of a rebalance: half the summed absolute weight change. */
export const rebalanceTurnover = (before: number[], after: number[]) => before.reduce((s, b, i) => s + Math.abs(b - (after[i] ?? 0)), 0) / 2;

// ---------------------------------------------------------------- ranking

export type RunMode = 'BACKTEST' | 'PAPER';
export type WarningLevel = 'block' | 'caution' | 'info';

export interface RankInput {
  id: string;
  name: string;
  mode: RunMode;
  metrics: RunMetrics;
  /** Versions or variants tried before this one; more tries, more luck to discount */
  trials: number;
  feeBps: number;
  /** In-sample (backtest) Sharpe of the same version, to compare with paper */
  backtestSharpe?: number | null;
}

export interface RunWarning {
  code: 'SHORT_RECORD' | 'FEW_SAMPLES' | 'BACKTEST_ONLY' | 'OVERFIT_SUSPECT' | 'MANY_TRIALS' | 'NO_COST';
  level: WarningLevel;
  message: string;
}

const months = (m: RunMetrics) => m.years * 12;

/** Deterministic warnings about how far a run's numbers can be trusted. */
export function warningsOf(r: RankInput): RunWarning[] {
  const w: RunWarning[] = [];
  const m = r.metrics;
  if (r.mode === 'BACKTEST') w.push({ code: 'BACKTEST_ONLY', level: 'caution', message: '과거 데이터에 맞춘 결과뿐입니다. 페이퍼 운용 기록이 없습니다.' });
  if (r.mode === 'PAPER' && months(m) < 12) w.push({ code: 'SHORT_RECORD', level: 'caution', message: `페이퍼 운용 ${Math.floor(months(m))}개월 — 12개월 미만은 운의 영향이 큽니다.` });
  if (m.days < 60) w.push({ code: 'FEW_SAMPLES', level: 'block', message: `일별 표본이 ${m.days}개뿐이라 지표를 비교할 수 없습니다.` });
  const sharpe = m.sharpe ?? 0;
  const inSampleGap = r.mode === 'PAPER' && r.backtestSharpe != null && r.backtestSharpe - sharpe > 1;
  if ((r.mode === 'BACKTEST' && (sharpe > 2.5 || (sharpe > 1.5 && r.trials >= 10))) || inSampleGap) {
    w.push({ code: 'OVERFIT_SUSPECT', level: 'caution', message: inSampleGap ? '백테스트보다 페이퍼 성과가 크게 낮습니다 — 과거에 맞춘 규칙일 수 있습니다.' : '여러 번 고쳐 본 끝의 높은 샤프는 과적합일 수 있습니다.' });
  }
  if (r.trials >= 20) w.push({ code: 'MANY_TRIALS', level: 'info', message: `${r.trials}번 시도한 것 중 하나입니다. 순위는 그만큼 깎아 계산했습니다.` });
  if (r.feeBps <= 0) w.push({ code: 'NO_COST', level: 'info', message: '거래 비용 0으로 계산했습니다.' });
  return w;
}

/**
 * Ranking score: Sharpe shrunk toward zero by record length (paper counts fully,
 * backtest half), minus the Sharpe expected from the best of `trials` lucky tries
 * (≈ sqrt(2 ln N) / sqrt(years), a rough deflated-Sharpe haircut), minus a drawdown term.
 * Blocked runs get no score.
 */
export function rankScore(r: RankInput): number | null {
  const m = r.metrics;
  if (m.sharpe === null || warningsOf(r).some((w) => w.level === 'block')) return null;
  const effMonths = months(m) * (r.mode === 'PAPER' ? 1 : 0.5);
  const shrunk = m.sharpe * (effMonths / (effMonths + 24));
  const luck = r.trials > 1 ? Math.sqrt(2 * Math.log(r.trials)) / Math.sqrt(Math.max(m.years, 0.25)) : 0;
  return shrunk - luck * 0.5 + m.maxDrawdown;
}

/** Evidence grade: A paper ≥ 12 months, B backtest or shorter paper, D nothing comparable. */
export function evidenceGrade(r: RankInput): 'A' | 'B' | 'D' {
  if (rankScore(r) === null) return 'D';
  return r.mode === 'PAPER' && months(r.metrics) >= 12 ? 'A' : 'B';
}

export interface RankedRow extends RankInput {
  rank: number | null;
  score: number | null;
  grade: 'A' | 'B' | 'D';
  warnings: RunWarning[];
}

/** Rank by grade first (verified forward records above backtests), then score. */
export function rankRuns(rows: RankInput[]): RankedRow[] {
  const scored = rows.map((r) => ({ ...r, score: rankScore(r), grade: evidenceGrade(r), warnings: warningsOf(r), rank: null as number | null }));
  scored.sort((a, b) => a.grade.localeCompare(b.grade) || (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.name.localeCompare(b.name));
  let n = 0;
  for (const s of scored) s.rank = s.score === null ? null : ++n;
  return scored;
}

// ---------------------------------------------------------------- text lint

export interface LintFinding {
  level: WarningLevel;
  code: string;
  excerpt: string;
}

const LINT_RULES: { code: string; level: WarningLevel; re: RegExp }[] = [
  { code: 'IGNORE_PREVIOUS', level: 'block', re: /(ignore|disregard|forget)\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules?)|(이전|앞선|위의|기존|시스템)\s*(의\s*)?(모든\s*)?(지시|지침|명령|규칙|프롬프트)[을를은는]?\s*(모두\s*)?(무시|잊)/i },
  { code: 'ROLE_SWITCH', level: 'block', re: /(you\s+are\s+now|act\s+as\s+(the\s+)?(system|developer|admin)|^\s*(system|assistant)\s*:|<\/?(system|assistant)>|너는\s*이제|지금부터\s*(너는|당신은)|개발자\s*모드)/im },
  { code: 'TOOL_CALL', level: 'block', re: /\b(propose_\w+|run_tool|tool_use|function_call|get_\w+_backtest)\b|(도구|툴|함수)[를을]?\s*(직접\s*)?(호출|실행)/i },
  { code: 'MONEY_MOVE', level: 'block', re: /\b(wire|transfer|withdraw|send)\s+(the\s+)?(funds?|money|cash|assets?)\b|\bplace\s+(an?\s+)?(market\s+)?orders?\b|(송금|출금|이체)\s*(하라|해라|해\s*줘|하세요|할\s*것)|(즉시|바로|자동으로)\s*(매수|매도|주문)/i },
  { code: 'SECRET_REQUEST', level: 'block', re: /\b(api[\s_-]?keys?|app[\s_-]?secret|secret\s+keys?|passwords?|access\s+tokens?|private\s+keys?|seed\s+phrase)\b|(앱\s*키|시크릿|비밀번호|계좌\s*번호|인증\s*토큰|개인\s*키)/i },
  { code: 'EXFIL_URL', level: 'block', re: /(send|post|upload|forward|보내|전송|업로드)[^\n]{0,40}https?:\/\/|https?:\/\/[^\s)]+[?&][\w-]+=\{?\w*|\b(webhook|curl\s+-|fetch\()/i },
  { code: 'ZERO_WIDTH', level: 'block', re: /[​-‏‪-‮⁠-⁤﻿]/ },
  { code: 'HTML_COMMENT', level: 'caution', re: /<!--[\s\S]*?-->/ },
  { code: 'BASE64_BLOB', level: 'caution', re: /[A-Za-z0-9+/]{120,}={0,2}/ },
];

export const LINT_LABEL: Record<string, string> = {
  IGNORE_PREVIOUS: '이전 지시를 무시하라는 문구',
  ROLE_SWITCH: '역할을 바꾸라는 문구',
  TOOL_CALL: '도구를 직접 부르라는 지시',
  MONEY_MOVE: '주문·송금·출금 지시',
  SECRET_REQUEST: '키·비밀번호·계좌 요구',
  EXFIL_URL: '외부 주소로 데이터를 보내라는 요구',
  ZERO_WIDTH: '보이지 않는 글자',
  HTML_COMMENT: '숨겨진 HTML 주석',
  BASE64_BLOB: '인코딩된 긴 덩어리',
  LONG_LINE: '비정상적으로 긴 줄',
};

const visible = (s: string) => s.replace(/[​-‏‪-‮⁠-⁤﻿]/g, (c) => `[U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}]`);

/**
 * Static check of imported philosophy or skill text for instruction-injection patterns.
 * One finding per rule (first match). Patterns can be dodged, so this only warns; the real
 * defence is that imported text never becomes rules or actions without the user.
 */
export function lintText(text: string): LintFinding[] {
  const out: LintFinding[] = [];
  for (const rule of LINT_RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const from = Math.max(0, m.index - 20);
    const to = Math.min(text.length, m.index + Math.min(m[0].length, 80) + 20);
    out.push({ level: rule.level, code: rule.code, excerpt: visible(text.slice(from, to)).replace(/\s+/g, ' ').trim() });
  }
  const long = text.split('\n').find((l) => l.length > 2_000);
  if (long) out.push({ level: 'info', code: 'LONG_LINE', excerpt: `${long.slice(0, 60)}… (${long.length.toLocaleString()}자)` });
  return out;
}

export function lintVerdict(findings: LintFinding[]): WarningLevel | 'ok' {
  if (findings.some((f) => f.level === 'block')) return 'block';
  if (findings.some((f) => f.level === 'caution')) return 'caution';
  return findings.length ? 'info' : 'ok';
}

// ---------------------------------------------------------------- import sources

export interface ImportSource {
  key: 'custom' | 'template' | 'skill' | 'sage' | 'skills.sh' | 'file';
  label: string;
  /** What the popularity or rank shown for it means */
  signal: string;
  how: string;
  status: 'ready' | 'planned';
}

/** Where a philosophy can come from, shown on the page so the user knows what each one is worth. */
export const IMPORT_SOURCES: ImportSource[] = [
  { key: 'custom', label: '직접 작성', signal: '없음', how: '원칙과 규칙을 직접 쓰면 바로 채택됩니다.', status: 'ready' },
  { key: 'template', label: '템플릿', signal: '없음', how: '60/40 같은 정적 배분에서 시작합니다. ETF 종목은 저장 전에 확인하세요.', status: 'ready' },
  { key: 'skill', label: '내 AI 스킬', signal: '없음', how: 'AI가 스킬 글을 읽고 규칙 초안을 만듭니다. 채택 전까지 초안으로 남습니다.', status: 'planned' },
  { key: 'sage', label: '투자 거장', signal: '없음', how: '거장 노트를 사용자·AI의 해석으로 옮긴 초안입니다. 인물 이름은 성과의 근거가 아닙니다.', status: 'planned' },
  { key: 'skills.sh', label: 'skills.sh 커뮤니티', signal: '설치 수 (인기이지 성과가 아님)', how: '가져오기 전에 위험 문구 검사를 거치고, 차단 등급이면 한 번 더 확인합니다.', status: 'planned' },
  { key: 'file', label: 'rules.json 파일', signal: '없음', how: '다른 기기에서 내보낸 규칙을 받습니다. 성과는 함께 오지 않고 내 데이터로 다시 검증합니다.', status: 'planned' },
];

/**
 * Investment philosophies: Strategy rows with append-only StrategyVersions, the user's
 * adoption of one version, and the ranking of cached StrategyRun metrics.
 * Experimental — the run engine (ST-03) and imports (ST-09/10) are still TODO.
 */
import type { Prisma } from '@prisma/client';
import {
  hashInput,
  lintText,
  lintVerdict,
  parseRules,
  rankRuns,
  RULE_LIMITS,
  rulesSummary,
  TEMPLATES,
  type LintFinding,
  type RankInput,
  type RunMetrics,
  type StrategyRules,
} from '@/domain/philosophy';
import { sha256 } from '../crypto';
import { prisma } from '../db';
import { audit, UserError } from './portfolios';

/** Active paper runs a user may keep at once (each replays its universe daily). */
export const MAX_ACTIVE_PAPER = 10;

export interface PhilosophyView {
  id: string;
  name: string;
  oneLine: string | null;
  origin: string;
  archived: boolean;
  activeVersion: number | null;
  latestVersion: number;
  /** Newest version above the adopted one, waiting for adoption */
  draft: number | null;
  summary: string | null;
  rulesError: boolean;
  lint: LintFinding[];
  runs: number;
  following: number;
  updatedAt: Date;
}

const readRules = (raw: Prisma.JsonValue) => {
  const r = parseRules(raw);
  return r.ok ? r.rules : null;
};

export async function listPhilosophies(userId: string): Promise<PhilosophyView[]> {
  const rows = await prisma.strategy.findMany({
    where: { userId },
    orderBy: [{ archived: 'asc' }, { updatedAt: 'desc' }],
    include: { versions: { orderBy: { version: 'desc' }, include: { _count: { select: { runs: true, portfolios: true } } } } },
  });
  return rows.map((s) => {
    const latest = s.versions[0];
    const shown = s.versions.find((v) => v.version === s.activeVersion) ?? latest;
    const rules = shown ? readRules(shown.rules) : null;
    return {
      id: s.id,
      name: s.name,
      oneLine: s.oneLine,
      origin: s.origin,
      archived: s.archived,
      activeVersion: s.activeVersion,
      latestVersion: latest?.version ?? 0,
      draft: latest && latest.version !== s.activeVersion && latest.version > (s.activeVersion ?? 0) ? latest.version : null,
      summary: rules ? rulesSummary(rules) : null,
      rulesError: !!shown && !rules,
      lint: (shown?.lint as unknown as LintFinding[]) ?? [],
      runs: s.versions.reduce((n, v) => n + v._count.runs, 0),
      following: s.versions.reduce((n, v) => n + v._count.portfolios, 0),
      updatedAt: s.updatedAt,
    };
  });
}

export interface PhilosophyInput {
  name: string;
  oneLine: string;
  principles: string;
  /** JSON text or an object; validated against the closed v1 schema */
  rules: unknown;
  origin?: string;
  author?: 'user' | 'ai' | 'template';
  note?: string;
}

function checkInput(input: Pick<PhilosophyInput, 'principles' | 'rules'>) {
  const principles = input.principles.trim();
  if (principles.length > RULE_LIMITS.principles) throw new UserError(`원칙은 ${RULE_LIMITS.principles.toLocaleString()}자까지 쓸 수 있습니다.`);
  const parsed = parseRules(input.rules);
  if (!parsed.ok) throw new UserError(`규칙을 확인하세요: ${parsed.errors.slice(0, 3).join(' / ')}`);
  return { principles, rules: parsed.rules, contentHash: sha256(hashInput(principles, parsed.rules)), lint: lintText(principles) };
}

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

/**
 * New philosophy with version 1. A user-written one is adopted at once; an AI or
 * imported one stays a draft until the user adopts it (that is the approval gate).
 */
export async function createPhilosophy(userId: string, input: PhilosophyInput): Promise<string> {
  const name = input.name.trim().slice(0, RULE_LIMITS.name);
  if (!name) throw new UserError('철학 이름을 넣으세요.');
  const v = checkInput(input);
  const author = input.author ?? 'user';
  if (await prisma.strategy.findFirst({ where: { userId, name } })) throw new UserError('같은 이름의 철학이 있습니다.');
  return prisma.$transaction(async (tx) => {
    const s = await tx.strategy.create({
      data: {
        userId,
        name,
        oneLine: input.oneLine.trim().slice(0, RULE_LIMITS.oneLine) || null,
        origin: input.origin ?? 'custom',
        activeVersion: author === 'user' ? 1 : null,
        versions: { create: { version: 1, principles: v.principles, rules: asJson(v.rules), contentHash: v.contentHash, lint: asJson(v.lint), author, note: input.note?.slice(0, 200) } },
      },
    });
    await audit(tx, userId, 'Strategy', s.id, 'create', undefined, { name, author, contentHash: v.contentHash });
    return s.id;
  });
}

/** Append a version; editing never rewrites one that runs or portfolios may pin. */
export async function addVersion(userId: string, strategyId: string, input: Omit<PhilosophyInput, 'name' | 'oneLine' | 'origin'>): Promise<number> {
  const s = await prisma.strategy.findFirst({ where: { id: strategyId, userId }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
  if (!s) throw new UserError('철학을 찾을 수 없습니다.');
  const v = checkInput(input);
  const last = s.versions[0];
  if (last?.contentHash === v.contentHash) throw new UserError('바뀐 내용이 없습니다.');
  const version = (last?.version ?? 0) + 1;
  const author = input.author ?? 'user';
  await prisma.$transaction([
    prisma.strategyVersion.create({ data: { strategyId, version, principles: v.principles, rules: asJson(v.rules), contentHash: v.contentHash, lint: asJson(v.lint), author, note: input.note?.slice(0, 200) } }),
    prisma.strategy.update({ where: { id: strategyId }, data: { updatedAt: new Date() } }),
  ]);
  return version;
}

/** Adopt a version as the one the user runs by. Recorded in the audit log. */
export async function adoptVersion(userId: string, strategyId: string, version: number) {
  const s = await prisma.strategy.findFirst({ where: { id: strategyId, userId } });
  if (!s) throw new UserError('철학을 찾을 수 없습니다.');
  const v = await prisma.strategyVersion.findUnique({ where: { strategyId_version: { strategyId, version } } });
  if (!v) throw new UserError('그 버전이 없습니다.');
  if (!readRules(v.rules)) throw new UserError('이 버전의 규칙이 지금 형식과 맞지 않아 채택할 수 없습니다.');
  if (lintVerdict(v.lint as unknown as LintFinding[]) === 'block') {
    // TODO(ST-10): ask for an extra confirmation instead of refusing outright
    throw new UserError('원칙 글에 위험 문구가 있어 채택하지 않았습니다. 글을 고쳐 새 버전을 만드세요.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.strategy.update({ where: { id: strategyId }, data: { activeVersion: version } });
    await audit(tx, userId, 'Strategy', strategyId, 'adopt', { activeVersion: s.activeVersion }, { activeVersion: version, contentHash: v.contentHash });
  });
}

export async function setArchived(userId: string, strategyId: string, archived: boolean) {
  const r = await prisma.strategy.updateMany({ where: { id: strategyId, userId }, data: { archived } });
  if (!r.count) throw new UserError('철학을 찾을 수 없습니다.');
  if (archived) await prisma.strategyRun.updateMany({ where: { userId, active: true, version: { strategyId } }, data: { active: false } });
}

export async function deletePhilosophy(userId: string, strategyId: string) {
  const s = await prisma.strategy.findFirst({ where: { id: strategyId, userId } });
  if (!s) throw new UserError('철학을 찾을 수 없습니다.');
  // Portfolio.strategyVersion is NO ACTION: say why instead of failing on the foreign key
  const following = await prisma.portfolio.count({ where: { userId, strategyVersion: { strategyId } } });
  if (following) throw new UserError(`이 철학을 따르는 포트폴리오가 ${following}개 있습니다. 연결을 먼저 끊으세요.`);
  await prisma.$transaction(async (tx) => {
    await tx.strategy.delete({ where: { id: strategyId } });
    await audit(tx, userId, 'Strategy', strategyId, 'delete', { name: s.name, activeVersion: s.activeVersion });
  });
}

/** Rules of a template, for prefilling the new-philosophy form. */
export function templateRules(key: string): StrategyRules | null {
  return TEMPLATES[key]?.rules ?? null;
}

// ---------------------------------------------------------------- runs and ranking

/**
 * Register a run of a pinned version. Computing it is TODO (ST-03): replay PriceDaily
 * closes (backfillCloses for the universe, FxDaily for USD rows) through the simulation
 * engine, then cache runMetrics + warnings + an input hash in `metrics`.
 */
export async function startRun(userId: string, versionId: string, input: { mode: 'BACKTEST' | 'PAPER'; startDate: Date; endDate?: Date; benchmark?: string; feeBps?: number; taxBps?: number }) {
  const v = await prisma.strategyVersion.findFirst({ where: { id: versionId, strategy: { userId } }, include: { strategy: true } });
  if (!v) throw new UserError('버전을 찾을 수 없습니다.');
  if (input.mode === 'PAPER') {
    if (v.strategy.activeVersion !== v.version) throw new UserError('채택한 버전만 페이퍼 운용할 수 있습니다.');
    const active = await prisma.strategyRun.count({ where: { userId, mode: 'PAPER', active: true } });
    if (active >= MAX_ACTIVE_PAPER) throw new UserError(`페이퍼 운용은 동시에 ${MAX_ACTIVE_PAPER}개까지입니다.`);
    if (input.startDate < v.createdAt) throw new UserError('페이퍼 운용은 버전을 만든 뒤부터 시작합니다.');
  } else if (!input.endDate || input.endDate <= input.startDate) throw new UserError('백테스트 기간을 확인하세요.');
  const run = await prisma.strategyRun.create({
    data: {
      userId,
      versionId,
      mode: input.mode,
      startDate: input.startDate,
      endDate: input.mode === 'BACKTEST' ? input.endDate : null,
      benchmark: input.benchmark ?? '069500',
      feeBps: (input.feeBps ?? 15).toFixed(2),
      taxBps: (input.taxBps ?? 0).toFixed(2),
    },
  });
  // TODO(ST-03/05): computeRun(run.id) — PAPER runs also need runDailyForUser to backfill their universe
  return run.id;
}

interface CachedMetrics {
  metrics?: RunMetrics;
  trials?: number;
  backtestSharpe?: number | null;
}

/** Latest computed run per version, ranked. Runs without cached metrics are left out. */
export async function rankingRows(userId: string) {
  const runs = await prisma.strategyRun.findMany({
    where: { userId, computedAt: { not: null }, version: { strategy: { archived: false } } },
    orderBy: { computedAt: 'desc' },
    include: { version: { select: { version: true, strategy: { select: { id: true, name: true, _count: { select: { versions: true } } } } } } },
  });
  const seen = new Set<string>();
  const inputs: (RankInput & { strategyId: string; version: number; startDate: Date; endDate: Date | null })[] = [];
  for (const r of runs) {
    const key = `${r.versionId}:${r.mode}`;
    const cached = r.metrics as CachedMetrics;
    if (seen.has(key) || !cached.metrics) continue;
    seen.add(key);
    inputs.push({
      id: r.id,
      name: r.version.strategy.name,
      mode: r.mode === 'PAPER' ? 'PAPER' : 'BACKTEST',
      metrics: cached.metrics,
      // Each saved version counts as one try unless the engine recorded more
      trials: cached.trials ?? r.version.strategy._count.versions,
      feeBps: Number(r.feeBps),
      backtestSharpe: cached.backtestSharpe ?? null,
      strategyId: r.version.strategy.id,
      version: r.version.version,
      startDate: r.startDate,
      endDate: r.endDate,
    });
  }
  return rankRuns(inputs) as (ReturnType<typeof rankRuns>[number] & (typeof inputs)[number])[];
}

// ---------------------------------------------------------------- imports

/**
 * Check philosophy text before it is imported: lint findings and, when rules JSON came
 * with it, whether they parse. Nothing is saved here.
 * TODO(ST-09/10): fetch skills.sh / GitHub raw text through skills.ts communitySkill and
 * draft rules with the MANAGER agent as a strategy_draft AiAction (in-conversation only).
 */
export function previewImport(text: string, rules?: string) {
  const lint = lintText(text.slice(0, RULE_LIMITS.principles * 2));
  return { lint, verdict: lintVerdict(lint), rules: rules ? parseRules(rules) : null, tooLong: text.length > RULE_LIMITS.principles };
}

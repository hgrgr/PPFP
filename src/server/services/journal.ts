import type { Prisma } from '@prisma/client';
import { Dec } from '@/domain/decimal';
import {
  BUILTIN_FORMATS,
  JournalInputError,
  LIMITS,
  normalizeFieldValues,
  parseFieldDefs,
  plainText,
  sanitizeContent,
  targetProgress,
  type FieldDef,
  type FieldValue,
  type JournalFormat,
  type TargetProgress,
} from '@/domain/journal';
import { dbDate, dec, kstDate, prisma } from '../db';
import { getQuotes } from '../market';
import { syncJournalAlerts } from './alerts';
import { UserError } from './portfolios';

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Domain validation errors reach the user the same way as service errors. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof JournalInputError) throw new UserError(e.message);
    throw e;
  }
}

function price(v: unknown, label: string, required: boolean): string | null {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[,\s₩$]/g, '') : '';
  if (!s) {
    if (required) throw new UserError(`${label}을(를) 입력하세요.`);
    return null;
  }
  let d: Dec;
  try {
    d = Dec.of(s);
  } catch {
    throw new UserError(`${label}에는 숫자를 입력하세요.`);
  }
  if (!d.isPos()) throw new UserError(`${label}은(는) 0보다 커야 합니다.`);
  return d.toString();
}

// ── reading ─────────────────────────────────────────

export interface JournalTxnView {
  id: string;
  type: string;
  tradeAt: string;
  qty: string | null;
  price: string | null;
  currency: string;
  portfolioName: string;
}

export interface JournalSummary {
  id: string;
  title: string;
  entryDate: string;
  status: 'OPEN' | 'CLOSED';
  assetId: string;
  assetName: string;
  symbol: string | null;
  currency: string;
  targetPrice: string;
  basePrice: string | null;
  stopPrice: string | null;
  targetDate: string | null;
  currentPrice: string | null;
  progress: TargetProgress;
  txnCount: number;
  excerpt: string;
  updatedAt: string;
}

export interface JournalAlertState {
  active: boolean;
  triggeredAt: string | null;
}

export interface JournalDetail extends JournalSummary {
  /** Price alerts on the target and the stop, null when switched off */
  alerts: { target: JournalAlertState | null; stop: JournalAlertState | null };
  template: string | null;
  fields: FieldValue[];
  content: unknown[];
  txns: JournalTxnView[];
}

const summaryInclude = { asset: true, _count: { select: { txns: true } } } satisfies Prisma.JournalEntryInclude;
type SummaryRow = Prisma.JournalEntryGetPayload<{ include: typeof summaryInclude }>;

async function quotesFor(userId: string, rows: SummaryRow[]) {
  const assets = [...new Map(rows.map((r) => [r.assetId, r.asset])).values()];
  return assets.length ? getQuotes(userId, assets).catch(() => new Map()) : new Map();
}

function toSummary(r: SummaryRow, current: Dec | null): JournalSummary {
  const target = dec(r.targetPrice).toString();
  const base = r.basePrice ? dec(r.basePrice).toString() : null;
  const cur = current ? current.toString() : null;
  return {
    id: r.id,
    title: r.title,
    entryDate: ymd(r.entryDate)!,
    status: r.status,
    assetId: r.assetId,
    assetName: r.asset.name,
    symbol: r.asset.symbol,
    currency: r.currency,
    targetPrice: target,
    basePrice: base,
    stopPrice: r.stopPrice ? dec(r.stopPrice).toString() : null,
    targetDate: ymd(r.targetDate),
    currentPrice: cur,
    progress: targetProgress(target, base, cur),
    txnCount: r._count.txns,
    excerpt: r.contentText.replace(/\s+/g, ' ').slice(0, 140),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listJournals(userId: string, filter: { assetId?: string; status?: string; q?: string } = {}): Promise<JournalSummary[]> {
  const rows = await prisma.journalEntry.findMany({
    where: {
      userId,
      assetId: filter.assetId || undefined,
      status: filter.status === 'OPEN' || filter.status === 'CLOSED' ? filter.status : undefined,
      OR: filter.q
        ? [{ title: { contains: filter.q, mode: 'insensitive' } }, { contentText: { contains: filter.q, mode: 'insensitive' } }, { asset: { name: { contains: filter.q, mode: 'insensitive' } } }]
        : undefined,
    },
    include: summaryInclude,
    orderBy: [{ entryDate: 'desc' }, { updatedAt: 'desc' }],
    take: 300,
  });
  const quotes = await quotesFor(userId, rows);
  return rows.map((r) => toSummary(r, quotes.get(r.assetId)?.price ?? null));
}

export async function getJournal(userId: string, id: string): Promise<JournalDetail | null> {
  const r = await prisma.journalEntry.findFirst({
    where: { id, userId },
    include: { ...summaryInclude, txns: { include: { transaction: { include: { portfolio: true } } } }, alerts: true },
  });
  if (!r) return null;
  const alertOf = (source: string) => {
    const a = r.alerts.find((x) => x.source === source);
    return a ? { active: a.active, triggeredAt: a.triggeredAt?.toISOString() ?? null } : null;
  };
  const quotes = await quotesFor(userId, [r]);
  return {
    ...toSummary(r, quotes.get(r.assetId)?.price ?? null),
    alerts: { target: alertOf('JOURNAL_TARGET'), stop: alertOf('JOURNAL_STOP') },
    template: r.template,
    fields: (Array.isArray(r.fields) ? r.fields : []) as unknown as FieldValue[],
    content: Array.isArray(r.content) ? (r.content as unknown[]) : [],
    txns: r.txns.map((l) => txnView(l.transaction)).sort((a, b) => b.tradeAt.localeCompare(a.tradeAt)),
  };
}

function txnView(t: Prisma.TransactionGetPayload<{ include: { portfolio: true } }>): JournalTxnView {
  return {
    id: t.id,
    type: t.type,
    tradeAt: t.tradeAt.toISOString(),
    qty: t.qty ? dec(t.qty).toString() : null,
    price: t.price ? dec(t.price).toString() : null,
    currency: t.currency,
    portfolioName: t.portfolio.name,
  };
}

/** Number of entries per asset, for the dashboard. */
export async function journalCounts(userId: string): Promise<Record<string, number>> {
  const rows = await prisma.journalEntry.groupBy({ by: ['assetId'], where: { userId }, _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.assetId, r._count._all]));
}

/** Entry ids linked to each of these transactions. */
export async function journalsByTxn(userId: string, txnIds: string[]): Promise<Map<string, string[]>> {
  const links = await prisma.journalTxn.findMany({ where: { transactionId: { in: txnIds }, entry: { userId } }, select: { transactionId: true, entryId: true } });
  const m = new Map<string, string[]>();
  for (const l of links) m.set(l.transactionId, [...(m.get(l.transactionId) ?? []), l.entryId]);
  return m;
}

/** Assets the user can write about: everything they have recorded, held ones first. */
export async function journalAssets(userId: string) {
  const assets = await prisma.asset.findMany({
    where: { userId, type: { notIn: ['CASH', 'LIABILITY'] } },
    include: { _count: { select: { holdings: true } }, traits: { include: { trait: { select: { name: true, color: true } } } } },
    orderBy: { name: 'asc' },
  });
  return assets
    .sort((a, b) => Number(b._count.holdings > 0) - Number(a._count.holdings > 0))
    .map((a) => ({ id: a.id, name: a.name, symbol: a.symbol, currency: a.currency, type: a.type, traits: a.traits.map((l) => l.trait) }));
}

/** Trades of one asset the entry can link to, newest first, with the asset's current price. */
export async function txnCandidates(userId: string, assetId: string) {
  const asset = await prisma.asset.findFirst({ where: { id: assetId, userId } });
  if (!asset) throw new UserError('종목을 찾을 수 없습니다.');
  const [txns, quotes] = await Promise.all([
    prisma.transaction.findMany({
      where: { holding: { assetId }, portfolio: { userId }, type: { in: ['BUY', 'SELL', 'DIVIDEND', 'SPLIT', 'VALUATION'] } },
      include: { portfolio: true },
      orderBy: { tradeAt: 'desc' },
      take: 200,
    }),
    getQuotes(userId, [asset]).catch(() => new Map()),
  ]);
  return { txns: txns.map(txnView), currentPrice: quotes.get(assetId)?.price.toString() ?? null, currency: asset.currency };
}

/** The asset and trade type behind a transaction, to start an entry from the transactions page. */
export async function txnContext(userId: string, txnId: string) {
  const t = await prisma.transaction.findFirst({ where: { id: txnId, portfolio: { userId } }, include: { holding: true } });
  return t?.holding ? { assetId: t.holding.assetId, type: t.type, txnId: t.id, price: t.price ? dec(t.price).toString() : null, date: kstDate(t.tradeAt) } : null;
}

// ── writing ─────────────────────────────────────────

export interface JournalInput {
  id?: string;
  assetId: string;
  title?: string;
  entryDate?: string;
  status?: string;
  targetPrice: string;
  basePrice?: string;
  stopPrice?: string;
  targetDate?: string;
  template?: string;
  fields: FieldDef[];
  values: Record<string, string>;
  content: unknown;
  txnIds: string[];
  /** Notify when the target / stop price is reached (default on) */
  alertTarget?: boolean;
  alertStop?: boolean;
}

export async function saveJournal(userId: string, input: JournalInput): Promise<string> {
  return guard(async () => {
    const asset = await prisma.asset.findFirst({ where: { id: input.assetId, userId } });
    if (!asset) throw new UserError('종목을 고르세요.');
    const existing = input.id ? await prisma.journalEntry.findFirst({ where: { id: input.id, userId }, select: { id: true } }) : null;
    if (input.id && !existing) throw new UserError('매매일지를 찾을 수 없습니다.');

    const targetPrice = price(input.targetPrice, '목표 예상 가격', true)!;
    const basePrice = price(input.basePrice, '기준 가격', false);
    const stopPrice = price(input.stopPrice, '손절가', false);
    if (input.targetDate && !isYmd(input.targetDate)) throw new UserError('목표 기한 날짜를 확인하세요.');
    if (input.entryDate && !isYmd(input.entryDate)) throw new UserError('작성일을 확인하세요.');
    const title = (input.title ?? '').trim().slice(0, LIMITS.title) || `${asset.name} 매매일지`;
    const fields = normalizeFieldValues(input.fields ?? [], input.values ?? {});
    const content = sanitizeContent(input.content);

    const txnIds = [...new Set(input.txnIds ?? [])].slice(0, 200);
    if (txnIds.length) {
      const ok = await prisma.transaction.count({ where: { id: { in: txnIds }, portfolio: { userId }, holding: { assetId: asset.id } } });
      if (ok !== txnIds.length) throw new UserError('이 종목의 거래만 연결할 수 있습니다.');
    }

    const data = {
      assetId: asset.id,
      title,
      entryDate: dbDate(input.entryDate || kstDate()),
      status: input.status === 'CLOSED' ? ('CLOSED' as const) : ('OPEN' as const),
      currency: asset.currency,
      targetPrice,
      basePrice,
      stopPrice,
      targetDate: input.targetDate ? dbDate(input.targetDate) : null,
      template: input.template?.slice(0, 60) || null,
      fields: fields as unknown as Prisma.InputJsonValue,
      content: content as Prisma.InputJsonValue,
      contentText: plainText(content),
    };
    const id = await prisma.$transaction(async (tx) => {
      const entry = existing ? await tx.journalEntry.update({ where: { id: existing.id }, data }) : await tx.journalEntry.create({ data: { ...data, userId } });
      await tx.journalTxn.deleteMany({ where: { entryId: entry.id, transactionId: { notIn: txnIds } } });
      if (txnIds.length) await tx.journalTxn.createMany({ data: txnIds.map((transactionId) => ({ entryId: entry.id, transactionId })), skipDuplicates: true });
      return entry.id;
    });
    await syncJournalAlerts(userId, id, { target: input.alertTarget !== false, stop: input.alertStop !== false });
    return id;
  });
}

/** Add blocks at the end of an entry's body (an AI review), optionally closing it. */
export async function appendToJournal(userId: string, id: string, blocks: unknown[], close = false): Promise<void> {
  const j = await prisma.journalEntry.findFirst({ where: { id, userId }, select: { content: true } });
  if (!j) throw new UserError('매매일지를 찾을 수 없습니다.');
  const content = sanitizeContent([...(Array.isArray(j.content) ? j.content : []), ...blocks]);
  await prisma.journalEntry.update({
    where: { id },
    data: { content: content as Prisma.InputJsonValue, contentText: plainText(content), ...(close ? { status: 'CLOSED' as const } : {}) },
  });
}

export async function deleteJournal(userId: string, id: string): Promise<void> {
  const r = await prisma.journalEntry.deleteMany({ where: { id, userId } });
  if (!r.count) throw new UserError('매매일지를 찾을 수 없습니다.');
}

// ── formats ─────────────────────────────────────────

/** Recommended formats followed by the user's own. */
export async function journalFormats(userId: string): Promise<(JournalFormat & { custom: boolean })[]> {
  const mine = await prisma.journalTemplate.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } });
  return [
    ...BUILTIN_FORMATS.map((f) => ({ ...f, custom: false })),
    ...mine.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? '',
      fields: (Array.isArray(t.fields) ? t.fields : []) as unknown as FieldDef[],
      content: Array.isArray(t.content) ? (t.content as unknown[]) : [],
      custom: true,
    })),
  ];
}

export async function saveTemplate(userId: string, input: { id?: string; name: string; description?: string; fields: unknown; content: unknown }): Promise<string> {
  return guard(async () => {
    const name = input.name.trim().slice(0, 60);
    if (!name) throw new UserError('양식 이름을 입력하세요.');
    const data = {
      name,
      description: input.description?.trim().slice(0, 200) || null,
      fields: parseFieldDefs(input.fields) as unknown as Prisma.InputJsonValue,
      content: sanitizeContent(input.content) as Prisma.InputJsonValue,
    };
    if (input.id) {
      const r = await prisma.journalTemplate.updateMany({ where: { id: input.id, userId }, data });
      if (!r.count) throw new UserError('양식을 찾을 수 없습니다.');
      return input.id;
    }
    if ((await prisma.journalTemplate.count({ where: { userId } })) >= 50) throw new UserError('양식은 50개까지 만들 수 있습니다.');
    return (await prisma.journalTemplate.create({ data: { ...data, userId } })).id;
  });
}

export async function deleteTemplate(userId: string, id: string): Promise<void> {
  const r = await prisma.journalTemplate.deleteMany({ where: { id, userId } });
  if (!r.count) throw new UserError('양식을 찾을 수 없습니다.');
}

// ── images ──────────────────────────────────────────

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Recognize the image from its first bytes; the browser-supplied type is not trusted. SVG is refused (it can carry script). */
export function sniffImage(b: Uint8Array): string | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

export async function saveImage(userId: string, bytes: Uint8Array): Promise<string> {
  if (bytes.length > IMAGE_MAX_BYTES) throw new UserError('이미지는 5MB까지 올릴 수 있습니다.');
  const mime = sniffImage(bytes);
  if (!mime) throw new UserError('PNG, JPEG, GIF, WebP 이미지만 올릴 수 있습니다.');
  const img = await prisma.journalImage.create({ data: { userId, mime, size: bytes.length, data: Buffer.from(bytes) } });
  return img.id;
}

export async function getImage(userId: string, id: string) {
  return prisma.journalImage.findFirst({ where: { id, userId } });
}

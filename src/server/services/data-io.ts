/**
 * Import and export of portfolios, transactions, trade journals and investment notes in the
 * format of domain/data-format: an XLSX with one sheet per kind, or a CSV per kind. Import
 * runs twice: a dry run that reports what would be added, skipped (already there) or refused,
 * then the real run. Rows already in the account are skipped, so a file can be imported again.
 */
import type { LotMethod, Prisma } from '@prisma/client';
import { parseCsv, type Column } from '@/domain/csv';
import {
  formatLinks,
  headersOf,
  IMPORT_ORDER,
  parseSheet,
  SAMPLES,
  SHEET_KEYS,
  SHEETS,
  detectSheet,
  sheetByName,
  type AssetRef,
  type LinkType,
  type Parsed,
  type RecordOf,
  type Row,
  type SheetKey,
} from '@/domain/data-format';
import { BOOK_STATUS_LABEL } from '@/domain/knowledge';
import { LOT_METHOD_LABEL } from '@/domain/lots';
import { TXN_LABEL } from '@/domain/ledger';
import { BUILTIN_FORMATS, JournalInputError, plainText, sanitizeContent, type FieldDef } from '@/domain/journal';
import { blocksToMarkdown, markdownToBlocks } from '@/domain/markdown-blocks';
import { effectiveWeights } from '@/domain/portfolio-graph';
import { dec, kstDate, kstIso, prisma } from '../db';
import { ASSET_TYPE_LABEL, createManualAsset, ensureListedAsset } from './assets';
import { saveJournal } from './journal';
import { addLink, createBook, createNote, createSage, ensureTopic } from './knowledge';
import { audit, createPortfolio, linkPortfolio, userGraph, UserError } from './portfolios';
import type { Table } from './export';
import { recordBuy, recordCash, recordSell, recordSplit, recordValuation } from './trading';


export type DataTable = Table<Row>;

const kst = (d: Date) => kstIso(d).slice(0, 16).replace('T', ' ');
const n = (v: unknown) => (v === null || v === undefined ? '' : dec(v as string).toString());
const sheetTable = (key: SheetKey, rows: Row[]): DataTable => ({
  name: SHEETS[key].name,
  columns: headersOf(key).map((h) => ({ header: h, value: (r: Row) => r[h] ?? '' })),
  rows,
  wide: ['본문', '속성', '연결', '메모', '설명', '한 줄 요약', '핵심 철학'],
});

// ---------------------------------------------------------------- export

export interface ExportScope {
  portfolioId?: string | null;
  from?: string;
  to?: string;
}

async function linkNames(userId: string) {
  const [links, books, sages, topics, traits, assets] = await Promise.all([
    prisma.knowledgeLink.findMany({ where: { userId } }),
    prisma.book.findMany({ where: { userId }, select: { id: true, title: true } }),
    prisma.sage.findMany({ where: { userId }, select: { id: true, name: true } }),
    prisma.topic.findMany({ where: { userId }, select: { id: true, name: true } }),
    prisma.trait.findMany({ where: { group: { userId } }, select: { id: true, name: true } }),
    prisma.asset.findMany({ where: { userId }, select: { id: true, name: true, symbol: true } }),
  ]);
  const names = new Map<string, string>([
    ...books.map((b) => [`book:${b.id}`, b.title] as const),
    ...sages.map((s) => [`sage:${s.id}`, s.name] as const),
    ...topics.map((t) => [`topic:${t.id}`, t.name] as const),
    ...traits.map((t) => [`trait:${t.id}`, t.name] as const),
    ...assets.map((a) => [`asset:${a.id}`, a.symbol ?? a.name] as const),
  ]);
  /** Links of one item, written as "키워드: 가치투자; …" (memos are not named, so links to them are left out) */
  return (type: string, id: string, skip: (t: string) => boolean = () => false) =>
    formatLinks(
      links
        .flatMap((l) => (l.aType === type && l.aId === id ? [[l.bType, l.bId]] : l.bType === type && l.bId === id ? [[l.aType, l.aId]] : []))
        .filter(([t, i]) => names.has(`${t}:${i}`) && !skip(t))
        .map(([t, i]) => ({ type: t as LinkType, name: names.get(`${t}:${i}`)! })),
    );
}

export async function exportSheet(userId: string, key: SheetKey, scope: ExportScope = {}): Promise<DataTable> {
  const { portfolios, edges } = await userGraph(userId);
  const ids = scope.portfolioId ? [...effectiveWeights(edges, scope.portfolioId).keys()] : portfolios.map((p) => p.id);
  const pname = new Map(portfolios.map((p) => [p.id, p.name]));
  const fromD = scope.from ? new Date(`${scope.from}T00:00:00+09:00`) : undefined;
  const toD = scope.to ? new Date(`${scope.to}T23:59:59.999+09:00`) : undefined;
  const between = fromD || toD ? { gte: fromD, lte: toD } : undefined;

  switch (key) {
    case 'portfolios': {
      const rows = portfolios
        .filter((p) => ids.includes(p.id))
        .flatMap((p) => {
          const base: Row = { 이름: p.name, 'Lot 방식': LOT_METHOD_LABEL[p.lotMethod], 보관: p.archived ? 'Y' : '' };
          const ups = edges.filter((e) => e.childId === p.id && ids.includes(e.parentId));
          return ups.length ? ups.map((e): Row => ({ ...base, '상위 포트폴리오': pname.get(e.parentId) ?? '', '할당(%)': e.allocation.mul(100).toString() })) : [base];
        });
      // Parents before children, so the file reads top-down
      const depth = (name: string, seen = new Set<string>()): number => {
        const up = rows.find((r) => r.이름 === name && r['상위 포트폴리오']);
        return up && !seen.has(name) ? 1 + depth(up['상위 포트폴리오']!, seen.add(name)) : 0;
      };
      return sheetTable('portfolios', rows.sort((a, b) => depth(a.이름) - depth(b.이름)));
    }
    case 'transactions': {
      const txns = await prisma.transaction.findMany({ where: { portfolioId: { in: ids }, tradeAt: between }, include: { holding: { include: { asset: true } } }, orderBy: [{ tradeAt: 'asc' }, { createdAt: 'asc' }] });
      const rows = txns.map((t): Row => {
        const a = t.holding?.asset;
        const manual = a && !a.symbol;
        const cashOnly = !['BUY', 'SELL', 'SPLIT', 'VALUATION'].includes(t.type);
        return {
          일시: kst(t.tradeAt),
          포트폴리오: pname.get(t.portfolioId) ?? '',
          유형: TXN_LABEL[t.type],
          종목코드: a?.symbol ?? '',
          '자산 이름': a?.name ?? '',
          '자산 유형': manual ? ASSET_TYPE_LABEL[a.type] : '',
          통화: t.currency,
          수량: t.type === 'SPLIT' ? n(t.splitRatio) : n(t.qty),
          단가: n(t.price),
          금액: cashOnly ? dec(t.cashDelta).abs().toString() : '',
          수수료: t.type === 'BUY' || t.type === 'SELL' ? n(t.fee) : '',
          세금: t.type === 'BUY' || t.type === 'SELL' ? n(t.tax) : '',
          환율: t.currency === 'KRW' ? '' : n(t.fxRate),
          '현금 사용': t.type === 'BUY' || t.type === 'SELL' ? (dec(t.cashDelta).isZero() && !dec(t.flow).isZero() ? 'N' : 'Y') : '',
          'Lot 방식': t.lotMethod ? LOT_METHOD_LABEL[t.lotMethod] : '',
          메모: t.memo ?? '',
          '거래 ID': t.externalRef?.startsWith('ppfp:') ? t.externalRef.slice(5) : t.id,
        };
      });
      return sheetTable('transactions', rows);
    }
    case 'journals': {
      const entries = await prisma.journalEntry.findMany({ where: { userId, entryDate: between }, include: { asset: true }, orderBy: { entryDate: 'asc' } });
      const formats = await prisma.journalTemplate.findMany({ where: { userId }, select: { id: true, name: true } });
      const formatName = (t: string | null) => BUILTIN_FORMATS.find((f) => f.id === t)?.name ?? formats.find((f) => f.id === t)?.name ?? '';
      return sheetTable(
        'journals',
        entries.map((e) => ({
          제목: e.title,
          종목코드: e.asset.symbol ?? '',
          '자산 이름': e.asset.name,
          통화: e.currency,
          작성일: kstDate(e.entryDate),
          상태: e.status === 'CLOSED' ? '종료' : '진행 중',
          '목표 예상 가격': n(e.targetPrice),
          '기준 가격': n(e.basePrice),
          손절가: n(e.stopPrice),
          '목표 기한': e.targetDate ? kstDate(e.targetDate) : '',
          양식: formatName(e.template),
          속성: (Array.isArray(e.fields) ? (e.fields as { label: string; value: string }[]) : []).filter((f) => f.value).map((f) => `${f.label}: ${f.value}`).join('\n'),
          본문: blocksToMarkdown(e.content),
          '일지 ID': e.id,
        })),
      );
    }
    case 'notes': {
      const links = await linkNames(userId);
      const notes = await prisma.note.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
      // Keywords written as #tags in the body link themselves again on import
      return sheetTable(
        'notes',
        notes.map((x) => ({ 작성일: kstDate(x.createdAt), 본문: x.body, 고정: x.pinned ? 'Y' : '', 연결: links('note', x.id) })),
      );
    }
    case 'books': {
      const links = await linkNames(userId);
      const books = await prisma.book.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
      return sheetTable(
        'books',
        books.map((b) => ({
          제목: b.title,
          저자: b.author ?? '',
          출판사: b.publisher ?? '',
          '출간 연도': b.publishedYear ? String(b.publishedYear) : '',
          상태: BOOK_STATUS_LABEL[b.status],
          별점: b.rating ? String(b.rating) : '',
          '읽기 시작': b.startedAt ? kstDate(b.startedAt) : '',
          '다 읽은 날': b.finishedAt ? kstDate(b.finishedAt) : '',
          '한 줄 요약': b.oneLine ?? '',
          본문: blocksToMarkdown(b.content),
          연결: links('book', b.id),
        })),
      );
    }
    case 'sages': {
      const links = await linkNames(userId);
      const sages = await prisma.sage.findMany({ where: { userId }, orderBy: { name: 'asc' } });
      return sheetTable(
        'sages',
        sages.map((s) => ({ 이름: s.name, '영문 이름': s.nameEn ?? '', 생몰: s.lived ?? '', 소속: s.affiliation ?? '', '핵심 철학': s.oneLine ?? '', 본문: blocksToMarkdown(s.content), 연결: links('sage', s.id, (t) => t === 'book') })),
      );
    }
    case 'topics': {
      const links = await linkNames(userId);
      const topics = await prisma.topic.findMany({ where: { userId }, orderBy: { name: 'asc' } });
      // A topic's links to books, investors and notes are written on their rows
      return sheetTable(
        'topics',
        topics.map((t) => ({ 이름: t.name, 색: t.color, 설명: t.description ?? '', 연결: links('topic', t.id, (k) => k !== 'trait' && k !== 'asset') })),
      );
    }
  }
}

/** The 안내 sheet: what each sheet and column holds. */
export function guideTable(): DataTable {
  const rows: Row[] = [];
  for (const key of SHEET_KEYS) {
    const s = SHEETS[key];
    rows.push({ 시트: s.name, 열: '', 필수: '', 설명: s.about });
    for (const c of s.columns) rows.push({ 시트: '', 열: c.header, 필수: c.required ? '필수' : '', 설명: c.note });
  }
  return {
    name: '안내',
    columns: ['시트', '열', '필수', '설명'].map((h) => ({ header: h, value: (r: Row) => r[h] ?? '' })),
    rows,
    wide: ['설명'],
  };
}

export const sampleTable = (key: SheetKey): DataTable => sheetTable(key, SAMPLES[key]);

// ---------------------------------------------------------------- reading a file

export interface SheetRows {
  key: SheetKey;
  /** Sheet or file name, for messages */
  source: string;
  rows: Row[];
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // Excel dates carry no zone: read the wall-clock time as written
    const iso = v.toISOString();
    return iso.slice(11, 16) === '00:00' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  }
  if (typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; text?: unknown; result?: unknown; hyperlink?: string };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join('');
    if ('result' in o) return cellText(o.result);
    if ('text' in o) return cellText(o.text);
    return '';
  }
  return String(v);
}

function toRows(table: string[][]): { headers: string[]; rows: Row[] } {
  const [head = [], ...body] = table;
  const headers = head.map((h) => h.trim());
  return { headers, rows: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))) };
}

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 20_000;

/** Sheets in an uploaded XLSX or CSV. A CSV's kind is found from its header unless given. */
export async function readUpload(file: File, forced?: SheetKey | null): Promise<{ sheets: SheetRows[]; ignored: string[] }> {
  if (file.size > MAX_BYTES) throw new UserError('파일은 10MB까지 올릴 수 있습니다.');
  const name = file.name || '파일';
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isXlsx = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const sheets: SheetRows[] = [];
  const ignored: string[] = [];
  if (isXlsx) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    } catch {
      throw new UserError('XLSX 파일을 읽지 못했습니다.');
    }
    for (const ws of wb.worksheets) {
      const table: string[][] = [];
      ws.eachRow({ includeEmpty: true }, (row, i) => {
        const values = (row.values as unknown[]).slice(1).map(cellText);
        table[i - 1] = values;
      });
      for (let i = 0; i < table.length; i++) table[i] ??= [];
      const { headers, rows } = toRows(table);
      const key = sheetByName(ws.name) ?? detectSheet(headers) ?? (wb.worksheets.length === 1 ? forced : null);
      if (!key) {
        if (ws.name !== '안내') ignored.push(ws.name);
        continue;
      }
      sheets.push({ key, source: ws.name, rows });
    }
  } else {
    const text = new TextDecoder('utf-8').decode(bytes);
    const { headers, rows } = toRows(parseCsv(text));
    const key = forced ?? detectSheet(headers);
    if (!key) throw new UserError('어떤 데이터인지 알 수 없는 CSV입니다. 첫 줄의 열 이름을 샘플과 맞추거나, 가져올 데이터 종류를 고르세요.');
    sheets.push({ key, source: name, rows });
  }
  if (!sheets.length) throw new UserError('가져올 시트를 찾지 못했습니다. 시트 이름이나 첫 줄의 열 이름을 샘플과 맞추세요.');
  if (sheets.reduce((s, x) => s + x.rows.length, 0) > MAX_ROWS) throw new UserError(`한 번에 ${MAX_ROWS.toLocaleString('ko-KR')}줄까지 가져올 수 있습니다. 파일을 나누어 주세요.`);
  return { sheets, ignored };
}

// ---------------------------------------------------------------- import

export interface Issue {
  line: number;
  message: string;
}

export interface SheetReport {
  key: SheetKey;
  name: string;
  source: string;
  rows: number;
  added: number;
  skipped: number;
  /** Rows refused */
  errors: Issue[];
  /** Imported, with something left out (a link to a missing item) */
  warnings: Issue[];
  skippedLines: Issue[];
}

export interface ImportReport {
  committed: boolean;
  sheets: SheetReport[];
  ignored: string[];
  transactions: number;
}

/** Things looked up by name while importing, filled as new ones are made. */
interface Ctx {
  userId: string;
  commit: boolean;
  portfolios: Map<string, { id: string; lotMethod: LotMethod }>;
  /** symbol or "type|name" -> asset */
  assets: Map<string, { id: string; currency: string; manual: boolean }>;
  /** portfolioId|assetId -> holding id and open quantity (simulated in a dry run) */
  holdings: Map<string, { id: string | null; qty: number }>;
  linkQueue: { ref: { type: 'note' | 'book' | 'sage' | 'topic'; id: string }; links: { type: LinkType; name: string }[]; report: SheetReport; line: number }[];
}

const assetKey = (a: AssetRef) => (a.symbol ? a.symbol : `${a.type}|${a.name}`);

async function loadCtx(userId: string, commit: boolean): Promise<Ctx> {
  const [portfolios, assets, holdings] = await Promise.all([
    prisma.portfolio.findMany({ where: { userId }, select: { id: true, name: true, lotMethod: true } }),
    prisma.asset.findMany({ where: { userId }, select: { id: true, symbol: true, name: true, type: true, currency: true, priceSource: true } }),
    prisma.holding.findMany({ where: { portfolio: { userId } }, include: { lots: { where: { qtyRemaining: { gt: 0 } }, select: { qtyRemaining: true } } } }),
  ]);
  return {
    userId,
    commit,
    portfolios: new Map(portfolios.map((p) => [p.name, { id: p.id, lotMethod: p.lotMethod }])),
    assets: new Map(assets.map((a) => [a.symbol ?? `${a.type}|${a.name}`, { id: a.id, currency: a.currency, manual: a.priceSource === 'MANUAL' }])),
    holdings: new Map(holdings.map((h) => [`${h.portfolioId}|${h.assetId}`, { id: h.id, qty: h.lots.reduce((s, l) => s + Number(l.qtyRemaining), 0) }])),
    linkQueue: [],
  };
}

let fakeIds = 0;
const fakeId = (p: string) => `${p}-dry-${++fakeIds}`;

async function portfolioFor(ctx: Ctx, name: string) {
  const had = ctx.portfolios.get(name);
  if (had) return had;
  const made = ctx.commit ? await createPortfolio(ctx.userId, { name }) : { id: fakeId('portfolio'), lotMethod: 'FIFO' as LotMethod };
  const p = { id: made.id, lotMethod: (made as { lotMethod?: LotMethod }).lotMethod ?? 'FIFO' };
  ctx.portfolios.set(name, p);
  return p;
}

async function assetFor(ctx: Ctx, ref: AssetRef) {
  const k = assetKey(ref);
  const had = ctx.assets.get(k);
  if (had) {
    if (had.currency !== ref.currency) throw new UserError(`'${ref.symbol ?? ref.name}'은(는) 이미 ${had.currency} 자산으로 있습니다.`);
    return had;
  }
  let made: { id: string; currency: string; manual: boolean };
  if (!ref.symbol) {
    made = ctx.commit ? { ...(await createManualAsset(ctx.userId, { type: ref.type!, name: ref.name!, currency: ref.currency })), manual: true } : { id: fakeId('asset'), currency: ref.currency, manual: true };
  } else if (ctx.commit) {
    const a = await ensureListedAsset(ctx.userId, ref.symbol, ref.name ? { name: ref.name, currency: ref.currency, market: null } : undefined);
    made = { id: a.id, currency: a.currency, manual: a.priceSource === 'MANUAL' };
  } else {
    // A dry run does not ask the brokers; a symbol without a name is checked when importing
    made = { id: fakeId('asset'), currency: ref.currency, manual: false };
  }
  ctx.assets.set(k, made);
  return made;
}

function report(key: SheetKey, source: string, rows: number): SheetReport {
  return { key, name: SHEETS[key].name, source, rows, added: 0, skipped: 0, errors: [], warnings: [], skippedLines: [] };
}

/** Runs `fn` for a row, recording a refusal instead of stopping. */
async function attempt(r: SheetReport, line: number, fn: () => Promise<'added' | 'skipped' | { skipped: string }>) {
  try {
    const res = await fn();
    if (res === 'added') r.added++;
    else {
      r.skipped++;
      r.skippedLines.push({ line, message: typeof res === 'object' ? res.skipped : '이미 있음' });
    }
  } catch (e) {
    // Validation messages from the services are for people; anything else stays in the server log
    const told = e instanceof UserError || e instanceof JournalInputError;
    const msg = told ? e.message : '저장하지 못했습니다. 값을 확인하세요.';
    if (!told) console.error('[import] row failed', r.key, line, e);
    r.errors.push({ line, message: msg });
  }
}

type Records<K extends SheetKey> = { line: number; record: RecordOf<K> }[];

async function importPortfolios(ctx: Ctx, rep: SheetReport, rows: Records<'portfolios'>) {
  const { edges } = await userGraph(ctx.userId);
  const edgeSet = new Set(edges.map((e) => `${e.parentId}|${e.childId}`));
  for (const { line, record: p } of rows) {
    await attempt(rep, line, async () => {
      const existed = ctx.portfolios.has(p.name);
      const self = await portfolioFor(ctx, p.name);
      if (!existed && ctx.commit && (p.lotMethod || p.archived)) {
        await prisma.portfolio.update({ where: { id: self.id }, data: { ...(p.lotMethod ? { lotMethod: p.lotMethod } : {}), archived: p.archived } });
        if (p.lotMethod) self.lotMethod = p.lotMethod;
      }
      let linked = false;
      if (p.parent) {
        if (p.parent === p.name) throw new UserError('자기 자신을 상위 포트폴리오로 둘 수 없습니다.');
        const parent = await portfolioFor(ctx, p.parent);
        if (!edgeSet.has(`${parent.id}|${self.id}`)) {
          if (ctx.commit) await linkPortfolio(ctx.userId, parent.id, self.id, String(Number(p.allocation) / 100));
          edgeSet.add(`${parent.id}|${self.id}`);
          linked = true;
        }
      }
      return existed && !linked ? 'skipped' : 'added';
    });
  }
}

const sameNum = (a: unknown, b: string | undefined) => (a === null || a === undefined ? !b : !!b && Number(a) === Number(b));

async function importTransactions(ctx: Ctx, rep: SheetReport, rows: Records<'transactions'>) {
  const existing = await prisma.transaction.findMany({ where: { portfolio: { userId: ctx.userId } }, select: { id: true, externalRef: true, portfolioId: true, type: true, tradeAt: true, qty: true, price: true, cashDelta: true, splitRatio: true, holding: { select: { assetId: true } } } });
  const ids = new Set(existing.flatMap((t) => [t.id, ...(t.externalRef?.startsWith('ppfp:') ? [t.externalRef.slice(5)] : [])]));
  // Oldest first, so sales find the lots bought before them
  const sorted = [...rows].sort((a, b) => a.record.at.getTime() - b.record.at.getTime() || a.line - b.line);
  for (const { line, record: t } of sorted) {
    await attempt(rep, line, async () => {
      if (t.id && ids.has(t.id)) return { skipped: '이미 있는 거래 ID' };
      const portfolio = await portfolioFor(ctx, t.portfolio);
      const asset = t.asset ? await assetFor(ctx, t.asset) : null;
      const hKey = asset ? `${portfolio.id}|${asset.id}` : null;
      const holding = hKey ? ctx.holdings.get(hKey) : undefined;
      const dup = existing.find(
        (x) =>
          x.portfolioId === portfolio.id &&
          x.type === t.type &&
          x.tradeAt.getTime() === t.at.getTime() &&
          (x.holding?.assetId ?? null) === (asset?.id ?? null) &&
          (t.type === 'SPLIT' ? sameNum(x.splitRatio, t.qty) : sameNum(x.qty, t.qty)) &&
          sameNum(x.price, t.price) &&
          (!t.amount || Math.abs(Number(x.cashDelta)) === Number(t.amount)),
      );
      if (dup) return { skipped: '같은 날짜·종목·수량의 거래가 이미 있음' };
      const externalRef = t.id ? `ppfp:${t.id}` : undefined;
      const common = { tradeAt: t.at, fee: t.fee, tax: t.tax, fxRate: t.fxRate, memo: t.memo, externalRef };
      if (t.type === 'BUY') {
        if (ctx.commit) {
          const txn = await recordBuy(ctx.userId, { ...common, portfolioId: portfolio.id, assetId: asset!.id, qty: t.qty!, price: t.price!, fromCash: t.useCash });
          ctx.holdings.set(hKey!, { id: txn.holdingId, qty: (holding?.qty ?? 0) + Number(t.qty) });
        } else ctx.holdings.set(hKey!, { id: holding?.id ?? null, qty: (holding?.qty ?? 0) + Number(t.qty) });
      } else if (t.type === 'SELL') {
        if (!holding || holding.qty + 1e-9 < Number(t.qty)) throw new UserError(`팔 수량(${t.qty})이 그때 보유한 수량(${holding?.qty ?? 0})보다 많습니다.`);
        const method = t.lotMethod ?? (portfolio.lotMethod === 'SPECIFIC' ? 'FIFO' : portfolio.lotMethod);
        if (method === 'SPECIFIC') throw new UserError('가져오기에서는 직접 선택 방식을 쓸 수 없습니다. 다른 Lot 방식을 고르세요.');
        if (ctx.commit) await recordSell(ctx.userId, { ...common, holdingId: holding.id!, qty: t.qty!, price: t.price!, method, toCash: t.useCash });
        holding.qty -= Number(t.qty);
      } else if (t.type === 'SPLIT' || t.type === 'VALUATION') {
        if (!holding) throw new UserError('이 포트폴리오에 그 종목이 없습니다. 매수 줄을 먼저 넣으세요.');
        if (t.type === 'VALUATION' && !asset!.manual) throw new UserError('시세가 자동으로 들어오는 종목은 평가 갱신을 가져오지 않습니다.');
        if (ctx.commit) {
          const txn = t.type === 'SPLIT' ? await recordSplit(ctx.userId, { holdingId: holding.id!, ratio: t.qty!, tradeAt: t.at, memo: t.memo }) : await recordValuation(ctx.userId, { holdingId: holding.id!, price: t.price!, tradeAt: t.at, memo: t.memo });
          if (externalRef) await prisma.transaction.update({ where: { id: txn.id }, data: { externalRef } });
        }
        if (t.type === 'SPLIT') holding.qty *= Number(t.qty);
      } else {
        if (t.asset && !holding) rep.warnings.push({ line, message: '이 포트폴리오에 그 종목이 없어 종목 없이 기록합니다' });
        if (ctx.commit) await recordCash(ctx.userId, { portfolioId: portfolio.id, type: t.type, amount: t.amount!, currency: t.asset?.currency ?? (t.fxRate ? 'USD' : 'KRW'), tradeAt: t.at, holdingId: holding?.id ?? undefined, fxRate: t.fxRate, memo: t.memo, externalRef });
      }
      if (t.id) ids.add(t.id);
      return 'added';
    });
  }
}

async function importTopics(ctx: Ctx, rep: SheetReport, rows: Records<'topics'>) {
  for (const { line, record: t } of rows) {
    await attempt(rep, line, async () => {
      const had = await prisma.topic.findUnique({ where: { userId_name: { userId: ctx.userId, name: t.name } } });
      if (had) {
        ctx.linkQueue.push({ ref: { type: 'topic', id: had.id }, links: t.links, report: rep, line });
        return 'skipped';
      }
      if (ctx.commit) {
        const id = await ensureTopic(ctx.userId, t.name);
        await prisma.topic.update({ where: { id }, data: { ...(t.color ? { color: t.color } : {}), description: t.description || null } });
        ctx.linkQueue.push({ ref: { type: 'topic', id }, links: t.links, report: rep, line });
      }
      return 'added';
    });
  }
}

const doc = (md: string) => {
  const content = sanitizeContent(markdownToBlocks(md));
  return { content: content as Prisma.InputJsonValue, contentText: plainText(content) };
};

async function importSages(ctx: Ctx, rep: SheetReport, rows: Records<'sages'>) {
  for (const { line, record: s } of rows) {
    await attempt(rep, line, async () => {
      const had = await prisma.sage.findUnique({ where: { userId_name: { userId: ctx.userId, name: s.name } } });
      if (had) {
        ctx.linkQueue.push({ ref: { type: 'sage', id: had.id }, links: s.links, report: rep, line });
        return 'skipped';
      }
      if (ctx.commit) {
        const id = await createSage(ctx.userId, s.name);
        await prisma.sage.update({
          where: { id },
          data: { nameEn: s.nameEn || null, lived: s.lived || null, affiliation: s.affiliation || null, oneLine: s.oneLine || null, ...(s.body ? doc(s.body) : {}) },
        });
        ctx.linkQueue.push({ ref: { type: 'sage', id }, links: s.links, report: rep, line });
      }
      return 'added';
    });
  }
}

async function importBooks(ctx: Ctx, rep: SheetReport, rows: Records<'books'>) {
  for (const { line, record: b } of rows) {
    await attempt(rep, line, async () => {
      const had = await prisma.book.findFirst({ where: { userId: ctx.userId, title: b.title } });
      if (had) {
        ctx.linkQueue.push({ ref: { type: 'book', id: had.id }, links: b.links, report: rep, line });
        return 'skipped';
      }
      if (ctx.commit) {
        const id = await createBook(ctx.userId, b.title, { author: b.author, publisher: b.publisher, year: b.year ? Number(b.year) : null });
        await prisma.book.update({
          where: { id },
          data: {
            status: b.status,
            rating: b.rating ? Number(b.rating) : null,
            startedAt: b.startedAt ? new Date(b.startedAt) : null,
            finishedAt: b.finishedAt ? new Date(b.finishedAt) : null,
            oneLine: b.oneLine.slice(0, 300) || null,
            ...(b.body ? doc(b.body) : {}),
          },
        });
        ctx.linkQueue.push({ ref: { type: 'book', id }, links: b.links, report: rep, line });
      }
      return 'added';
    });
  }
}

async function importNotes(ctx: Ctx, rep: SheetReport, rows: Records<'notes'>) {
  for (const { line, record: x } of rows) {
    await attempt(rep, line, async () => {
      const had = await prisma.note.findFirst({ where: { userId: ctx.userId, body: x.body } });
      if (had) {
        ctx.linkQueue.push({ ref: { type: 'note', id: had.id }, links: x.links, report: rep, line });
        return 'skipped';
      }
      if (ctx.commit) {
        const id = await createNote(ctx.userId, x.body);
        await prisma.note.update({ where: { id }, data: { pinned: x.pinned, ...(x.date ? { createdAt: new Date(`${x.date}T12:00:00+09:00`) } : {}) } });
        ctx.linkQueue.push({ ref: { type: 'note', id }, links: x.links, report: rep, line });
      }
      return 'added';
    });
  }
}

async function importJournals(ctx: Ctx, rep: SheetReport, rows: Records<'journals'>) {
  const custom = await prisma.journalTemplate.findMany({ where: { userId: ctx.userId } });
  for (const { line, record: j } of rows) {
    await attempt(rep, line, async () => {
      if (j.id && (await prisma.journalEntry.findFirst({ where: { id: j.id, userId: ctx.userId }, select: { id: true } }))) return { skipped: '이미 있는 일지 ID' };
      const asset = await assetFor(ctx, j.asset);
      if (await prisma.journalEntry.findFirst({ where: { userId: ctx.userId, assetId: asset.id, title: j.title, ...(j.entryDate ? { entryDate: new Date(j.entryDate) } : {}) }, select: { id: true } })) {
        return { skipped: '같은 종목·제목의 일지가 이미 있음' };
      }
      const builtin = BUILTIN_FORMATS.find((f) => f.name === j.format);
      const mine = custom.find((f) => f.name === j.format);
      if (j.format && !builtin && !mine) rep.warnings.push({ line, message: `양식 '${j.format}'이(가) 없어 양식 없이 가져옵니다` });
      const defs: FieldDef[] = [...((builtin?.fields ?? (mine?.fields as unknown as FieldDef[] | undefined)) ?? [])];
      const values: Record<string, string> = {};
      for (const p of j.props) {
        let d = defs.find((x) => x.label === p.label);
        if (!d) {
          d = { key: `p${defs.length + 1}`, label: p.label.slice(0, 40), type: 'text' };
          defs.push(d);
        }
        values[d.key] = p.value;
      }
      if (ctx.commit) {
        await saveJournal(ctx.userId, {
          assetId: asset.id,
          title: j.title,
          entryDate: j.entryDate,
          status: j.closed ? 'CLOSED' : 'OPEN',
          targetPrice: j.targetPrice,
          basePrice: j.basePrice,
          stopPrice: j.stopPrice,
          targetDate: j.targetDate,
          template: builtin?.id ?? mine?.id,
          fields: defs,
          values,
          content: markdownToBlocks(j.body),
          txnIds: [],
          // Price alerts only for entries still open
          alertTarget: !j.closed,
          alertStop: !j.closed,
        });
      }
      return 'added';
    });
  }
}

/** Second pass: link imported items to keywords, investors, books, stocks and traits by name. */
async function importLinks(ctx: Ctx) {
  if (!ctx.commit) return;
  const find = async (type: LinkType, name: string): Promise<string | null> => {
    const u = ctx.userId;
    switch (type) {
      case 'topic':
        return ensureTopic(u, name);
      case 'sage':
        return (await prisma.sage.findFirst({ where: { userId: u, name } }))?.id ?? null;
      case 'book':
        return (await prisma.book.findFirst({ where: { userId: u, title: name } }))?.id ?? null;
      case 'asset':
        return (await prisma.asset.findFirst({ where: { userId: u, OR: [{ symbol: name.toUpperCase() }, { name }] } }))?.id ?? null;
      case 'trait':
        return (await prisma.trait.findFirst({ where: { name, group: { userId: u } } }))?.id ?? null;
      default:
        return null;
    }
  };
  for (const q of ctx.linkQueue) {
    for (const l of q.links) {
      const id = await find(l.type, l.name);
      if (!id) {
        const what = ({ topic: '키워드', sage: '투자 거장', book: '책', asset: '종목', trait: '자산 성질', note: '메모' } as const)[l.type];
        const hint = l.type === 'trait' ? '. 자산 성질 화면에서 그 분류를 추가한 뒤 같은 파일을 다시 가져오면 연결됩니다' : '';
        q.report.warnings.push({ line: q.line, message: `연결할 ${what} '${l.name}'이(가) 없어 연결하지 않았습니다${hint}` });
        continue;
      }
      try {
        await addLink(ctx.userId, q.ref, { type: l.type, id });
      } catch (e) {
        q.report.warnings.push({ line: q.line, message: e instanceof UserError ? e.message : '연결하지 못했습니다' });
      }
    }
  }
}

/** Checks (commit = false) or imports (commit = true) the sheets read from a file. */
export async function importData(userId: string, input: { sheets: SheetRows[]; ignored: string[] }, commit: boolean): Promise<ImportReport> {
  const ctx = await loadCtx(userId, commit);
  const reports: SheetReport[] = [];
  const byKey = new Map<SheetKey, { rep: SheetReport; parsed: Parsed<SheetKey>[] }>();
  for (const s of input.sheets) {
    const parsed = parseSheet(s.key, s.rows);
    const rep = report(s.key, s.source, parsed.length);
    for (const p of parsed) if (p.error) rep.errors.push({ line: p.line, message: p.error });
    const had = byKey.get(s.key);
    if (had) {
      // Two files of the same kind: one report
      had.parsed.push(...parsed);
      had.rep.rows += rep.rows;
      had.rep.errors.push(...rep.errors);
    } else {
      byKey.set(s.key, { rep, parsed });
      reports.push(rep);
    }
  }
  for (const key of IMPORT_ORDER) {
    const s = byKey.get(key);
    if (!s) continue;
    const ok = s.parsed.filter((p) => p.record).map((p) => ({ line: p.line, record: p.record! }));
    const run = { portfolios: importPortfolios, transactions: importTransactions, topics: importTopics, sages: importSages, books: importBooks, notes: importNotes, journals: importJournals }[key] as (c: Ctx, r: SheetReport, rows: typeof ok) => Promise<void>;
    await run(ctx, s.rep, ok);
  }
  await importLinks(ctx);
  for (const r of reports) {
    r.errors.sort((a, b) => a.line - b.line);
    r.warnings.sort((a, b) => a.line - b.line);
    r.skippedLines.sort((a, b) => a.line - b.line);
  }
  const transactions = reports.find((r) => r.key === 'transactions')?.added ?? 0;
  if (commit) {
    await audit(prisma, userId, 'import', 'data', 'import', undefined, { sheets: reports.map((r) => ({ key: r.key, rows: r.rows, added: r.added, skipped: r.skipped, errors: r.errors.length })) });
  }
  return { committed: commit, sheets: reports, ignored: input.ignored, transactions };
}

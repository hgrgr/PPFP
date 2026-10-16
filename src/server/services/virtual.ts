/**
 * 가상 포트폴리오: the user's paper portfolios (VirtualPortfolio/VirtualPosition only — never the
 * real Portfolio/Holding/Lot/Transaction tables), valued from Yahoo Finance histories and the
 * 한국부동산원 apartment price index, in won.
 */
import { parseYahooHistory } from '@/domain/benchmark';
import { regionReqs, regionSeries, roneRegion, RONE_REGIONS } from '@/domain/region-analysis';
import { BENCHMARKS, cleanFx, dropSpikes, KIND_LABEL, PRESETS, KINDS, MARKET_KINDS, maxDrawdown, portfolioPath, toKrw, valuePosition, weekdays, type Close, type VKind, type VPosition } from '@/domain/virtual';
import { yahooSymbols } from '@/domain/market-overview';
import { dbDate, kstDate, prisma } from '../db';
import { noteCall, outcomeOf } from './api-usage';
import { refreshSeries, readSeries } from './indicators';
import { findCorp } from './dart';
import { UserError } from './portfolios';

const HOUR = 3_600_000;
const FX = 'KRW=X';

interface History {
  at: number;
  from: string;
  closes: Close[];
  currency: string;
  name: string;
}
const histories = new Map<string, History>();

/** Daily closes (weekly before the last 12 years) since `from`, with the symbol's currency and name */
async function history(userId: string, symbol: string, from: string): Promise<History | null> {
  const hit = histories.get(symbol);
  if (hit && Date.now() - hit.at < 6 * HOUR && hit.from <= from) return hit;
  const start = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000) - 30 * 86_400;
  const old = Date.parse(`${from}T00:00:00Z`) < Date.now() - 12 * 365 * 86_400_000;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${Math.floor(Date.now() / 1000) + 86_400}&interval=${old ? '1wk' : '1d'}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (PPFP)' }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    noteCall(userId, 'yahoo', 'error');
    throw e;
  }
  noteCall(userId, 'yahoo', outcomeOf(res.status));
  if (!res.ok) return null;
  const body = (await res.json()) as { chart?: { result?: { meta?: { currency?: string; longName?: string; shortName?: string } }[] } };
  const closes = dropSpikes(parseYahooHistory(body));
  if (!closes.length) return null;
  const meta = body.chart?.result?.[0]?.meta;
  const h: History = { at: Date.now(), from, closes, currency: (meta?.currency ?? 'USD').toUpperCase(), name: meta?.longName ?? meta?.shortName ?? symbol };
  histories.set(symbol, h);
  return h;
}

/** A market symbol in won (dollar and other quotes converted with the day's rate) */
async function krwSeries(userId: string, symbol: string, from: string): Promise<{ closes: Close[]; currency: string } | null> {
  const h = await history(userId, symbol, from);
  if (!h) return null;
  if (h.currency === 'KRW') return { closes: h.closes, currency: 'KRW' };
  if (h.currency !== 'USD') {
    const fx = await history(userId, `${h.currency}KRW=X`, from);
    return fx ? { closes: toKrw(h.closes, cleanFx(fx.closes)), currency: h.currency } : null;
  }
  const fx = await history(userId, FX, from);
  return fx ? { closes: toKrw(h.closes, cleanFx(fx.closes)), currency: 'USD' } : null;
}

/** An index in won for comparisons (dollar indices converted with the day's rate) */
export async function benchmarkSeries(userId: string, symbol: string, from: string): Promise<Close[] | null> {
  return (await krwSeries(userId, symbol, from))?.closes ?? null;
}

/** A region's monthly apartment price index (한국부동산원) */
async function regionIndex(userId: string, key: string): Promise<Close[] | null> {
  const r = roneRegion(key);
  if (!r) return null;
  const reqs = regionReqs(r, ['price']);
  await refreshSeries(userId, reqs);
  const id = regionSeries(r, ['price']).price?.id;
  if (!id) return null;
  return ((await readSeries([id])).get(id) ?? []).map((p) => ({ date: p.date, close: p.value }));
}

export interface Resolved {
  symbol: string;
  name: string;
  currency: string;
}

/** What the user typed → a priced symbol: a Yahoo symbol, a KRX code, a Korean company name, or (for 부동산) a region */
export async function resolveSymbol(userId: string, kind: VKind, q: string): Promise<Resolved> {
  const text = q.trim();
  if (!text) throw new UserError('종목이나 지역을 넣으세요.');
  if (kind === 'REAL_ESTATE') {
    const r = roneRegion(text) ?? RONE_REGIONS.find((x) => x.label === text) ?? RONE_REGIONS.find((x) => x.label.replace(/\s/g, '').includes(text.replace(/\s/g, '')));
    if (!r) throw new UserError(`'${text}'에 맞는 지역이 없습니다. 지역 분석의 지역 이름(예: 서울 강남구, 경기 성남시 분당구)으로 넣으세요.`);
    return { symbol: r.key, name: `${r.label} 아파트`, currency: 'KRW' };
  }
  let candidates: string[];
  if (/[가-힣]/.test(text)) {
    const corp = await findCorp(userId, text).catch(() => null);
    if (!corp) throw new UserError(`'${text}'를 찾지 못했습니다. 종목코드(005930)나 티커(AAPL)로 넣어 보세요.`);
    candidates = [`${corp.stock}.KS`, `${corp.stock}.KQ`];
  } else if (/^A?[0-9][0-9A-Z]{5}$/i.test(text)) candidates = yahooSymbols(text.replace(/^A/i, ''), null);
  else candidates = [text.toUpperCase().replace(/\.(?=[A-Z]$)/, '-')];
  for (const c of candidates) {
    const h = await history(userId, c, kstDate(new Date(Date.now() - 30 * 86_400_000))).catch(() => null);
    const preset = Object.values(PRESETS).flat().find((x) => x?.symbol === c);
    if (h) return { symbol: c, name: preset?.name ?? h.name, currency: h.currency };
  }
  throw new UserError(`'${text}'의 시세를 Yahoo Finance에서 찾지 못했습니다. 티커를 확인하세요(한국 종목은 6자리 코드, 선물은 GC=F처럼).`);
}

// ------------------------------------------------------------------ CRUD

const toPos = (x: { id: string; kind: string; name: string; buyDate: Date; sellDate: Date | null; mode: string; amount: unknown; qty: unknown; rate: unknown }): VPosition => ({
  id: x.id,
  kind: x.kind as VKind,
  name: x.name,
  buyDate: x.buyDate.toISOString().slice(0, 10),
  sellDate: x.sellDate ? x.sellDate.toISOString().slice(0, 10) : null,
  mode: x.mode === 'QTY' ? 'QTY' : 'AMOUNT',
  amount: x.amount === null ? null : Number(x.amount),
  qty: x.qty === null ? null : Number(x.qty),
  rate: x.rate === null ? null : Number(x.rate),
});

async function owned(userId: string, id: string) {
  const p = await prisma.virtualPortfolio.findFirst({ where: { id, userId } });
  if (!p) throw new UserError('없는 가상 포트폴리오입니다.');
  return p;
}

export async function createPortfolio(userId: string, input: { name: string; note?: string; benchmark?: string }) {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new UserError('이름을 넣으세요.');
  if ((await prisma.virtualPortfolio.count({ where: { userId } })) >= 50) throw new UserError('가상 포트폴리오는 50개까지 만들 수 있습니다.');
  const benchmark = BENCHMARKS.some((b) => b.symbol === input.benchmark) ? input.benchmark! : '^KS11';
  return prisma.virtualPortfolio.create({ data: { userId, name, note: (input.note ?? '').slice(0, 500), benchmark } });
}

export async function updatePortfolio(userId: string, id: string, input: { name?: string; note?: string; benchmark?: string }) {
  await owned(userId, id);
  return prisma.virtualPortfolio.update({
    where: { id },
    data: {
      ...(input.name?.trim() ? { name: input.name.trim().slice(0, 60) } : {}),
      ...(input.note !== undefined ? { note: input.note.slice(0, 500) } : {}),
      ...(input.benchmark && BENCHMARKS.some((b) => b.symbol === input.benchmark) ? { benchmark: input.benchmark } : {}),
    },
  });
}

export async function deletePortfolio(userId: string, id: string) {
  await owned(userId, id);
  await prisma.virtualPortfolio.delete({ where: { id } });
}

export interface PositionInput {
  kind: VKind;
  query?: string;
  name?: string;
  buyDate: string;
  sellDate?: string | null;
  mode: 'AMOUNT' | 'QTY';
  amount?: number | null;
  qty?: number | null;
  rate?: number | null;
  note?: string;
}

export async function addPosition(userId: string, portfolioId: string, input: PositionInput) {
  await owned(userId, portfolioId);
  if (!KINDS.includes(input.kind)) throw new UserError('자산 종류를 고르세요.');
  const today = kstDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.buyDate) || input.buyDate > today || input.buyDate < '1990-01-01') throw new UserError('매수일은 1990년부터 오늘까지로 넣으세요.');
  if (input.sellDate && (input.sellDate <= input.buyDate || input.sellDate > today)) throw new UserError('매도일은 매수일 뒤, 오늘까지로 넣으세요.');
  if ((await prisma.virtualPosition.count({ where: { portfolioId } })) >= 100) throw new UserError('한 가상 포트폴리오에 100개까지 담을 수 있습니다.');
  const qtyMode = input.mode === 'QTY' && MARKET_KINDS.includes(input.kind);
  if (qtyMode ? !(input.qty && input.qty > 0) : !(input.amount && input.amount > 0)) throw new UserError(qtyMode ? '수량을 넣으세요.' : '금액을 넣으세요.');
  if (input.kind === 'FIXED' && (input.rate === null || input.rate === undefined || input.rate < -0.5 || input.rate > 1)) throw new UserError('연 금리를 넣으세요(예: 3.5).');
  let symbol: string | null = null, name = (input.name ?? '').trim(), currency = 'KRW';
  if (MARKET_KINDS.includes(input.kind) || input.kind === 'REAL_ESTATE') {
    const r = await resolveSymbol(userId, input.kind, input.query ?? '');
    symbol = r.symbol;
    name ||= r.name;
    currency = r.currency;
  } else name ||= input.kind === 'FIXED' ? `예금 연 ${((input.rate ?? 0) * 100).toFixed(2)}%` : '현금';
  return prisma.virtualPosition.create({
    data: {
      portfolioId,
      kind: input.kind,
      symbol,
      name: name.slice(0, 100),
      currency,
      buyDate: dbDate(input.buyDate),
      sellDate: input.sellDate ? dbDate(input.sellDate) : null,
      mode: qtyMode ? 'QTY' : 'AMOUNT',
      amount: qtyMode ? null : input.amount!,
      qty: qtyMode ? input.qty! : null,
      rate: input.kind === 'FIXED' ? input.rate! : null,
      note: (input.note ?? '').slice(0, 300),
    },
  });
}

export async function updatePosition(userId: string, positionId: string, input: { sellDate?: string | null; note?: string }) {
  const pos = await prisma.virtualPosition.findFirst({ where: { id: positionId, portfolio: { userId } } });
  if (!pos) throw new UserError('없는 종목입니다.');
  const buy = pos.buyDate.toISOString().slice(0, 10);
  if (input.sellDate && (input.sellDate <= buy || input.sellDate > kstDate())) throw new UserError('매도일은 매수일 뒤, 오늘까지로 넣으세요.');
  return prisma.virtualPosition.update({ where: { id: positionId }, data: { ...(input.sellDate !== undefined ? { sellDate: input.sellDate ? dbDate(input.sellDate) : null } : {}), ...(input.note !== undefined ? { note: input.note.slice(0, 300) } : {}) } });
}

export async function deletePosition(userId: string, positionId: string) {
  await prisma.virtualPosition.deleteMany({ where: { id: positionId, portfolio: { userId } } });
}

// ------------------------------------------------------------------ views

export interface VirtualSummary {
  id: string;
  name: string;
  note: string;
  positions: number;
  invested: number;
  value: number;
  since: string | null;
}

export interface VirtualListView {
  portfolios: VirtualSummary[];
}

/** Each portfolio's value today (cheap: one valuation per portfolio) */
export async function listView(userId: string): Promise<VirtualListView> {
  const ports = await prisma.virtualPortfolio.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, include: { positions: true } });
  const out: VirtualSummary[] = [];
  for (const p of ports) {
    if (!p.positions.length) {
      out.push({ id: p.id, name: p.name, note: p.note, positions: 0, invested: 0, value: 0, since: null });
      continue;
    }
    const v = await detailView(userId, p.id).catch(() => null);
    out.push({ id: p.id, name: p.name, note: p.note, positions: p.positions.length, invested: v?.totals.invested ?? 0, value: v?.totals.value ?? 0, since: v?.path.dates[0] ?? null });
  }
  return { portfolios: out };
}

export interface DetailView {
  portfolio: { id: string; name: string; note: string; benchmark: string; benchmarkName: string };
  positions: {
    id: string;
    kind: VKind;
    kindLabel: string;
    symbol: string | null;
    name: string;
    currency: string;
    buyDate: string;
    sellDate: string | null;
    mode: 'AMOUNT' | 'QTY';
    qty: number | null;
    rate: number | null;
    note: string;
    cost: number | null;
    buyPrice: number | null;
    sellPrice: number | null;
    price: number | null;
    value: number | null;
    gain: number | null;
    ret: number | null;
    weight: number | null;
    problem: string | null;
  }[];
  totals: { invested: number; value: number; gain: number; ret: number | null; twr: number | null; maxDrawdown: number | null; bench: number | null };
  byKind: { kind: VKind; label: string; value: number; weight: number }[];
  /** weekly samples for the chart */
  path: { dates: string[]; value: number[]; invested: number[]; bench: (number | null)[]; twr: number[] };
  /** the asked range (whole history when none): its value change less new money, time-weighted return and drawdown */
  period: { start: string; end: string; startValue: number; endValue: number; flows: number; pnl: number; twr: number | null; maxDrawdown: number | null };
}

/** One paper portfolio; `range` limits the chart and the period figures (the valuation always starts at the first buy) */
export async function detailView(userId: string, id: string, range?: { start: string; end: string; daily?: boolean }): Promise<DetailView> {
  const p = await owned(userId, id);
  const rows = await prisma.virtualPosition.findMany({ where: { portfolioId: id }, orderBy: { buyDate: 'asc' } });
  const positions = rows.map((r) => ({ row: r, pos: toPos(r) }));
  const today = kstDate();
  const first = positions.reduce((a, x) => (x.pos.buyDate < a ? x.pos.buyDate : a), today);
  const calendar = weekdays(first, today);
  const series = new Map<string, Close[] | null>();
  await Promise.all(
    [...new Set(positions.filter((x) => x.row.symbol).map((x) => `${x.row.kind === 'REAL_ESTATE' ? 'R' : 'M'}|${x.row.symbol}`))].map(async (k) => {
      const [t, sym] = [k[0], k.slice(2)];
      const s = t === 'R' ? await regionIndex(userId, sym).catch(() => null) : await krwSeries(userId, sym, first).then((x) => x?.closes ?? null).catch(() => null);
      series.set(k, s);
    }),
  );
  const results = positions.map((x) => ({ p: x.pos, row: x.row, r: valuePosition(x.pos, x.row.symbol ? (series.get(`${x.row.kind === 'REAL_ESTATE' ? 'R' : 'M'}|${x.row.symbol}`) ?? null) : null, calendar) }));
  const bench = await krwSeries(userId, p.benchmark, first).then((x) => x?.closes ?? null).catch(() => null);
  const path = portfolioPath(results, calendar, bench);
  const last = calendar.length - 1;
  const value = path.value[last] ?? 0;
  const invested = path.invested[last] ?? 0;
  const byKind = new Map<VKind, number>();
  for (const x of results) if (!x.r.problem) byKind.set(x.p.kind, (byKind.get(x.p.kind) ?? 0) + (x.r.values[last] ?? 0));
  // The range's days; daily up to about two years, then weekly samples (and the last day) keep the chart light
  const from = range?.start ?? calendar[0] ?? today;
  const to = range?.end ?? today;
  const inRange = calendar.map((d, i) => ({ d, i })).filter((x) => x.d >= from && x.d <= to).map((x) => x.i);
  const step = inRange.length > 520 && !range?.daily ? 5 : 1;
  const keep = inRange.filter((i, k) => k % step === 0 || k === inRange.length - 1);
  const a = inRange[0] ?? 0, z = inRange.at(-1) ?? last;
  // Money put in during the range: costs of positions bought after its first day
  const flows = results.filter((x) => !x.r.problem && x.r.cost && x.p.buyDate > (calendar[a] ?? from) && x.p.buyDate <= (calendar[z] ?? to)).reduce((s, x) => s + x.r.cost!, 0);
  const startValue = path.value[a] ?? 0, endValue = path.value[z] ?? 0;
  const twrSlice = inRange.map((i) => path.twr[i]);
  const period: DetailView['period'] = {
    start: calendar[a] ?? from,
    end: calendar[z] ?? to,
    startValue,
    endValue,
    flows,
    pnl: endValue - startValue - flows,
    twr: twrSlice.length > 1 ? twrSlice.at(-1)! / twrSlice[0] - 1 : null,
    maxDrawdown: twrSlice.length > 1 ? maxDrawdown(twrSlice) : null,
  };
  return {
    portfolio: { id: p.id, name: p.name, note: p.note, benchmark: p.benchmark, benchmarkName: BENCHMARKS.find((b) => b.symbol === p.benchmark)?.name ?? p.benchmark },
    positions: results.map(({ p: pos, row, r }) => {
      const v = r.values[last];
      const series_ = row.symbol ? series.get(`${row.kind === 'REAL_ESTATE' ? 'R' : 'M'}|${row.symbol}`) : null;
      return {
        id: pos.id,
        kind: pos.kind,
        kindLabel: KIND_LABEL[pos.kind],
        symbol: row.symbol,
        name: row.name,
        currency: row.currency,
        buyDate: pos.buyDate,
        sellDate: pos.sellDate,
        mode: pos.mode,
        qty: r.units ?? pos.qty,
        rate: pos.rate,
        note: row.note,
        cost: r.cost,
        buyPrice: r.buyPrice,
        sellPrice: r.sellPrice,
        price: series_?.at(-1)?.close ?? null,
        value: v,
        gain: v !== null && r.cost ? v - r.cost : null,
        ret: v !== null && r.cost ? v / r.cost - 1 : null,
        weight: v !== null && value ? v / value : null,
        problem: r.problem,
      };
    }),
    totals: {
      invested,
      value,
      gain: value - invested,
      ret: invested ? value / invested - 1 : null,
      twr: path.twr.length ? path.twr[last] - 1 : null,
      maxDrawdown: path.twr.length ? maxDrawdown(path.twr) : null,
      bench: path.bench[last] !== null && invested ? path.bench[last]! / invested - 1 : null,
    },
    byKind: [...byKind].map(([kind, v]) => ({ kind, label: KIND_LABEL[kind], value: v, weight: value ? v / value : 0 })).sort((a, b) => b.value - a.value),
    period,
    path: { dates: keep.map((i) => path.dates[i]), value: keep.map((i) => Math.round(path.value[i])), invested: keep.map((i) => Math.round(path.invested[i])), bench: keep.map((i) => (path.bench[i] === null ? null : Math.round(path.bench[i]!))), twr: keep.map((i) => Number(path.twr[i].toFixed(5))) },
  };
}

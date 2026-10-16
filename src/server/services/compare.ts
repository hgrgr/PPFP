/**
 * 포트폴리오 비교: real portfolios (their time-weighted daily index from the dashboard), 순자산
 * 전체, 가상 포트폴리오 and indices in won, over one period. Read-only: nothing is combined or
 * stored, so a paper portfolio never mixes into the real figures.
 */
import { align, correlation, perYearOf, stats, yearly, type Series, type Stats } from '@/domain/compare';
import { metrics, metricsWithWeeklyMarket, toReturns, type Metrics } from '@/domain/metrics';
import { resolveRange, type ResolvedRange } from '@/domain/period';
import { BENCHMARKS } from '@/domain/virtual';
import { kstDate, prisma } from '../db';
import { dashboard } from './analytics';
import { userGraph } from './portfolios';
import { benchmarkSeries, detailView } from './virtual';

export interface CompareOption {
  key: string;
  label: string;
  kind: 'real' | 'virtual' | 'index';
}

export interface CompareView {
  options: CompareOption[];
  picked: string[];
  range: ResolvedRange;
  dates: string[];
  series: { key: string; label: string; kind: CompareOption['kind']; values: number[]; stats: Stats; metrics: Metrics; yearly: { year: string; ret: number; partial: boolean }[] }[];
  /** the index the market-relative metrics are measured against */
  benchmark: { key: string; label: string };
  corr: (number | null)[][];
  missing: string[];
}

const INDEX_KEYS = BENCHMARKS.map((b) => `b:${b.symbol}`);

export async function compareView(userId: string, keys: string[], params: { period?: string; from?: string; to?: string; bm?: string }): Promise<CompareView> {
  const [{ portfolios }, virtuals] = await Promise.all([userGraph(userId), prisma.virtualPortfolio.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } })]);
  const options: CompareOption[] = [
    { key: 'all', label: '순자산 전체', kind: 'real' },
    ...portfolios.filter((p) => !p.archived).map((p) => ({ key: p.id, label: p.name, kind: 'real' as const })),
    ...virtuals.map((v) => ({ key: `v:${v.id}`, label: v.name, kind: 'virtual' as const })),
    ...BENCHMARKS.map((b) => ({ key: `b:${b.symbol}`, label: b.name, kind: 'index' as const })),
  ];
  const known = new Set(options.map((o) => o.key));
  let picked = [...new Set(keys)].filter((k) => known.has(k)).slice(0, 8);
  if (!picked.length) picked = ['all', ...(virtuals[0] ? [`v:${virtuals[0].id}`] : []), INDEX_KEYS[0]];

  // How far back 전체 goes: the first real trade or paper purchase among the picks
  const today = kstDate();
  const [firstTx, firstVirtual] = await Promise.all([
    prisma.transaction.findFirst({ where: { portfolio: { userId } }, orderBy: { tradeAt: 'asc' }, select: { tradeAt: true } }),
    prisma.virtualPosition.findFirst({ where: { portfolio: { userId, id: { in: picked.filter((k) => k.startsWith('v:')).map((k) => k.slice(2)) } } }, orderBy: { buyDate: 'asc' }, select: { buyDate: true } }),
  ]);
  const firsts = [firstTx ? kstDate(firstTx.tradeAt) : null, firstVirtual ? firstVirtual.buyDate.toISOString().slice(0, 10) : null].filter((x): x is string => !!x);
  const range = resolveRange(params, today, firsts.length ? firsts.sort()[0] : `${Number(today.slice(0, 4)) - 3}${today.slice(4)}`);

  const missing: string[] = [];
  const label = (k: string) => options.find((o) => o.key === k)!.label;
  const kind = (k: string) => options.find((o) => o.key === k)!.kind;
  const series: Series[] = [];
  for (const k of picked) {
    try {
      if (k.startsWith('v:')) {
        const v = await detailView(userId, k.slice(2), { start: range.start, end: range.end, daily: true });
        // Days before the first purchase have no value yet
        const pts = v.path.dates.map((date, i) => ({ date, index: v.path.twr[i], value: v.path.value[i] })).filter((p) => p.value > 0);
        series.push({ key: k, label: label(k), kind: 'virtual', points: pts.map(({ date, index }) => ({ date, index })) });
      } else if (k.startsWith('b:')) {
        const closes = (await benchmarkSeries(userId, k.slice(2), range.start)) ?? [];
        series.push({ key: k, label: label(k), kind: 'index', points: closes.filter((c) => c.date >= range.start && c.date <= range.end).map((c) => ({ date: c.date, index: c.close })) });
      } else {
        const d = await dashboard(userId, k === 'all' ? null : k, { from: range.start, to: range.end });
        series.push({ key: k, label: label(k), kind: 'real', points: d.twrDaily.map((p) => ({ date: p.date, index: 1 + p.twr })) });
      }
    } catch (e) {
      console.error('[compare]', k, e instanceof Error ? e.message : e);
    }
    if (!series.find((s) => s.key === k) || series.find((s) => s.key === k)!.points.length < 2) missing.push(label(k));
  }
  // The benchmark for beta, alpha and the like: a picked index, or the one asked for (코스피 by default)
  const bmKey = params.bm && INDEX_KEYS.includes(params.bm) ? params.bm : INDEX_KEYS[0];
  if (!series.find((x) => x.key === bmKey)) {
    const closes = (await benchmarkSeries(userId, bmKey.slice(2), range.start).catch(() => null)) ?? [];
    series.push({ key: `__bm`, label: label(bmKey), kind: 'index', points: closes.filter((c) => c.date >= range.start && c.date <= range.end).map((c) => ({ date: c.date, index: c.close })) });
  }
  const { dates, values } = align(series);
  const per = perYearOf(dates);
  const bmValues = values[bmKey] ?? values.__bm ?? null;
  const shown = series.filter((s) => values[s.key] && s.key !== '__bm');
  return {
    options,
    picked,
    range,
    dates,
    series: shown.map((s) => ({ key: s.key, label: s.label, kind: kind(s.key), values: values[s.key].map((v) => Number(v.toFixed(5))), stats: stats(values[s.key], dates, per), metrics: metricsWithWeeklyMarket(dates, values[s.key], s.key === bmKey ? null : bmValues), yearly: yearly(values[s.key], dates) })),
    corr: shown.map((a) => shown.map((b) => correlation(values[a.key], values[b.key]))),
    missing,
    benchmark: { key: bmKey, label: label(bmKey) },
  };
}

export interface Evaluation {
  metrics: Metrics;
  benchmark: string;
  from: string;
  to: string;
  periodName: string;
}

/**
 * Evaluation metrics for one growth path (a dashboard's time-weighted index) against an index in
 * won over the same days. Used by the real and the 가상 dashboards.
 */
export async function evaluate(userId: string, points: { date: string; index: number }[], benchmark = '^KS11'): Promise<Evaluation | null> {
  const pts = points.filter((p) => Number.isFinite(p.index) && p.index > 0);
  if (pts.length < 3) return null;
  const closes = (await benchmarkSeries(userId, benchmark, pts[0].date).catch(() => null)) ?? [];
  const { dates, values } = align([
    { key: 'p', label: '', kind: 'real', points: pts },
    { key: 'b', label: '', kind: 'index', points: closes.filter((c) => c.date >= pts[0].date).map((c) => ({ date: c.date, index: c.close })) },
  ]);
  const per = perYearOf(dates);
  const p = values.p ?? pts.map((x) => x.index);
  const m = metricsWithWeeklyMarket(dates, p, values.b ?? null);
  return { metrics: m, benchmark: BENCHMARKS.find((b) => b.symbol === benchmark)?.name ?? benchmark, from: dates[0] ?? pts[0].date, to: dates.at(-1) ?? pts.at(-1)!.date, periodName: per === 252 ? '거래일' : per === 52 ? '주' : per === 12 ? '개월' : '분기' };
}

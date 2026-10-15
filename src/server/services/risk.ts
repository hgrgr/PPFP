/**
 * 리스크 분석: the listed holdings of the user's account portfolios at today's weights, priced
 * from Yahoo Finance daily closes in won, against factor proxies (KOSPI, S&P 500, the won-dollar
 * rate, small vs large, value vs growth, momentum, low volatility, long Treasuries, gold).
 */
import { alignedReturns, convert, correlation, portfolioReturns, regress, riskContributions, riskStats, rollingBeta, stdev, type Close, type RiskStats } from '@/domain/risk';
import { yahooSymbols } from '@/domain/market-overview';
import { prisma } from '../db';
import { currentState } from './analytics';
import { dailyCloses } from './market-overview';

const FX = 'KRW=X';
const PROXIES = ['^KS11', 'SPY', 'IWM', 'IWD', 'IWF', 'MTUM', 'USMV', 'TLT', 'GC=F'];

export interface RiskView {
  period: 1 | 3 | 5;
  covered: number;
  excluded: { name: string; reason: string }[];
  dates: { from: string; to: string } | null;
  stats: RiskStats | null;
  bench: { kospi: RiskStats | null; spy: RiskStats | null };
  holdings: { key: string; name: string; symbol: string; weight: number; contribution: number; vol: number; betaKospi: number | null; betaSpy: number | null }[];
  corr: { keys: string[]; labels: string[]; matrix: number[][] };
  factors: { key: string; label: string; beta: number; about: string }[];
  r2: number | null;
  rolling: { date: string; kospi: number | null; spy: number | null }[];
  growth: { date: string; mine: number; kospi: number | null; spy: number | null; drawdown: number }[];
}

export async function riskView(userId: string, years: number): Promise<RiskView> {
  const period = ([1, 3, 5].includes(years) ? years : 3) as 1 | 3 | 5;
  const [state, accounts] = await Promise.all([currentState(userId), prisma.portfolio.findMany({ where: { userId, kind: 'ACCOUNT' }, select: { id: true } })]);
  const accountIds = new Set(accounts.map((a) => a.id));
  const excluded: RiskView['excluded'] = [];
  // Value by asset over account portfolios (strategy portfolios repeat account holdings)
  const byAsset = new Map<string, { name: string; symbol: string; currency: string; market: string | null; value: number }>();
  let total = 0;
  const assets = await prisma.asset.findMany({ where: { id: { in: state.holdings.map((h) => h.assetId) } }, select: { id: true, market: true } });
  const marketOf = new Map(assets.map((a) => [a.id, a.market]));
  for (const h of state.holdings) {
    if (!accountIds.has(h.portfolioId) || h.type === 'LIABILITY') continue;
    const v = h.valueFull.toNumber();
    if (v <= 0) continue;
    total += v;
    if (!h.symbol || h.type === 'REAL_ESTATE' || h.type === 'CASH') {
      excluded.push({ name: h.name, reason: h.symbol ? '상장 시세 없음' : '시세 없는 자산' });
      continue;
    }
    const e = byAsset.get(h.assetId) ?? { name: h.name, symbol: h.symbol, currency: h.currency, market: marketOf.get(h.assetId) ?? null, value: 0 };
    e.value += v;
    byAsset.set(h.assetId, e);
  }
  const candidates = new Map([...byAsset].map(([id, a]) => [id, yahooSymbols(a.symbol, a.market)]));
  const range = period === 1 ? '2y' : '5y';
  const closes = await dailyCloses(userId, [FX, ...PROXIES, ...[...candidates.values()].flat()], range);
  const fx = closes.get(FX) ?? [];
  const krw = (c: Close[], usd: boolean) => (usd ? convert(c, fx) : c);
  const series = new Map<string, Close[]>();
  for (const [id, a] of byAsset) {
    const c = (candidates.get(id) ?? []).map((y) => closes.get(y) ?? []).find((x) => x.length > 60);
    if (!c) {
      excluded.push({ name: a.name, reason: '시세 이력 없음' });
      byAsset.delete(id);
      continue;
    }
    // Coins are quoted in won already (BTC-KRW); US-listed stocks in dollars
    series.set(id, krw(c, a.currency === 'USD' && !/-KRW$/.test(candidates.get(id)![0])));
  }
  const empty: RiskView = { period, covered: 0, excluded, dates: null, stats: null, bench: { kospi: null, spy: null }, holdings: [], corr: { keys: [], labels: [], matrix: [] }, factors: [], r2: null, rolling: [], growth: [] };
  if (!series.size) return empty;
  const listed = [...byAsset.values()].reduce((a, x) => a + x.value, 0);
  const weights = new Map([...byAsset].map(([id, a]) => [id, a.value / listed]));

  // Calendar: every day either market traded within the period
  const since = new Date(Date.now() - period * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const calendar = [...new Set([...series.values(), closes.get('^KS11') ?? [], closes.get('SPY') ?? []].flatMap((s) => s.map((c) => c.date)))].filter((d) => d >= since).sort();
  // Holdings that started trading inside the period would cut it short; they count from their start instead
  const all = new Map(series);
  for (const p of PROXIES) all.set(`f:${p}`, closes.get(p) ?? []);
  all.set('f:FX', fx);
  const { dates, returns } = alignedReturns(new Map([...all].filter(([, s]) => s.length && s[0].date <= (calendar[Math.floor(calendar.length / 3)] ?? since))), calendar);
  for (const id of [...weights.keys()]) if (!returns.has(id)) excluded.push({ name: byAsset.get(id)!.name, reason: '상장 기간이 짧음' });
  const live = new Map([...weights].filter(([id]) => returns.has(id)));
  const sum = [...live.values()].reduce((a, v) => a + v, 0);
  if (!live.size || dates.length < 60) return { ...empty, excluded };
  for (const [k, v] of live) live.set(k, v / sum);

  const mine = portfolioReturns(returns, live);
  const kospi = returns.get('f:^KS11') ?? null;
  const spy = returns.get('f:SPY') ?? null;
  const fxr = returns.get('f:FX') ?? null;
  const diff = (a?: number[], b?: number[]) => (a && b ? a.map((v, i) => v - b[i]) : null);
  const beta = (y: number[], x: number[] | null) => {
    if (!x) return null;
    const f = regress(y, [x]);
    return f ? Number(f.betas[0].toFixed(3)) : null;
  };
  const rc = riskContributions(returns, live);

  const factorDefs: { key: string; label: string; about: string; x: number[] | null }[] = [
    { key: 'kospi', label: '코스피', about: '한국 주식 시장', x: kospi },
    { key: 'spy', label: 'S&P 500 (달러)', about: '미국 주식 시장', x: spy },
    { key: 'fx', label: '원/달러', about: '달러가 오를 때(원화 약세)', x: fxr },
    { key: 'size', label: '소형주 − 대형주', about: 'IWM − SPY', x: diff(returns.get('f:IWM'), spy ?? undefined) },
    { key: 'value', label: '가치 − 성장', about: 'IWD − IWF', x: diff(returns.get('f:IWD'), returns.get('f:IWF')) },
    { key: 'momentum', label: '모멘텀', about: 'MTUM − SPY', x: diff(returns.get('f:MTUM'), spy ?? undefined) },
    { key: 'lowvol', label: '저변동성', about: 'USMV − SPY', x: diff(returns.get('f:USMV'), spy ?? undefined) },
    { key: 'bonds', label: '미 장기국채', about: 'TLT', x: returns.get('f:TLT') ?? null },
    { key: 'gold', label: '금', about: '금 선물', x: returns.get('f:GC=F') ?? null },
  ];
  const usable = factorDefs.filter((f) => f.x);
  const fit = regress(mine, usable.map((f) => f.x!));

  // Correlations among the largest holdings
  const top = [...live].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id]) => id);
  const matrix = top.map((a) => top.map((b) => Number(correlation(returns.get(a)!, returns.get(b)!).toFixed(2))));

  // Growth of 1 and drawdown, sampled weekly for the chart
  const growth: RiskView['growth'] = [];
  let g = 1, gk = 1, gs = 1, peak = 1;
  mine.forEach((r, i) => {
    g *= 1 + r;
    if (kospi) gk *= 1 + kospi[i];
    if (spy && fxr) gs *= (1 + spy[i]) * (1 + fxr[i]);
    peak = Math.max(peak, g);
    if (i % 5 === 0 || i === mine.length - 1) growth.push({ date: dates[i], mine: Number(g.toFixed(4)), kospi: kospi ? Number(gk.toFixed(4)) : null, spy: spy && fxr ? Number(gs.toFixed(4)) : null, drawdown: Number((g / peak - 1).toFixed(4)) });
  });
  const rk = kospi ? rollingBeta(mine, kospi, dates, 126, 5) : [];
  const rs = spy ? new Map(rollingBeta(mine, spy, dates, 126, 5).map((p) => [p.date, p.beta])) : new Map<string, number>();
  const spyKrw = spy && fxr ? spy.map((v, i) => (1 + v) * (1 + fxr[i]) - 1) : null;
  return {
    period,
    covered: total ? [...live.keys()].reduce((a, id) => a + byAsset.get(id)!.value, 0) / total : 0,
    excluded,
    dates: { from: dates[0], to: dates.at(-1)! },
    stats: riskStats(mine, dates),
    bench: { kospi: kospi ? riskStats(kospi, dates) : null, spy: spyKrw ? riskStats(spyKrw, dates) : null },
    holdings: [...live]
      .sort((a, b) => b[1] - a[1])
      .map(([id, w]) => {
        const r = returns.get(id)!;
        const a = byAsset.get(id)!;
        return { key: id, name: a.name, symbol: a.symbol, weight: w, contribution: rc.get(id) ?? 0, vol: stdev(r) * Math.sqrt(252), betaKospi: beta(r, kospi), betaSpy: beta(r, spy) };
      }),
    corr: { keys: top, labels: top.map((id) => byAsset.get(id)!.name), matrix },
    factors: fit ? usable.map((f, i) => ({ key: f.key, label: f.label, about: f.about, beta: Number(fit.betas[i].toFixed(3)) })) : [],
    r2: fit ? fit.r2 : null,
    rolling: rk.map((p) => ({ date: p.date, kospi: p.beta, spy: rs.get(p.date) ?? null })),
    growth,
  };
}

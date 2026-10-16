/**
 * 종목 분석 for US-listed companies: statements from SEC XBRL facts, multiples against S&P 500
 * peers in the same industry, Form 4 insider trades, and the inputs and saved results of the
 * fair-value models. Prices come from Yahoo Finance closes.
 */
import { financialTable, STATEMENT_METRICS, type FinancialTable } from '@/domain/sec';
import { cagr, insiderMonths, multiples, parseForm4, ttm, type Fundamentals, type InsiderTrade, type Multiples } from '@/domain/valuation';
import { SECTOR_KO, yahooTicker } from '@/domain/market-overview';
import { prisma } from '../db';
import { companyFacts, filingsByForm, lookupCompany, secText } from './sec';
import { dailyCloses, sp500Members } from './market-overview';
import { UserError } from './portfolios';
import { findCorp, krDisclosures, krInsiders, krStatements } from './dart';
import type { Disclosure, InsiderHolding } from '@/domain/dart';

/** A Korean stock: a 6-character KRX code (A005930 too) or a name in Hangul */
export const isKrQuery = (q: string) => /^A?[0-9][0-9A-Z]{5}$/i.test(q.trim()) || /[가-힣]/.test(q);

type Facts = Parameters<typeof financialTable>[0];

function fundamentalsOf(facts: Facts): { fundamentals: Fundamentals; annual: FinancialTable; quarterly: FinancialTable } {
  return fromTables(financialTable(facts, 'annual', 6, STATEMENT_METRICS), financialTable(facts, 'quarterly', 12, STATEMENT_METRICS));
}

/** Trailing figures from statement tables (SEC or DART); `shares` overrides the table's share count */
export function fromTables(annual: FinancialTable, quarterly: FinancialTable, sharesNow: number | null = null): { fundamentals: Fundamentals; annual: FinancialTable; quarterly: FinancialTable } {
  const q = (k: string) => quarterly.rows.find((r) => r.key === k)?.values ?? [];
  const a = (k: string) => annual.rows.find((r) => r.key === k)?.values ?? [];
  // Trailing twelve months from quarters, else the latest year
  const flow = (k: string) => ttm(q(k)) ?? a(k)[0] ?? null;
  const latest = (k: string) => q(k).find((v) => v !== null) ?? a(k).find((v) => v !== null) ?? null;
  const rev = a('revenue');
  const shares = sharesNow ?? q('dilutedShares').find((v) => v !== null) ?? a('dilutedShares')[0] ?? null;
  return {
    quarterly,
    annual,
    fundamentals: {
      revenue: flow('revenue'),
      operatingIncome: flow('operatingIncome'),
      netIncome: flow('netIncome'),
      operatingCashFlow: flow('operatingCashFlow'),
      capex: flow('capex'),
      dividends: flow('dividendsPaid'),
      cash: latest('cash'),
      debt: latest('debt'),
      equity: latest('equity'),
      shares,
      revenueCagr: cagr(rev[0] ?? null, rev[3] ?? null, 3),
      asOf: quarterly.periods[0]?.end ?? annual.periods[0]?.end ?? null,
    },
  };
}

async function priceOf(userId: string, ticker: string): Promise<{ price: number | null; date: string | null; closes: { date: string; close: number }[] }> {
  const c = (await dailyCloses(userId, [yahooTicker(ticker)], '5y')).get(yahooTicker(ticker)) ?? [];
  return { price: c.at(-1)?.close ?? null, date: c.at(-1)?.date ?? null, closes: c };
}

export interface StockView {
  market: 'US' | 'KR';
  currency: 'USD' | 'KRW';
  ticker: string;
  company: string;
  sector: string | null;
  industry: string | null;
  price: number | null;
  priceDate: string | null;
  fundamentals: Fundamentals;
  multiples: Multiples | null;
  annual: FinancialTable;
  quarterly: FinancialTable;
  /** month-end closes for the price line */
  prices: { date: string; close: number }[];
  saved: { id: string; method: string; value: number; price: number | null; inputs: unknown; note: string; createdAt: string }[];
}

export async function stockView(userId: string, raw: string): Promise<StockView> {
  if (isKrQuery(raw)) return krStockView(userId, raw);
  const c = await lookupCompany(userId, raw);
  const [facts, px, members, saved] = await Promise.all([
    companyFacts(userId, c.cik),
    priceOf(userId, c.ticker),
    sp500Members(userId).catch(() => []),
    prisma.valuation.findMany({ where: { userId, symbol: c.ticker.toUpperCase() }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  const { fundamentals, annual, quarterly } = fundamentalsOf(facts);
  const m = members.find((x) => x.symbol.toUpperCase() === c.ticker.toUpperCase().replace('-', '.'));
  const monthEnds = px.closes.filter((x, i, a) => i === a.length - 1 || a[i + 1].date.slice(0, 7) !== x.date.slice(0, 7));
  return {
    market: 'US',
    currency: 'USD',
    ticker: c.ticker.toUpperCase(),
    company: c.name,
    sector: m ? (SECTOR_KO[m.sector] ?? m.sector) : null,
    industry: m?.industry ?? null,
    price: px.price,
    priceDate: px.date,
    fundamentals,
    multiples: px.price ? multiples(fundamentals, px.price) : null,
    annual,
    quarterly,
    prices: monthEnds,
    saved: saved.map((s) => ({ id: s.id, method: s.method, value: Number(s.value), price: s.price === null ? null : Number(s.price), inputs: s.inputs, note: s.note, createdAt: s.createdAt.toISOString() })),
  };
}

/** A Korean company from OpenDART, priced from Yahoo (.KS or .KQ) */
async function krStockView(userId: string, raw: string): Promise<StockView> {
  const corp = await findCorp(userId, raw);
  const [st, closes, saved] = await Promise.all([
    krStatements(userId, corp),
    dailyCloses(userId, [`${corp.stock}.KS`, `${corp.stock}.KQ`], '5y'),
    prisma.valuation.findMany({ where: { userId, symbol: corp.stock }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  const c = [closes.get(`${corp.stock}.KS`) ?? [], closes.get(`${corp.stock}.KQ`) ?? []].find((x) => x.length) ?? [];
  const price = c.at(-1)?.close ?? null;
  const { fundamentals, annual, quarterly } = fromTables(st.annual, st.quarterly, st.shares);
  return {
    market: 'KR',
    currency: 'KRW',
    ticker: corp.stock,
    company: corp.name,
    sector: null,
    industry: null,
    price,
    priceDate: c.at(-1)?.date ?? null,
    fundamentals,
    multiples: price ? multiples(fundamentals, price) : null,
    annual,
    quarterly,
    prices: c.filter((x, i, a) => i === a.length - 1 || a[i + 1].date.slice(0, 7) !== x.date.slice(0, 7)),
    saved: saved.map((s) => ({ id: s.id, method: s.method, value: Number(s.value), price: s.price === null ? null : Number(s.price), inputs: s.inputs, note: s.note, createdAt: s.createdAt.toISOString() })),
  };
}

export interface KrFilingsView {
  disclosures: Disclosure[];
  insiders: InsiderHolding[];
}

/** 공시 목록과 임원·주요주주 소유보고 for a Korean company */
export async function krFilingsView(userId: string, raw: string): Promise<KrFilingsView> {
  const corp = await findCorp(userId, raw);
  const [disclosures, insiders] = await Promise.all([krDisclosures(userId, corp), krInsiders(userId, corp)]);
  return { disclosures, insiders };
}

export interface PeersView {
  basis: string;
  rows: { ticker: string; name: string; self: boolean; multiples: Multiples | null; asOf: string | null }[];
}

/** The company and up to six S&P 500 members of its industry (or sector), largest by revenue */
export async function peersView(userId: string, raw: string): Promise<PeersView> {
  if (isKrQuery(raw)) throw new UserError('한국 종목의 동종 비교는 아직 없습니다(업종 분류 자료가 없어서). 재무제표·공시·적정가 계산은 됩니다.');
  const c = await lookupCompany(userId, raw);
  const members = await sp500Members(userId);
  const self = c.ticker.toUpperCase().replace('-', '.');
  const me = members.find((m) => m.symbol.toUpperCase() === self);
  if (!me) throw new UserError('동종 비교는 S&P 500 구성 종목만 됩니다(같은 GICS 산업에서 비교 대상을 고릅니다).');
  let pool = members.filter((m) => m.industry === me.industry && m.symbol !== me.symbol);
  let basis = me.industry;
  if (pool.length < 3) {
    pool = members.filter((m) => m.sector === me.sector && m.symbol !== me.symbol);
    basis = `${SECTOR_KO[me.sector] ?? me.sector} 섹터`;
  }
  const picks = [me, ...pool.slice(0, 12)];
  const rows = await Promise.all(
    picks.map(async (m) => {
      try {
        const info = await lookupCompany(userId, m.symbol);
        const [facts, px] = await Promise.all([companyFacts(userId, info.cik), priceOf(userId, m.symbol)]);
        const { fundamentals } = fundamentalsOf(facts);
        return { ticker: m.symbol, name: m.name, self: m === me, multiples: px.price ? multiples(fundamentals, px.price) : null, asOf: fundamentals.asOf };
      } catch {
        return { ticker: m.symbol, name: m.name, self: m === me, multiples: null, asOf: null };
      }
    }),
  );
  // The company first, then peers by market value, at most six
  const [first, ...rest] = rows;
  rest.sort((a, b) => (b.multiples?.marketCap ?? 0) - (a.multiples?.marketCap ?? 0));
  return { basis, rows: [first, ...rest.slice(0, 6)] };
}

export interface InsiderView {
  trades: (InsiderTrade & { accession: string; url: string })[];
  months: { month: string; buy: number; sell: number }[];
  filings: number;
}

/** The latest 40 Form 4 reports, each parsed once and kept */
export async function insiderView(userId: string, raw: string): Promise<InsiderView> {
  const c = await lookupCompany(userId, raw);
  const filings = await filingsByForm(userId, c.cik, ['4'], 40);
  const trades: InsiderView['trades'] = [];
  for (const f of filings) {
    const key = `form4:${f.accession}`;
    let parsed: InsiderTrade[] | null = null;
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (row) parsed = JSON.parse(row.value) as InsiderTrade[];
    else {
      try {
        // The primary document is the XSLT-rendered page; the raw XML sits beside it under its own name
        const xmlName = f.document.split('/').pop()!;
        const xml = await secText(userId, `https://www.sec.gov/Archives/edgar/data/${c.cik}/${f.accession.replace(/-/g, '')}/${xmlName}`);
        parsed = parseForm4(xml);
        await prisma.appSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(parsed) }, update: { value: JSON.stringify(parsed) } });
      } catch (e) {
        console.error('[stock] form4', f.accession, e instanceof Error ? e.message : e);
        continue;
      }
    }
    for (const t of parsed) trades.push({ ...t, accession: f.accession, url: f.url });
  }
  trades.sort((a, b) => b.date.localeCompare(a.date));
  return { trades, months: insiderMonths(trades), filings: filings.length };
}

const METHODS = ['DCF', 'REVERSE_DCF', 'DDM', 'RIM'];

export async function saveValuation(userId: string, input: { symbol: string; method: string; inputs: unknown; value: number; price: number | null; note?: string }) {
  if (!METHODS.includes(input.method)) throw new UserError('없는 평가 방법입니다.');
  if (!Number.isFinite(input.value)) throw new UserError('계산된 값이 없습니다.');
  const symbol = input.symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z.\-]{0,9}$/.test(symbol) && !/^[0-9][0-9A-Z]{5}$/.test(symbol)) throw new UserError('티커가 올바르지 않습니다.');
  if ((await prisma.valuation.count({ where: { userId } })) >= 500) throw new UserError('저장한 평가는 500개까지입니다. 오래된 것을 지우세요.');
  return prisma.valuation.create({ data: { userId, symbol, method: input.method, inputs: input.inputs as object, value: input.value, price: input.price, note: (input.note ?? '').slice(0, 300) } });
}

export async function deleteValuation(userId: string, id: string) {
  await prisma.valuation.deleteMany({ where: { id, userId } });
}

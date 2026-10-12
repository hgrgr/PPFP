/**
 * Benchmark series that do not come from a broker: indexes from Yahoo Finance, and monthly
 * macro indexes from FRED (US) and 한국은행 ECOS (KR, needs the user's free 인증키). Stored in
 * PriceDaily under the catalog key, refreshed at most every few hours per server.
 */
import { parseEcos, parseFredCsv, parseYahooHistory, type BenchmarkDef, type Close } from '@/domain/benchmark';
import { dbDate, kstDate, prisma } from '../db';
import { clearServiceKey, serviceKey, setServiceKey } from './api-keys';
import { UserError } from './portfolios';

const TTL = 6 * 3_600_000;
const fetchedAt = new Map<string, number>();

const shift = (iso: string, days: number) => kstDate(new Date(Date.parse(`${iso}T00:00:00+09:00`) + days * 86_400_000));

class NeedsKey extends Error {}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (PPFP)' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function load(def: BenchmarkDef, from: string, to: string, ecosKey: string | null): Promise<Close[]> {
  if (def.source === 'YAHOO') {
    const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
    const p2 = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000) + 86_400;
    return parseYahooHistory(JSON.parse(await getText(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(def.code)}?period1=${p1}&period2=${p2}&interval=1d`)));
  }
  if (def.source === 'FRED') return parseFredCsv(await getText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(def.code)}&cosd=${from}`));
  if (def.source === 'ECOS') {
    if (!ecosKey) throw new NeedsKey();
    const [stat, cycle, item] = def.code.split('/');
    const ym = (d: string) => d.slice(0, 7).replace('-', '');
    const r = parseEcos(JSON.parse(await getText(`https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(ecosKey)}/json/kr/1/1000/${stat}/${cycle}/${ym(from)}/${ym(to)}/${item}`)));
    if (r.error && !r.closes.length) throw new Error(r.error);
    return r.closes;
  }
  return [];
}

/**
 * Stores the closes of `defs` from a little before `start` (a year before for monthly series, so
 * the first month has a base). Returns, per key, why it has no data: 'ECOS' when the 인증키 is
 * missing, a message when the source failed, null when fine.
 */
export async function ensureBenchmarkSeries(userId: string, defs: BenchmarkDef[], start: string): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const today = kstDate();
  const outside = defs.filter((d) => d.source !== 'BROKER');
  const ecos = outside.some((d) => d.source === 'ECOS') ? await serviceKey(userId, 'ecos', 'ECOS_API_KEY') : null;
  await Promise.all(
    outside.map(async (def) => {
      if (def.source === 'ECOS' && !ecos) return out.set(def.key, 'ECOS');
      const from = shift(start, def.monthly ? -400 : -20);
      // Covered back to the start and fetched lately: nothing to do
      const covered = await prisma.priceDaily.findFirst({ where: { symbol: def.key, date: { lte: dbDate(shift(start, def.monthly ? -31 : 0)) } }, select: { date: true } });
      if (covered && Date.now() - (fetchedAt.get(def.key) ?? 0) < TTL) return out.set(def.key, null);
      if (Date.now() - (fetchedAt.get(`${def.key}|${from}`) ?? 0) < TTL / 6) return out.set(def.key, null);
      try {
        const closes = (await load(def, from, today, ecos?.key ?? null)).filter((c) => c.date >= from);
        if (closes.length) {
          await prisma.$transaction([
            // Monthly figures get revised: the fetched range replaces what was stored
            prisma.priceDaily.deleteMany({ where: { symbol: def.key, date: { gte: dbDate(closes[0].date) } } }),
            prisma.priceDaily.createMany({ data: closes.map((c) => ({ symbol: def.key, date: dbDate(c.date), close: c.close.toString(), currency: def.currency, source: def.source })), skipDuplicates: true }),
          ]);
        }
        fetchedAt.set(def.key, Date.now());
        fetchedAt.set(`${def.key}|${from}`, Date.now());
        out.set(def.key, closes.length ? null : '받은 자료가 없습니다');
      } catch (e) {
        console.error(`[benchmarks] ${def.key}`, e instanceof Error ? e.message : e);
        fetchedAt.set(`${def.key}|${from}`, Date.now());
        out.set(def.key, def.source === 'ECOS' && e instanceof Error && e.message ? `한국은행 ECOS: ${e.message}` : '자료를 받지 못했습니다');
      }
    }),
  );
  return out;
}

/** The user's 한국은행 ECOS 인증키, checked against ECOS before it is stored. */
export async function saveEcosKey(userId: string, input: { key?: string; clear?: boolean }) {
  const key = input.key?.trim();
  if (key) {
    if (!/^[A-Za-z0-9]{10,40}$/.test(key)) throw new UserError('ECOS 인증키는 영문과 숫자로 된 키입니다. 그대로 붙여 넣으세요.');
    let ok = false;
    try {
      ok = parseEcos(JSON.parse(await getText(`https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(key)}/json/kr/1/1/901Y009/M/202501/202501/0`))).closes.length > 0;
    } catch {
      throw new UserError('한국은행 ECOS에 연결하지 못했습니다. 잠시 뒤 다시 저장하세요.');
    }
    if (!ok) throw new UserError('ECOS가 이 인증키를 받지 않았습니다. 키를 다시 확인하세요.');
    await setServiceKey(userId, 'ecos', key);
    for (const k of fetchedAt.keys()) if (k.startsWith('ECOS:')) fetchedAt.delete(k);
  } else if (input.clear) await clearServiceKey(userId, 'ecos');
}

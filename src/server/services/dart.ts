/**
 * 금융감독원 OpenDART: Korean listed companies' statements, 공시 and insider holdings for 종목
 * 분석, with the user's free key (DART_API_KEY on the server as a fallback). DART allows 20,000
 * calls a day; finished reports are kept in AppSetting for 30 days, the company list for a week.
 */
import { DART_BASE, DartError, dartList, dartTables, parseCorpCodes, parseDisclosures, parseElestock, REPORTS, sharesOutstanding, unzipFirst, type Corp, type DartRow, type Disclosure, type InsiderHolding, type ReportData } from '@/domain/dart';
import type { FinancialTable } from '@/domain/sec';
import { kstDate, prisma } from '../db';
import { clearServiceKey, serviceKey, setServiceKey } from './api-keys';
import { noteCall, outcomeOf } from './api-usage';
import { UserError } from './portfolios';

const DAY = 86_400_000;

async function dartKey(userId: string): Promise<string> {
  const k = await serviceKey(userId, 'dart', 'DART_API_KEY');
  if (!k) throw new UserError('한국 종목은 OpenDART 인증키가 필요합니다. 연동 · 설정의 OpenDART 칸에 넣으세요.');
  return k.key;
}

async function call(userId: string, path: string, params: Record<string, string>, key: string): Promise<Response> {
  const q = new URLSearchParams({ crtfc_key: key, ...params });
  let res: Response;
  try {
    res = await fetch(`${DART_BASE}/${path}?${q}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    noteCall(userId, 'dart', 'error');
    throw e;
  }
  noteCall(userId, 'dart', outcomeOf(res.status));
  if (!res.ok) throw new Error(`DART HTTP ${res.status}`);
  return res;
}

async function json<T>(userId: string, path: string, params: Record<string, string>, key: string): Promise<T[]> {
  try {
    return dartList<T>(await (await call(userId, path, params, key)).json());
  } catch (e) {
    if (e instanceof DartError && (e.status === '010' || e.status === '011' || e.status === '012')) throw new UserError(`OpenDART가 인증키를 받지 않았습니다 (${e.message}). 연동 · 설정에서 키를 확인하세요.`);
    if (e instanceof DartError && e.status === '020') throw new UserError('오늘 OpenDART 호출 한도(2만 회)를 넘었습니다. 내일 다시 시도하세요.');
    throw e;
  }
}

async function cachedJson<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (row) {
    const v = JSON.parse(row.value) as { at: string; value: T };
    if (Date.now() - Date.parse(v.at) < ttl) return v.value;
  }
  const value = await load();
  const s = JSON.stringify({ at: new Date().toISOString(), value });
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: s }, update: { value: s } });
  return value;
}

/** Listed companies (corp code, name, stock code), a week's cache */
export async function corpList(userId: string): Promise<Corp[]> {
  const key = await dartKey(userId);
  return cachedJson('dart:corps', 7 * DAY, async () => {
    const res = await call(userId, 'corpCode.xml', {}, key);
    const buf = Buffer.from(await res.arrayBuffer());
    // An error comes back as JSON or XML instead of a zip
    if (buf[0] !== 0x50) {
      const t = buf.toString('utf8');
      const status = /<status>(\d+)<\/status>/.exec(t)?.[1] ?? /"status"\s*:\s*"(\d+)"/.exec(t)?.[1];
      const msg = /<message>([^<]*)<\/message>/.exec(t)?.[1] ?? /"message"\s*:\s*"([^"]*)"/.exec(t)?.[1] ?? 'DART 응답을 읽지 못했습니다';
      if (status === '010' || status === '011') throw new UserError(`OpenDART가 인증키를 받지 않았습니다 (${msg}).`);
      throw new Error(`DART corpCode: ${msg}`);
    }
    return parseCorpCodes(unzipFirst(buf).toString('utf8'));
  });
}

/** A stock code (005930) or a company name (삼성전자) → the company */
export async function findCorp(userId: string, q: string): Promise<Corp> {
  const list = await corpList(userId);
  const t = q.trim().toUpperCase().replace(/^A(?=\d{6}$)/, '');
  const hit = list.find((c) => c.stock === t) ?? list.find((c) => c.name === q.trim()) ?? list.find((c) => c.name.replace(/\s/g, '').includes(q.trim().replace(/\s/g, '')));
  if (!hit) throw new UserError(`'${q}'에 맞는 상장 회사를 OpenDART에서 찾지 못했습니다. 종목코드 6자리로 넣어 보세요.`);
  return hit;
}

/** One report's full statements, consolidated (CFS) or else separate (OFS); kept 30 days */
async function report(userId: string, key: string, corp: string, year: number, code: string): Promise<DartRow[]> {
  return cachedJson(`dart:fs:${corp}:${year}:${code}`, 30 * DAY, async () => {
    for (const fs of ['CFS', 'OFS']) {
      const rows = await json<DartRow>(userId, 'fnlttSinglAcntAll.json', { corp_code: corp, bsns_year: String(year), reprt_code: code, fs_div: fs }, key);
      if (rows.length) return rows;
    }
    return [];
  });
}

export interface KrStatements {
  corp: Corp;
  annual: FinancialTable;
  quarterly: FinancialTable;
  shares: number | null;
}

/** The last three years of reports (12 calls at most, cached), as statement tables */
export async function krStatements(userId: string, corp: Corp): Promise<KrStatements> {
  const key = await dartKey(userId);
  const now = Number(kstDate().slice(0, 4));
  const jobs: { year: number; code: (typeof REPORTS)[keyof typeof REPORTS] }[] = [];
  for (let y = now; y >= now - 3; y--) for (const code of [REPORTS.FY, REPORTS.Q3, REPORTS.H1, REPORTS.Q1]) jobs.push({ year: y, code });
  const reports: ReportData[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        const rows = await report(userId, key, corp.corp, j.year, j.code).catch((e) => {
          if (e instanceof UserError) throw e;
          console.error('[dart]', corp.stock, j.year, j.code, e instanceof Error ? e.message : e);
          return [] as DartRow[];
        });
        if (rows.length) reports.push({ year: j.year, report: j.code, rows });
      }
    }),
  );
  if (!reports.length) throw new UserError(`${corp.name}의 재무제표를 OpenDART에서 받지 못했습니다(상장 직후이거나 금융업처럼 양식이 다른 회사일 수 있습니다).`);
  const { annual, quarterly } = dartTables(reports);
  // Shares: the latest report's 주식 총수
  const latest = [...reports].sort((a, b) => b.year - a.year || ['11013', '11012', '11014', '11011'].indexOf(b.report) - ['11013', '11012', '11014', '11011'].indexOf(a.report))[0];
  const shares = await cachedJson(`dart:shares:${corp.corp}:${latest.year}:${latest.report}`, 30 * DAY, async () => sharesOutstanding(await json<Record<string, string>>(userId, 'stockTotqySttus.json', { corp_code: corp.corp, bsns_year: String(latest.year), reprt_code: latest.report }, key))).catch(() => null);
  return { corp, annual, quarterly, shares };
}

/** The last year's 공시, newest first (an hour in memory via the caller's view) */
export async function krDisclosures(userId: string, corp: Corp): Promise<Disclosure[]> {
  const key = await dartKey(userId);
  const end = kstDate().replace(/-/g, '');
  const begin = `${Number(end.slice(0, 4)) - 1}${end.slice(4)}`;
  return parseDisclosures(await json(userId, 'list.json', { corp_code: corp.corp, bgn_de: begin, end_de: end, page_count: '100' }, key));
}

/** 임원ㆍ주요주주 소유보고, newest first */
export async function krInsiders(userId: string, corp: Corp): Promise<InsiderHolding[]> {
  const key = await dartKey(userId);
  const rows = parseElestock(await json<Record<string, string>>(userId, 'elestock.json', { corp_code: corp.corp }, key));
  return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
}

/** The user's OpenDART key, checked with a company list call before it is stored */
export async function saveDartKey(userId: string, input: { key?: string; clear?: boolean }) {
  const key = input.key?.trim();
  if (key) {
    if (!/^[0-9a-f]{40}$/i.test(key)) throw new UserError('OpenDART 인증키(영문·숫자 40자)를 그대로 붙여 넣으세요.');
    let rows: unknown[];
    try {
      const q = new URLSearchParams({ crtfc_key: key, corp_code: '00126380', bgn_de: '20260101', page_count: '1' });
      const res = await fetch(`${DART_BASE}/list.json?${q}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      rows = dartList(await res.json());
    } catch (e) {
      if (e instanceof DartError) throw new UserError(`OpenDART가 이 인증키를 받지 않았습니다: ${e.message}`);
      throw new UserError('OpenDART에 연결하지 못했습니다. 잠시 뒤 다시 저장하세요.');
    }
    void rows;
    await setServiceKey(userId, 'dart', key);
  } else if (input.clear) await clearServiceKey(userId, 'dart');
}

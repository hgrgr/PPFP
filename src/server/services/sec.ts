/**
 * SEC EDGAR for the 실적 분석 agent: a company's filings, a filing's text (or the part asked
 * for) and its reported numbers. EDGAR is free and keyless but refuses requests without a
 * contact in the User-Agent; SEC_USER_AGENT sets it. Responses are cached in memory, shared by
 * all users, as filings are public.
 */
import 'server-only';
import { accessionFolder, chunk, findSection, financialTable, htmlToText, ITEM_LABEL, type FinancialTable, type SectionKey } from '@/domain/sec';
import { UserError } from './portfolios';
import { noteCall, outcomeOf } from './api-usage';

const UA = process.env.SEC_USER_AGENT || 'PPFP personal finance app sec-contact@ppfp.example';

interface Cached<T> {
  at: number;
  value: T;
}
const cache = new Map<string, Cached<unknown>>();
const HOUR = 3_600_000;

async function getCached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Cached<T> | undefined;
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  // Filing texts are large; keep the cache from growing without bound
  if (cache.size > 60) cache.delete(cache.keys().next().value!);
  return value;
}

async function get(url: string, userId: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    noteCall(userId, 'sec', 'error');
    throw new UserError(`SEC EDGAR에 연결하지 못했습니다: ${e instanceof Error ? e.message : e}`);
  }
  noteCall(userId, 'sec', outcomeOf(res.status), res.headers);
  if (res.status === 404) throw new UserError('SEC EDGAR에 해당 자료가 없습니다.');
  if (!res.ok) throw new UserError(`SEC EDGAR가 응답하지 않습니다 (HTTP ${res.status}). 잠시 뒤 다시 시도하세요.`);
  return res;
}

const pad = (cik: number) => String(cik).padStart(10, '0');

/** Ticker → CIK and name, from the SEC's ticker list. Class shares (BRK.B) match with - or . */
export async function lookupCompany(userId: string, ticker: string): Promise<{ cik: number; ticker: string; name: string }> {
  const list = await getCached('tickers', 24 * HOUR, async () => {
    const j = (await (await get('https://www.sec.gov/files/company_tickers.json', userId)).json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
    return new Map(Object.values(j).map((c) => [c.ticker.toUpperCase(), { cik: c.cik_str, ticker: c.ticker, name: c.title }]));
  });
  const t = ticker.trim().toUpperCase().replace(/^(NASDAQ|NYSE|AMEX):/, '');
  const hit = list.get(t) ?? list.get(t.replace('.', '-')) ?? list.get(t.replace('-', '.'));
  if (!hit) throw new UserError(`'${ticker}'는 SEC에 등록된 티커가 아닙니다. 미국에 상장해 SEC에 공시하는 회사(ADR 포함)만 볼 수 있습니다. 한국 회사는 DART에 공시합니다.`);
  return hit;
}

interface Submissions {
  name: string;
  fiscalYearEnd?: string;
  filings: { recent: { form: string[]; filingDate: string[]; reportDate: string[]; accessionNumber: string[]; primaryDocument: string[]; items: string[] } };
}

export interface Filing {
  form: string;
  filed: string;
  period: string;
  accession: string;
  document: string;
  /** For an 8-K, what it reports (실적 발표 for item 2.02) */
  items?: string;
  url: string;
}

async function filingsOf(userId: string, cik: number): Promise<{ sub: Submissions; filings: Filing[] }> {
  return getCached(`sub:${cik}`, HOUR, async () => {
    const sub = (await (await get(`https://data.sec.gov/submissions/CIK${pad(cik)}.json`, userId)).json()) as Submissions;
    const r = sub.filings.recent;
    const filings = r.form.map((form, i) => ({
      form,
      filed: r.filingDate[i],
      period: r.reportDate[i],
      accession: r.accessionNumber[i],
      document: r.primaryDocument[i],
      items: r.items[i] ? r.items[i].split(',').map((x) => (ITEM_LABEL[x] ? `${x} ${ITEM_LABEL[x]}` : x)).join(', ') : undefined,
      url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionFolder(r.accessionNumber[i])}/${r.primaryDocument[i]}`,
    }));
    return { sub, filings };
  });
}

const DEFAULT_FORMS = ['10-K', '10-Q', '20-F', '40-F', '8-K', '6-K'];

export async function companyFilings(userId: string, ticker: string, opts: { forms?: string[]; earningsOnly?: boolean; limit?: number } = {}) {
  const c = await lookupCompany(userId, ticker);
  const { sub, filings } = await filingsOf(userId, c.cik);
  const forms = new Set((opts.forms?.length ? opts.forms : DEFAULT_FORMS).map((f) => f.toUpperCase()));
  const list = filings
    .filter((f) => forms.has(f.form) || forms.has(f.form.replace(/\/A$/, '')))
    .filter((f) => !opts.earningsOnly || f.form !== '8-K' || f.items?.includes('2.02'))
    .slice(0, Math.min(opts.limit ?? 15, 40));
  return { company: sub.name, ticker: c.ticker, cik: c.cik, fiscalYearEnd: sub.fiscalYearEnd ? `${sub.fiscalYearEnd.slice(0, 2)}-${sub.fiscalYearEnd.slice(2)}` : null, filings: list };
}

/**
 * A filing's text. Without an accession the newest filing of `form` (or the newest 10-K/10-Q/20-F).
 * `document` reads another file in the filing, such as an 8-K's press release (EX-99.1).
 */
export async function readFiling(userId: string, input: { ticker: string; accession?: string; form?: string; document?: string; section?: SectionKey; offset?: number }) {
  const c = await lookupCompany(userId, input.ticker);
  const { filings } = await filingsOf(userId, c.cik);
  const wanted = input.form ? [input.form.toUpperCase()] : ['10-K', '10-Q', '20-F', '40-F'];
  const f = input.accession ? filings.find((x) => x.accession === input.accession!.trim()) : filings.find((x) => wanted.includes(x.form));
  if (!f) throw new UserError(input.accession ? `공시 번호 ${input.accession}를 찾지 못했습니다. sec_company_filings로 번호를 확인하세요.` : `${c.ticker}의 ${wanted.join('/')} 공시가 최근 목록에 없습니다.`);
  const folder = `https://www.sec.gov/Archives/edgar/data/${c.cik}/${accessionFolder(f.accession)}`;
  const index = await getCached(`idx:${f.accession}`, 24 * HOUR, async () => {
    const j = (await (await get(`${folder}/index.json`, userId)).json()) as { directory: { item: { name: string; size?: string }[] } };
    return j.directory.item.filter((i) => /\.(htm|html|txt)$/i.test(i.name) && !/^R\d+\.htm$/i.test(i.name) && !/-index/i.test(i.name) && !/^\d{10}-\d{2}-\d{6}\.txt$/.test(i.name)).map((i) => ({ name: i.name, size: Number(i.size) || null }));
  });
  const doc = input.document?.trim() || f.document;
  if (!index.some((i) => i.name === doc) && doc !== f.document) throw new UserError(`'${doc}' 파일이 이 공시에 없습니다. 있는 파일: ${index.map((i) => i.name).join(', ')}`);
  const text = await getCached(`doc:${f.accession}:${doc}`, 24 * HOUR, async () => {
    const raw = await (await get(`${folder}/${doc}`, userId)).text();
    return /\.txt$/i.test(doc) ? raw : htmlToText(raw);
  });
  const section = input.section ?? 'full';
  const part = doc === f.document ? findSection(text, f.form, section) : { text, found: section === 'full' };
  const slice = chunk(part.text, input.offset ?? 0);
  return {
    company: c.name,
    form: f.form,
    filed: f.filed,
    period: f.period,
    accession: f.accession,
    items: f.items,
    document: doc,
    url: `${folder}/${doc}`,
    section,
    sectionFound: part.found,
    note: !part.found && section !== 'full' ? '이 부분의 제목을 찾지 못해 문서 전체를 앞에서부터 보여 줍니다.' : undefined,
    totalChars: part.text.length,
    offset: input.offset ?? 0,
    nextOffset: slice.next,
    otherDocuments: index.filter((i) => i.name !== doc).slice(0, 15),
    text: slice.text,
  };
}

/** A company's XBRL facts, six hours in memory */
export async function companyFacts(userId: string, cik: number): Promise<Parameters<typeof financialTable>[0]> {
  return getCached(`facts:${cik}`, 6 * HOUR, async () => {
    const j = (await (await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${pad(cik)}.json`, userId)).json()) as { facts: Parameters<typeof financialTable>[0] };
    return j.facts;
  });
}

/** Reported numbers by quarter or year from XBRL company facts */
export async function companyFinancials(userId: string, ticker: string, period: 'quarterly' | 'annual'): Promise<FinancialTable & { company: string; ticker: string }> {
  const c = await lookupCompany(userId, ticker);
  const facts = await companyFacts(userId, c.cik);
  return { company: c.name, ticker: c.ticker, ...financialTable(facts, period) };
}

/** A company's filings of the given forms, newest first (for Form 4 insider reports) */
export async function filingsByForm(userId: string, cik: number, forms: string[], limit: number): Promise<Filing[]> {
  const { filings } = await filingsOf(userId, cik);
  return filings.filter((f) => forms.includes(f.form)).slice(0, limit);
}

/** Any EDGAR file as text, with the SEC's User-Agent */
export async function secText(userId: string, url: string): Promise<string> {
  return (await get(url, userId)).text();
}

/**
 * 금융감독원 OpenDART for Korean companies on 종목 분석: the company code list, financial
 * statements (fnlttSinglAcntAll) turned into the same table the SEC statements use, 공시 목록,
 * 임원·주요주주 소유보고 and share counts. Pure; the service fetches.
 */
import { inflateRawSync } from 'node:zlib';
import type { FinancialTable } from './sec';

export const DART_BASE = 'https://opendart.fss.or.kr/api';

/** The single file inside a zip (DART's corpCode.xml), stored or deflated */
export function unzipFirst(buf: Buffer): Buffer {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('zip 파일이 아닙니다');
  const method = buf.readUInt16LE(8);
  let size = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  // Sizes written after the data (flag bit 3): take them from the central directory
  if (buf.readUInt16LE(6) & 0x08 || size === 0) {
    const cd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    if (cd >= 0) size = buf.readUInt32LE(cd + 20);
  }
  const data = buf.subarray(start, start + size);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return inflateRawSync(data);
  throw new Error(`지원하지 않는 압축 방식 ${method}`);
}

export interface Corp {
  corp: string;
  name: string;
  stock: string;
}

/** CORPCODE.xml → listed companies only (those with a 6-character stock code) */
export function parseCorpCodes(xml: string): Corp[] {
  const out: Corp[] = [];
  for (const m of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const b = m[1];
    const get = (t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(b)?.[1]?.trim() ?? '';
    const stock = get('stock_code');
    if (!/^[0-9A-Z]{6}$/.test(stock)) continue;
    out.push({ corp: get('corp_code'), name: get('corp_name'), stock });
  }
  return out;
}

/** DART answers { status, message, list? }; '000' is fine, '013' is "no data" */
export class DartError extends Error {
  constructor(public status: string, message: string) {
    super(message);
  }
}
export function dartList<T>(body: unknown): T[] {
  const b = body as { status?: string; message?: string; list?: T[] } | null;
  if (!b || typeof b !== 'object') throw new DartError('999', 'DART 응답을 읽지 못했습니다');
  if (b.status === '013') return [];
  if (b.status !== '000') throw new DartError(b.status ?? '999', b.message ?? 'DART 오류');
  return b.list ?? [];
}

export interface DartRow {
  sj_div: string;
  account_id: string;
  account_nm: string;
  thstrm_amount?: string;
  thstrm_add_amount?: string;
  frmtrm_amount?: string;
  bfefrmtrm_amount?: string;
}

/** Report codes: 1분기, 반기, 3분기, 사업보고서 */
export const REPORTS = { Q1: '11013', H1: '11012', Q3: '11014', FY: '11011' } as const;

interface Metric {
  key: string;
  label: string;
  /** statements to look in */
  sj: string[];
  ids: string[];
  names: string[];
  instant?: boolean;
  /** per share or a count: not summed or differenced into quarters */
  ratio?: boolean;
}

export const DART_METRICS: Metric[] = [
  { key: 'revenue', label: '매출', sj: ['IS', 'CIS'], ids: ['ifrs-full_Revenue', 'ifrs_Revenue'], names: ['매출액', '수익(매출액)', '영업수익', '매출'] },
  { key: 'grossProfit', label: '매출총이익', sj: ['IS', 'CIS'], ids: ['ifrs-full_GrossProfit', 'ifrs_GrossProfit'], names: ['매출총이익', '매출총이익(손실)'] },
  { key: 'operatingIncome', label: '영업이익', sj: ['IS', 'CIS'], ids: ['dart_OperatingIncomeLoss'], names: ['영업이익', '영업이익(손실)'] },
  { key: 'netIncome', label: '순이익 (지배주주)', sj: ['IS', 'CIS'], ids: ['ifrs-full_ProfitLossAttributableToOwnersOfParent', 'ifrs-full_ProfitLoss', 'ifrs_ProfitLoss'], names: ['지배기업의 소유주에게 귀속되는 당기순이익', '지배기업 소유주지분', '당기순이익', '당기순이익(손실)'] },
  { key: 'epsDiluted', label: '주당순이익', sj: ['IS', 'CIS'], ids: ['ifrs-full_BasicEarningsLossPerShare', 'ifrs_BasicEarningsLossPerShare'], names: ['기본주당이익', '기본주당이익(손실)', '기본주당순이익'], ratio: true },
  { key: 'operatingCashFlow', label: '영업현금흐름', sj: ['CF'], ids: ['ifrs-full_CashFlowsFromUsedInOperatingActivities', 'ifrs_CashFlowsFromUsedInOperatingActivities'], names: ['영업활동현금흐름', '영업활동으로 인한 현금흐름', '영업활동 현금흐름'] },
  { key: 'capex', label: '설비투자', sj: ['CF'], ids: ['ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', 'ifrs_PurchaseOfPropertyPlantAndEquipment'], names: ['유형자산의 취득', '유형자산의취득'] },
  { key: 'dividendsPaid', label: '배당금 지급', sj: ['CF'], ids: ['ifrs-full_DividendsPaidClassifiedAsFinancingActivities', 'ifrs_DividendsPaid'], names: ['배당금의 지급', '배당금지급', '배당금의지급'] },
  { key: 'cash', label: '현금성자산', sj: ['BS'], ids: ['ifrs-full_CashAndCashEquivalents', 'ifrs_CashAndCashEquivalents'], names: ['현금및현금성자산'], instant: true },
  { key: 'totalAssets', label: '총자산', sj: ['BS'], ids: ['ifrs-full_Assets', 'ifrs_Assets'], names: ['자산총계'], instant: true },
  { key: 'liabilities', label: '총부채', sj: ['BS'], ids: ['ifrs-full_Liabilities', 'ifrs_Liabilities'], names: ['부채총계'], instant: true },
  { key: 'equity', label: '자본 (지배주주)', sj: ['BS'], ids: ['ifrs-full_EquityAttributableToOwnersOfParent', 'ifrs-full_Equity', 'ifrs_Equity'], names: ['지배기업의 소유주에게 귀속되는 자본', '지배기업 소유주지분', '자본총계'], instant: true },
  { key: 'debt', label: '장기 차입금', sj: ['BS'], ids: ['ifrs-full_LongtermBorrowings', 'ifrs-full_NoncurrentPortionOfNoncurrentBorrowings'], names: ['장기차입금', '장기 차입금'], instant: true },
];

const amount = (s: string | undefined): number | null => {
  if (s === undefined || s === null) return null;
  const t = String(s).replace(/,/g, '').trim();
  if (!t || t === '-') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/** The first row matching a metric, by account id then by name */
function find(rows: DartRow[], m: Metric): DartRow | null {
  const inSj = rows.filter((r) => m.sj.includes(r.sj_div));
  for (const id of m.ids) {
    const hit = inSj.find((r) => r.account_id === id);
    if (hit) return hit;
  }
  for (const n of m.names) {
    const hit = inSj.find((r) => r.account_nm.replace(/\s/g, '') === n.replace(/\s/g, ''));
    if (hit) return hit;
  }
  return null;
}

export interface ReportData {
  year: number;
  report: (typeof REPORTS)[keyof typeof REPORTS];
  rows: DartRow[];
}

/** One report's value of a metric: the period alone (thstrm) or since January (thstrm_add for 손익 in quarterly reports) */
function value(r: ReportData, m: Metric, cumulative: boolean): number | null {
  const row = find(r.rows, m);
  if (!row) return null;
  if (m.instant || m.ratio || r.report === REPORTS.FY) return amount(row.thstrm_amount);
  if (m.sj.includes('CF')) return amount(row.thstrm_amount); // cash flows are year to date in every report
  return cumulative ? (amount(row.thstrm_add_amount) ?? amount(row.thstrm_amount)) : amount(row.thstrm_amount);
}

const QUARTER_END: Record<string, string> = { '11013': '03-31', '11012': '06-30', '11014': '09-30', '11011': '12-31' };
const QUARTER_NO: Record<string, number> = { '11013': 1, '11012': 2, '11014': 3, '11011': 4 };

/**
 * Reports → yearly and quarterly tables shaped like the SEC ones (newest first, with yoy %).
 * Quarters: 손익 of a quarterly report is its own three months; the fourth quarter is the year
 * less the first three. Cash flows are year to date, so each quarter is the difference.
 * Assumes a December year end, which nearly all Korean listed companies use.
 */
export function dartTables(reports: ReportData[], years = 6, quarters = 12): { annual: FinancialTable; quarterly: FinancialTable } {
  const fy = reports.filter((r) => r.report === REPORTS.FY).sort((a, b) => b.year - a.year);
  // Annual: each 사업보고서 carries this year and the two before
  const annualVals = new Map<string, Map<number, number | null>>();
  for (const m of DART_METRICS) annualVals.set(m.key, new Map());
  for (const r of [...fy].reverse()) {
    for (const m of DART_METRICS) {
      const row = find(r.rows, m);
      if (!row) continue;
      const map = annualVals.get(m.key)!;
      const set = (y: number, v: number | null) => {
        if (v !== null && (!map.has(y) || y === r.year)) map.set(y, v);
      };
      set(r.year, amount(row.thstrm_amount));
      set(r.year - 1, amount(row.frmtrm_amount));
      set(r.year - 2, amount(row.bfefrmtrm_amount));
    }
  }
  const allYears = [...new Set([...annualVals.values()].flatMap((m) => [...m.keys()]))].sort((a, b) => b - a).slice(0, years);
  const table = (period: 'annual' | 'quarterly', keys: { key: string; label: string; end: string }[], get: (metric: string, k: string) => number | null, prior: (k: string) => string): FinancialTable => {
    const rows = DART_METRICS.map((m) => {
      const values = keys.map((p) => get(m.key, p.key));
      const yoy = keys.map((p, i) => {
        const prev = get(m.key, prior(p.key));
        const v = values[i];
        return v !== null && prev ? Math.round(((v - prev) / Math.abs(prev)) * 1000) / 10 : null;
      });
      return { key: m.key, label: m.label, unit: m.ratio ? 'KRW/shares' : 'KRW', values, yoy };
    });
    const g = (k: string) => rows.find((r) => r.key === k)!.values;
    const ratio = (a: (number | null)[], b: (number | null)[]) => a.map((v, i) => (v !== null && b[i] ? Math.round((v / b[i]!) * 1000) / 10 : null));
    return {
      period,
      periods: keys,
      rows,
      margins: { gross: ratio(g('grossProfit'), g('revenue')), operating: ratio(g('operatingIncome'), g('revenue')), net: ratio(g('netIncome'), g('revenue')) },
      latestFiling: null,
      note: '금융감독원 OpenDART 연결재무제표(없으면 별도). 4분기와 분기 현금흐름은 연간·누적 값에서 앞 분기까지를 뺀 값입니다.',
    };
  };
  const annual = table(
    'annual',
    allYears.map((y) => ({ key: String(y), label: String(y), end: `${y}-12-31` })),
    (metric, k) => annualVals.get(metric)!.get(Number(k)) ?? null,
    (k) => String(Number(k) - 1),
  );

  // Quarters
  const qv = new Map<string, Map<string, number | null>>();
  for (const m of DART_METRICS) qv.set(m.key, new Map());
  const byYear = new Map<number, Map<string, ReportData>>();
  for (const r of reports) {
    const m = byYear.get(r.year) ?? new Map<string, ReportData>();
    m.set(r.report, r);
    byYear.set(r.year, m);
  }
  for (const [year, reps] of byYear) {
    for (const m of DART_METRICS) {
      const map = qv.get(m.key)!;
      const cum: (number | null)[] = [REPORTS.Q1, REPORTS.H1, REPORTS.Q3, REPORTS.FY].map((code) => {
        const r = reps.get(code);
        return r ? value(r, m, true) : null;
      });
      const own: (number | null)[] = [REPORTS.Q1, REPORTS.H1, REPORTS.Q3, REPORTS.FY].map((code) => {
        const r = reps.get(code);
        return r ? value(r, m, false) : null;
      });
      for (let q = 0; q < 4; q++) {
        let v: number | null;
        if (m.instant || m.ratio) v = q === 3 && m.ratio ? null : own[q];
        else if (m.sj.includes('CF') || q === 3) v = cum[q] !== null && (q === 0 || cum[q - 1] !== null) ? cum[q]! - (q === 0 ? 0 : cum[q - 1]!) : null;
        else v = own[q];
        if (v !== null) map.set(`${year}Q${q + 1}`, v);
      }
    }
  }
  const allQ = [...new Set([...qv.values()].flatMap((m) => [...m.keys()]))].sort().reverse().slice(0, quarters);
  const quarterly = table(
    'quarterly',
    allQ.map((k) => ({ key: k, label: `${k.slice(0, 4)} ${k.slice(5)}분기`, end: `${k.slice(0, 4)}-${QUARTER_END[Object.keys(QUARTER_NO).find((c) => QUARTER_NO[c] === Number(k.slice(5)))!]}` })),
    (metric, k) => qv.get(metric)!.get(k) ?? null,
    (k) => `${Number(k.slice(0, 4)) - 1}${k.slice(4)}`,
  );
  return { annual, quarterly };
}

export interface Disclosure {
  date: string;
  title: string;
  filer: string;
  url: string;
}

export function parseDisclosures(list: { rcept_dt?: string; report_nm?: string; flr_nm?: string; rcept_no?: string }[]): Disclosure[] {
  return list.map((d) => ({
    date: `${String(d.rcept_dt).slice(0, 4)}-${String(d.rcept_dt).slice(4, 6)}-${String(d.rcept_dt).slice(6, 8)}`,
    title: String(d.report_nm ?? '').trim(),
    filer: String(d.flr_nm ?? ''),
    url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${d.rcept_no}`,
  }));
}

export interface InsiderHolding {
  date: string;
  name: string;
  role: string;
  /** shares after, change, holding ratio after (%), ratio change */
  shares: number | null;
  change: number | null;
  ratio: number | null;
  ratioChange: number | null;
  url: string;
}

/** 임원ㆍ주요주주 소유보고 (elestock) rows */
export function parseElestock(list: Record<string, string>[]): InsiderHolding[] {
  return list.map((r) => ({
    date: r.rcept_dt ?? '',
    name: (r.repror ?? '').trim(),
    role: [r.isu_exctv_ofcps, r.isu_main_shrholdr].filter((x) => x && x !== '-').join(' · ') || (r.isu_exctv_rgist_at ?? ''),
    shares: amount(r.sp_stock_lmp_cnt),
    change: amount(r.sp_stock_lmp_irds_cnt),
    ratio: amount(r.sp_stock_lmp_rate),
    ratioChange: amount(r.sp_stock_lmp_irds_rate),
    url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${r.rcept_no}`,
  }));
}

/** stockTotqySttus: common shares outstanding (발행 − 자기주식) from the 보통주 or 합계 row */
export function sharesOutstanding(list: Record<string, string>[]): number | null {
  const row = list.find((r) => /보통주/.test(r.se ?? '')) ?? list.find((r) => /합계/.test(r.se ?? ''));
  if (!row) return null;
  const distb = amount(row.distb_stock_co);
  if (distb) return distb;
  const issued = amount(row.istc_totqy), treasury = amount(row.tesstk_co) ?? 0;
  return issued ? issued - treasury : null;
}

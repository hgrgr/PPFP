/**
 * SEC EDGAR filings (10-K, 10-Q, 20-F, 8-K earnings releases) for the 실적 분석 agent: plain
 * text from a filing's HTML, the part of a report a question needs (MD&A, risk factors, ...),
 * and the reported numbers from XBRL company facts laid out by quarter or year. No I/O here.
 */

export const FILING_FORMS = ['10-K', '10-Q', '20-F', '8-K', '6-K', '40-F'] as const;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', bull: '•', hellip: '…', reg: '®', trade: '™', copy: '©' };

/** A filing's HTML as readable text: tables become tab-separated rows, hidden XBRL headers go. */
export function htmlToText(html: string): string {
  return html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/table)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[  \t]*\t[  \t]*/g, '\t')
    .replace(/[  ]+/g, ' ')
    .replace(/\t{2,}/g, '\t')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type SectionKey = 'business' | 'risk' | 'mda' | 'financials' | 'full';
export const SECTION_LABEL: Record<SectionKey, string> = { business: '사업 개요', risk: '위험 요인', mda: '경영진의 분석(MD&A)', financials: '재무제표', full: '전체' };

/** Where each part starts in each report type */
const SECTION_HEADS: Record<string, Partial<Record<Exclude<SectionKey, 'full'>, RegExp>>> = {
  '10-K': { business: /item\s*1\.?\s*[—–-]?\s*business\b/i, risk: /item\s*1a\.?\s*[—–-]?\s*risk\s+factors/i, mda: /item\s*7\.?\s*[—–-]?\s*management.s\s+discussion/i, financials: /item\s*8\.?\s*[—–-]?\s*financial\s+statements/i },
  '10-Q': { financials: /item\s*1\.?\s*[—–-]?\s*financial\s+statements/i, mda: /item\s*2\.?\s*[—–-]?\s*management.s\s+discussion/i, risk: /item\s*1a\.?\s*[—–-]?\s*risk\s+factors/i },
  '20-F': { risk: /\n\s*(item\s*3\.?\s*)?(d\.\s*)?risk\s+factors\s*(?=\n)/i, business: /item\s*4\.?\s*[—–-]?\s*information\s+on\s+the\s+company/i, mda: /item\s*5\.?\s*[—–-]?\s*operating\s+and\s+financial\s+review/i, financials: /item\s*18\.?\s*[—–-]?\s*financial\s+statements/i },
};
const ITEM_HEAD = /\n\s*(part\s+[iv]+\b|item\s*\d+[a-d]?\.)/gi;

/**
 * The part of a report text a question needs. A report names its items twice, in the table of
 * contents and as headings, so the occurrence followed by the most text up to the next item wins.
 */
export function findSection(text: string, form: string, section: SectionKey): { text: string; found: boolean } {
  if (section === 'full') return { text, found: true };
  const head = SECTION_HEADS[form.replace(/\/A$/, '')]?.[section];
  if (!head) return { text, found: false };
  const re = new RegExp(head.source, 'gi');
  let best = { start: -1, end: -1 };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index;
    ITEM_HEAD.lastIndex = start + m[0].length;
    const next = ITEM_HEAD.exec(text);
    const end = next ? next.index : text.length;
    if (end - start > best.end - best.start) best = { start, end };
  }
  return best.start < 0 ? { text, found: false } : { text: text.slice(best.start, best.end).trim(), found: true };
}

/** A slice of a long text, cut at a paragraph near `size`, and where the next slice starts */
export function chunk(text: string, offset: number, size = 24_000): { text: string; next: number | null } {
  const start = Math.max(0, Math.min(offset, text.length));
  let end = Math.min(text.length, start + size);
  if (end < text.length) {
    const cut = text.lastIndexOf('\n', end);
    if (cut > start + size / 2) end = cut;
  }
  return { text: text.slice(start, end), next: end < text.length ? end : null };
}

// ---------------------------------------------------------------- XBRL company facts

interface Fact {
  start?: string;
  end: string;
  val: number;
  form?: string;
  filed?: string;
  frame?: string;
  fy?: number;
  fp?: string;
}
type Facts = Record<string, Record<string, { units: Record<string, Fact[]> }>>;

/** Each metric's XBRL tags, US GAAP first, then IFRS (20-F filers); the one reported latest is used */
export const METRICS: { key: string; label: string; tags: string[]; instant?: boolean }[] = [
  { key: 'revenue', label: '매출', tags: ['us-gaap:Revenues', 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'us-gaap:SalesRevenueNet', 'ifrs-full:Revenue'] },
  { key: 'grossProfit', label: '매출총이익', tags: ['us-gaap:GrossProfit', 'ifrs-full:GrossProfit'] },
  { key: 'operatingIncome', label: '영업이익', tags: ['us-gaap:OperatingIncomeLoss', 'ifrs-full:ProfitLossFromOperatingActivities'] },
  { key: 'netIncome', label: '순이익', tags: ['us-gaap:NetIncomeLoss', 'ifrs-full:ProfitLossAttributableToOwnersOfParent', 'ifrs-full:ProfitLoss'] },
  { key: 'epsDiluted', label: '희석 EPS', tags: ['us-gaap:EarningsPerShareDiluted', 'ifrs-full:DilutedEarningsLossPerShare'] },
  { key: 'operatingCashFlow', label: '영업현금흐름', tags: ['us-gaap:NetCashProvidedByUsedInOperatingActivities', 'ifrs-full:CashFlowsFromUsedInOperatingActivities'] },
  { key: 'capex', label: '설비투자', tags: ['us-gaap:PaymentsToAcquirePropertyPlantAndEquipment', 'us-gaap:PaymentsToAcquireProductiveAssets', 'ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'] },
  { key: 'rnd', label: '연구개발비', tags: ['us-gaap:ResearchAndDevelopmentExpense', 'ifrs-full:ResearchAndDevelopmentExpense'] },
  { key: 'cash', label: '현금성자산', tags: ['us-gaap:CashAndCashEquivalentsAtCarryingValue', 'ifrs-full:CashAndCashEquivalents'], instant: true },
  { key: 'dilutedShares', label: '희석 주식 수', tags: ['us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding', 'ifrs-full:WeightedAverageNumberOfSharesOutstandingDiluted'] },
];

export interface FinancialTable {
  period: 'quarterly' | 'annual';
  /** Newest first: "2026 2분기", "2025" */
  periods: { key: string; label: string; end: string }[];
  rows: { key: string; label: string; unit: string; values: (number | null)[]; yoy: (number | null)[] }[];
  /** Gross, operating and net margin by period, % */
  margins: { gross: (number | null)[]; operating: (number | null)[]; net: (number | null)[] };
  /** The newest filing the numbers come from; XBRL data can lag the filing list by days or more */
  latestFiling: { form: string; filed: string } | null;
  note: string;
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
/** The calendar quarter or year a period mostly falls in, from its middle: "2026Q2", "2025" */
function calendarKey(start: string, end: string, period: 'quarterly' | 'annual'): string {
  const mid = new Date((Date.parse(start) + Date.parse(end)) / 2);
  return period === 'annual' ? String(mid.getUTCFullYear()) : `${mid.getUTCFullYear()}Q${Math.floor(mid.getUTCMonth() / 3) + 1}`;
}
const priorKey = (k: string) => (k.includes('Q') ? `${Number(k.slice(0, 4)) - 1}${k.slice(4)}` : String(Number(k) - 1));

/** The same period comes in several filings; the latest one (restated, if it was) is kept */
function latestFiled(list: Fact[], key: (f: Fact) => string): Fact[] {
  const m = new Map<string, Fact>();
  for (const f of list) {
    const k = key(f);
    const had = m.get(k);
    if (!had || (f.filed ?? '') >= (had.filed ?? '')) m.set(k, f);
  }
  return [...m.values()];
}

/**
 * One metric's values by calendar quarter or year. Three-month figures are used as reported;
 * a quarter reported only inside a longer period (the fourth quarter inside the year, cash
 * flows reported year to date) is the longer figure less the one before it from the same
 * start. Per-share and share counts are not derived that way, as they do not add up.
 */
function series(list: Fact[], period: 'quarterly' | 'annual', instant: boolean, additive: boolean, ends: Map<string, string>): Map<string, { val: number; end: string; derived: boolean }> {
  const out = new Map<string, { val: number; end: string; derived: boolean }>();
  if (instant) {
    // Balance sheet: the value at each period's end
    const at = new Map<string, number>();
    for (const f of latestFiled(list.filter((f) => !f.start), (f) => f.end)) at.set(f.end, f.val);
    for (const [key, end] of ends) if (at.has(end)) out.set(key, { val: at.get(end)!, end, derived: false });
    return out;
  }
  const facts = latestFiled(list.filter((f) => f.start), (f) => `${f.start}/${f.end}`);
  const [lo, hi] = period === 'annual' ? [350, 380] : [80, 100];
  for (const f of facts) {
    const d = days(f.start!, f.end);
    if (d >= lo && d <= hi) out.set(calendarKey(f.start!, f.end, period), { val: f.val, end: f.end, derived: false });
  }
  if (period === 'quarterly' && additive) {
    const byStart = new Map<string, Fact[]>();
    for (const f of facts) byStart.set(f.start!, [...(byStart.get(f.start!) ?? []), f]);
    for (const group of byStart.values()) {
      group.sort((a, b) => a.end.localeCompare(b.end));
      for (let i = 1; i < group.length; i++) {
        const [a, b] = [group[i - 1], group[i]];
        const gap = days(a.end, b.end);
        if (gap < 80 || gap > 100) continue;
        const start = new Date(Date.parse(a.end) + DAY).toISOString().slice(0, 10);
        const key = calendarKey(start, b.end, 'quarterly');
        if (!out.has(key)) out.set(key, { val: b.val - a.val, end: b.end, derived: true });
      }
    }
    // The fourth quarter from the year less the three quarters inside it, when there is no nine-month figure
    for (const y of facts) {
      const d = days(y.start!, y.end);
      if (d < 350 || d > 380) continue;
      const inside = facts.filter((f) => f.start! >= y.start! && f.end < y.end && days(f.start!, f.end) >= 80 && days(f.start!, f.end) <= 100).sort((a, b) => a.end.localeCompare(b.end));
      if (inside.length !== 3) continue;
      const start = new Date(Date.parse(inside[2].end) + DAY).toISOString().slice(0, 10);
      const key = calendarKey(start, y.end, 'quarterly');
      if (!out.has(key)) out.set(key, { val: Math.round((y.val - inside.reduce((t, f) => t + f.val, 0)) * 1e6) / 1e6, end: y.end, derived: true });
    }
  }
  return out;
}

/**
 * Reported numbers by calendar quarter or year, newest first, with the change from a year
 * earlier. Companies whose fiscal year is not the calendar year are put in the calendar quarter
 * their quarter mostly falls in (NVIDIA's fiscal 2027 second quarter, May–July 2026, is 2026 Q2).
 */
export function financialTable(facts: Facts, period: 'quarterly' | 'annual', count = 8): FinancialTable {
  // Period ends come from revenue or net income; balance sheet values are read at those ends
  const pickTag = (tags: string[]) => {
    let best: { unit: string; list: Fact[]; latest: string } | null = null;
    for (const tag of tags) {
      const [ns, name] = tag.split(':');
      for (const [unit, list] of Object.entries(facts[ns]?.[name]?.units ?? {})) {
        const latest = list.reduce((a, f) => (f.end > a ? f.end : a), '');
        if (list.length && (!best || latest > best.latest)) best = { unit, list, latest };
      }
    }
    return best;
  };
  const picked = METRICS.map((m) => ({ m, p: pickTag(m.tags) }));
  const ends = new Map<string, string>();
  const flows = picked.filter(({ m }) => !m.instant).map(({ m, p }) => ({ m, p, s: p ? series(p.list, period, false, !/shares/i.test(p.unit) && m.key !== 'dilutedShares', ends) : new Map() }));
  for (const key of ['revenue', 'netIncome', 'operatingIncome']) {
    for (const [k, v] of flows.find((f) => f.m.key === key)!.s) if (!ends.has(k)) ends.set(k, v.end);
  }
  const all = new Map<string, Map<string, { val: number; end: string; derived: boolean }>>();
  for (const { m, p } of picked) all.set(m.key, m.instant ? (p ? series(p.list, period, true, false, ends) : new Map()) : flows.find((f) => f.m.key === m.key)!.s);
  const order = [...ends.keys()].sort().reverse().slice(0, count);
  const rows = picked.map(({ m, p }) => {
    const s = all.get(m.key)!;
    const values = order.map((k) => s.get(k)?.val ?? null);
    const yoy = order.map((k, i) => {
      const prev = s.get(priorKey(k))?.val;
      const v = values[i];
      return v !== null && prev ? Math.round(((v - prev) / Math.abs(prev)) * 1000) / 10 : null;
    });
    return { key: m.key, label: m.label, unit: p?.unit ?? '', values, yoy };
  });
  const get = (k: string) => rows.find((r) => r.key === k)!.values;
  const ratio = (a: (number | null)[], b: (number | null)[]) => a.map((v, i) => (v !== null && b[i] ? Math.round((v / b[i]!) * 1000) / 10 : null));
  let latestFiling: FinancialTable['latestFiling'] = null;
  for (const { p } of picked) for (const f of p?.list ?? []) if (f.filed && f.form && (!latestFiling || f.filed > latestFiling.filed)) latestFiling = { form: f.form, filed: f.filed };
  const derived = period === 'quarterly' && [...all.values()].some((s) => order.some((k) => s.get(k)?.derived));
  return {
    period,
    periods: order.map((k) => ({ key: k, label: k.includes('Q') ? `${k.slice(0, 4)} ${k.slice(5)}분기` : k, end: ends.get(k)! })),
    rows,
    margins: { gross: ratio(get('grossProfit'), get('revenue')), operating: ratio(get('operatingIncome'), get('revenue')), net: ratio(get('netIncome'), get('revenue')) },
    latestFiling,
    note: [
      '숫자는 latestFiling까지 반영된 XBRL 자료입니다. 공시 목록에 그보다 새 보고서가 있으면 그 보고서 본문(sec_read_filing)의 숫자를 쓰세요.',
      period === 'quarterly'
        ? '분기는 달력 기준입니다. 회계연도가 달력과 다른 회사는 그 분기가 대부분 걸친 달력 분기에 둡니다(예: 엔비디아 2027 회계연도 2분기, 2026년 5~7월 = 2026 2분기). end가 실제 분기 마지막 날입니다.'
        : '연도는 달력 기준이며, 회계연도가 다른 회사는 대부분 걸친 해에 둡니다. end가 실제 회계연도 마지막 날입니다.',
      '주식 분할 전 해의 주당순이익·주식 수는 분할이 반영되지 않았을 수 있습니다.',
      derived ? '4분기와 현금흐름의 분기 값 일부는 연간·누적 값에서 앞 분기까지를 뺀 값입니다.' : null,
      period === 'quarterly' && !order.length ? '분기 재무 수치를 XBRL로 내지 않는 회사입니다(20-F를 내는 외국 회사 등). 6-K로 낸 분기 실적 자료를 sec_read_filing으로 읽으세요.' : null,
    ]
      .filter(Boolean)
      .join(' '),
  };
}

/** "0001045810-26-000075" → "000104581026000075" (the folder name in the archive) */
export const accessionFolder = (acc: string) => acc.replace(/-/g, '');

/** 8-K item numbers that matter for results */
export const ITEM_LABEL: Record<string, string> = { '2.02': '실적 발표', '7.01': 'IR 자료(Reg FD)', '8.01': '기타 공시', '5.02': '임원 변경', '1.01': '중요 계약', '2.03': '채무 발생', '9.01': '첨부 서류', '5.07': '주총 결과' };

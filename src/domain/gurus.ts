/**
 * 거장 포트폴리오: what well-known managers hold, from the 13F reports they file with the SEC
 * each quarter (US-listed stocks, options and convertibles over $100M of assets, 45 days after the
 * quarter). Parsing, quarter-to-quarter changes, what many of them bought or sold, how close the
 * user's portfolio is to each, and the return of copying a portfolio at each report. Pure.
 */

export interface Guru {
  key: string;
  cik: number;
  person: string;
  firm: string;
  style: string;
  /** Built-in 투자 거장 profile (knowledge.ts) this manager matches */
  sage?: string;
}

/** Managers with a long public record, chosen for how often investors follow their 13F */
export const GURUS: Guru[] = [
  { key: 'buffett', cik: 1067983, person: '워런 버핏', firm: 'Berkshire Hathaway', style: '가치 · 장기 보유', sage: 'buffett' },
  { key: 'ackman', cik: 1336528, person: '빌 애크먼', firm: 'Pershing Square', style: '집중 · 행동주의' },
  { key: 'dalio', cik: 1350694, person: '레이 달리오', firm: 'Bridgewater Associates', style: '매크로 · 분산', sage: 'dalio' },
  { key: 'tepper', cik: 1656456, person: '데이비드 테퍼', firm: 'Appaloosa', style: '역발상 · 부실채권' },
  { key: 'klarman', cik: 1061768, person: '세스 클라만', firm: 'Baupost Group', style: '안전마진 가치' },
  { key: 'icahn', cik: 921669, person: '칼 아이칸', firm: 'Icahn Capital', style: '행동주의' },
  { key: 'loeb', cik: 1040273, person: '대니얼 롭', firm: 'Third Point', style: '행동주의 · 이벤트' },
  { key: 'druckenmiller', cik: 1536411, person: '스탠리 드러켄밀러', firm: 'Duquesne Family Office', style: '매크로 · 성장' },
  { key: 'soros', cik: 1029160, person: '조지 소로스', firm: 'Soros Fund Management', style: '매크로' },
  { key: 'coleman', cik: 1167483, person: '체이스 콜먼', firm: 'Tiger Global', style: '기술 성장' },
  { key: 'mandel', cik: 1061165, person: '스티븐 맨덜', firm: 'Lone Pine Capital', style: '성장 · 롱숏' },
  { key: 'halvorsen', cik: 1103804, person: '안드레아스 할보르센', firm: 'Viking Global', style: '롱숏 · 펀더멘털' },
  { key: 'laffont', cik: 1135730, person: '필립 라퐁', firm: 'Coatue Management', style: '기술 성장' },
  { key: 'lilu', cik: 1709323, person: '리 루', firm: 'Himalaya Capital', style: '집중 가치' },
  { key: 'pabrai', cik: 1549575, person: '모니시 파브라이', firm: 'Dalal Street (Pabrai)', style: '집중 가치' },
  { key: 'akre', cik: 1112520, person: '척 에이커', firm: 'Akre Capital', style: '복리 기업' },
  { key: 'tsmith', cik: 1569205, person: '테리 스미스', firm: 'Fundsmith', style: '우량 성장' },
  { key: 'gayner', cik: 1096343, person: '톰 게이너', firm: 'Markel Group', style: '가치 · 장기 보유' },
  { key: 'russo', cik: 860643, person: '토머스 루소', firm: 'Gardner Russo & Quinn', style: '글로벌 소비재 가치' },
  { key: 'marks', cik: 949509, person: '하워드 막스', firm: 'Oaktree Capital', style: '신용 · 역발상', sage: 'marks' },
  { key: 'singer', cik: 1791786, person: '폴 싱어', firm: 'Elliott Investment Management', style: '행동주의' },
  { key: 'valueact', cik: 1418814, person: '메이슨 모핏', firm: 'ValueAct', style: '행동주의 가치' },
  { key: 'peltz', cik: 1345471, person: '넬슨 펠츠', firm: 'Trian Fund Management', style: '행동주의' },
  { key: 'jsmith', cik: 1517137, person: '제프 스미스', firm: 'Starboard Value', style: '행동주의' },
  { key: 'ainslie', cik: 934639, person: '리 에인슬리', firm: 'Maverick Capital', style: '롱숏' },
  { key: 'robbins', cik: 1138995, person: '래리 로빈스', firm: 'Glenview Capital', style: '헬스케어 · 가치' },
  { key: 'paulson', cik: 1035674, person: '존 폴슨', firm: 'Paulson & Co.', style: '이벤트 · 금' },
  { key: 'weitz', cik: 883965, person: '월리 와이츠', firm: 'Weitz Investment', style: '가치' },
  { key: 'nygren', cik: 813917, person: '빌 나이그렌', firm: 'Harris Associates (Oakmark)', style: '가치' },
  { key: 'dodge', cik: 200217, person: '다지 앤 콕스', firm: 'Dodge & Cox', style: '가치 · 장기' },
  { key: 'hohn', cik: 1647251, person: '크리스 혼', firm: 'TCI Fund Management', style: '집중 · 행동주의' },
  { key: 'watsa', cik: 915191, person: '프렘 왓사', firm: 'Fairfax Financial', style: '가치 · 보험' },
  { key: 'tweedy', cik: 732905, person: '트위디 브라운', firm: 'Tweedy, Browne', style: '그레이엄식 가치' },
  { key: 'hawkins', cik: 807985, person: '메이슨 호킨스', firm: 'Southeastern Asset Management', style: '가치' },
  { key: 'davis', cik: 1036325, person: '크리스 데이비스', firm: 'Davis Selected Advisers', style: '가치 · 금융' },
  { key: 'firsteagle', cik: 1325447, person: '퍼스트 이글', firm: 'First Eagle Investment', style: '글로벌 가치 · 금' },
  { key: 'polen', cik: 1034524, person: '폴렌 캐피털', firm: 'Polen Capital', style: '우량 성장' },
  { key: 'bailliegifford', cik: 1088875, person: '베일리 기포드', firm: 'Baillie Gifford', style: '장기 성장' },
  { key: 'wood', cik: 1697748, person: '캐시 우드', firm: 'ARK Investment', style: '혁신 성장' },
  { key: 'gerstner', cik: 1541617, person: '브래드 거스트너', firm: 'Altimeter Capital', style: '기술 성장' },
  { key: 'sundheim', cik: 1747057, person: '댄 선다임', firm: 'D1 Capital', style: '롱숏 · 성장' },
];

export const guruByKey = (key: string) => GURUS.find((g) => g.key === key) ?? null;

export interface Position {
  cusip: string;
  name: string;
  cls: string;
  /** US dollars */
  value: number;
  shares: number;
  /** 'PUT' | 'CALL' for options, null for the security itself */
  putCall: 'PUT' | 'CALL' | null;
}

const tag = (block: string, name: string) => {
  const m = new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`, 'i').exec(block);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&apos;|&#39;/g, "'").trim() : '';
};

/**
 * A 13F information table (XML, with or without a namespace prefix): one row per CUSIP and
 * option side, summed over the managers and discretion lines it is split into. Values were in
 * thousands of dollars before 2023 (`thousands`).
 */
export function parseInfoTable(xml: string, thousands = false): Position[] {
  const out = new Map<string, Position>();
  for (const m of xml.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi)) {
    const b = m[1];
    const cusip = tag(b, 'cusip').toUpperCase();
    if (!/^[0-9A-Z]{9}$/.test(cusip)) continue;
    const pc = tag(b, 'putCall').toUpperCase();
    const putCall = pc === 'PUT' || pc === 'CALL' ? pc : null;
    const value = Number(tag(b, 'value')) * (thousands ? 1000 : 1);
    const shares = Number(tag(b, 'sshPrnamt'));
    if (!Number.isFinite(value)) continue;
    const k = `${cusip}|${putCall ?? ''}`;
    const cur = out.get(k);
    if (cur) {
      cur.value += value;
      cur.shares += Number.isFinite(shares) ? shares : 0;
    } else out.set(k, { cusip, name: tag(b, 'nameOfIssuer'), cls: tag(b, 'titleOfClass'), value, shares: Number.isFinite(shares) ? shares : 0, putCall });
  }
  return [...out.values()].sort((a, b) => b.value - a.value);
}

/**
 * Some filers kept reporting thousands after the switch to dollars. When the typical implied
 * price per share is under a dollar, the values are taken as thousands.
 */
export function fixUnits(positions: Position[]): Position[] {
  const prices = positions.filter((p) => !p.putCall && p.shares > 0 && p.value > 0).map((p) => p.value / p.shares).sort((a, b) => a - b);
  if (prices.length < 3 || prices[Math.floor(prices.length / 2)] >= 1) return positions;
  return positions.map((p) => ({ ...p, value: p.value * 1000 }));
}

/** Filings from 2023 report values in dollars (SEC rule effective 2023-01-03) */
export const reportsThousands = (filed: string) => filed < '2023-01-03';

/** The information table among a filing's files: the XML that is not the cover page, largest first */
export function infoTableFile(files: { name: string; size?: string | number }[]): string | null {
  const xml = files.filter((f) => /\.xml$/i.test(f.name) && !/primary_doc\.xml$/i.test(f.name));
  xml.sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
  return xml[0]?.name ?? null;
}

export interface Holding {
  cusip: string;
  name: string;
  ticker: string | null;
  value: number;
  shares: number;
  /** fraction of the reported stock portfolio */
  weight: number;
}

/** Stock positions only (options left out), weighted within the report */
export function holdingsOf(positions: Position[], tickers: Map<string, string | null>): Holding[] {
  const stocks = positions.filter((p) => !p.putCall && p.value > 0);
  const total = stocks.reduce((a, p) => a + p.value, 0);
  return stocks.map((p) => ({ cusip: p.cusip, name: p.name, ticker: tickers.get(p.cusip) ?? null, value: p.value, shares: p.shares, weight: total ? p.value / total : 0 }));
}

export type ChangeKind = 'new' | 'add' | 'reduce' | 'sold' | 'same';
export interface Change {
  cusip: string;
  name: string;
  ticker: string | null;
  kind: ChangeKind;
  /** share count change as a fraction of the earlier count; null for new and sold */
  shareChange: number | null;
  /** weight now and before */
  weight: number;
  prevWeight: number;
  /** dollars bought (+) or sold (−), at this quarter's price (sold: last quarter's value) */
  flow: number;
}

/** What changed between two reports; a share count within ±2% is "same" (rounding, splits of fractions) */
export function changesOf(prev: Holding[], cur: Holding[]): Change[] {
  const before = new Map(prev.map((h) => [h.cusip, h]));
  const now = new Map(cur.map((h) => [h.cusip, h]));
  const out: Change[] = [];
  for (const h of cur) {
    const p = before.get(h.cusip);
    const price = h.shares ? h.value / h.shares : 0;
    if (!p) {
      out.push({ cusip: h.cusip, name: h.name, ticker: h.ticker, kind: 'new', shareChange: null, weight: h.weight, prevWeight: 0, flow: h.value });
      continue;
    }
    const ch = p.shares ? h.shares / p.shares - 1 : 0;
    const kind: ChangeKind = ch > 0.02 ? 'add' : ch < -0.02 ? 'reduce' : 'same';
    out.push({ cusip: h.cusip, name: h.name, ticker: h.ticker, kind, shareChange: ch, weight: h.weight, prevWeight: p.weight, flow: kind === 'same' ? 0 : (h.shares - p.shares) * price });
  }
  for (const p of prev) if (!now.has(p.cusip)) out.push({ cusip: p.cusip, name: p.name, ticker: p.ticker, kind: 'sold', shareChange: -1, weight: 0, prevWeight: p.weight, flow: -p.value });
  return out;
}

export interface Consensus {
  cusip: string;
  name: string;
  ticker: string | null;
  /** gurus who bought (new or added) / sold (sold out or cut) */
  gurus: { key: string; kind: ChangeKind; weight: number; flow: number }[];
  flow: number;
}

/** Stocks the most managers bought (or sold) in their latest report, then by dollars */
export function consensus(changes: { key: string; changes: Change[] }[], side: 'buy' | 'sell', limit = 25): Consensus[] {
  const by = new Map<string, Consensus>();
  for (const { key, changes: cs } of changes) {
    for (const c of cs) {
      const hit = side === 'buy' ? c.kind === 'new' || c.kind === 'add' : c.kind === 'sold' || c.kind === 'reduce';
      if (!hit) continue;
      const e = by.get(c.cusip) ?? { cusip: c.cusip, name: c.name, ticker: c.ticker, gurus: [], flow: 0 };
      e.ticker ??= c.ticker;
      e.gurus.push({ key, kind: c.kind, weight: side === 'buy' ? c.weight : c.prevWeight, flow: c.flow });
      e.flow += c.flow;
      by.set(c.cusip, e);
    }
  }
  return [...by.values()].sort((a, b) => b.gurus.length - a.gurus.length || Math.abs(b.flow) - Math.abs(a.flow)).slice(0, limit);
}

export interface Common {
  cusip: string;
  name: string;
  ticker: string | null;
  holders: { key: string; weight: number }[];
  avgWeight: number;
}

/** Stocks held by the most managers, then by their average weight among holders */
export function commonHoldings(books: { key: string; holdings: Holding[] }[], limit = 25): Common[] {
  const by = new Map<string, Common>();
  for (const { key, holdings } of books) {
    for (const h of holdings) {
      const e = by.get(h.cusip) ?? { cusip: h.cusip, name: h.name, ticker: h.ticker, holders: [], avgWeight: 0 };
      e.ticker ??= h.ticker;
      e.holders.push({ key, weight: h.weight });
      by.set(h.cusip, e);
    }
  }
  for (const e of by.values()) e.avgWeight = e.holders.reduce((a, h) => a + h.weight, 0) / e.holders.length;
  return [...by.values()].sort((a, b) => b.holders.length - a.holders.length || b.avgWeight - a.avgWeight).slice(0, limit);
}

/**
 * How much two portfolios overlap: the sum over shared tickers of the smaller weight (0 = nothing
 * shared, 1 = the same portfolio). Both weight maps are over US stocks only.
 */
export function overlap(mine: Map<string, number>, theirs: Map<string, number>): { score: number; shared: { ticker: string; mine: number; theirs: number }[] } {
  const shared: { ticker: string; mine: number; theirs: number }[] = [];
  let score = 0;
  for (const [t, w] of mine) {
    const v = theirs.get(t);
    if (v === undefined) continue;
    score += Math.min(w, v);
    shared.push({ ticker: t, mine: w, theirs: v });
  }
  return { score, shared: shared.sort((a, b) => Math.min(b.mine, b.theirs) - Math.min(a.mine, a.theirs)) };
}

export const normalize = (m: Map<string, number>) => {
  const total = [...m.values()].reduce((a, v) => a + v, 0);
  return new Map([...m].map(([k, v]) => [k, total ? v / total : 0]));
};

interface Close {
  date: string;
  close: number;
}

/** Last close on or before `date` */
function at(closes: Close[], date: string): number | null {
  let hit: number | null = null;
  for (const c of closes) {
    if (c.date > date) break;
    hit = c.close;
  }
  return hit;
}

export interface CloneQuarter {
  /** quarter end the weights are from */
  from: string;
  to: string;
  ret: number | null;
  bench: number | null;
  /** share of the portfolio's weight that had prices */
  covered: number;
}

/**
 * The return of buying each report's portfolio at its quarter end and holding it to the next
 * quarter end (or `today`), compared to a benchmark. Stocks without prices are left out and the
 * rest re-weighted; a quarter where under half the weight is priced has no return.
 */
export function cloneReturns(reports: { date: string; weights: Map<string, number> }[], prices: Map<string, Close[]>, bench: Close[], today: string): CloneQuarter[] {
  const sorted = [...reports].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((r, i) => {
    const to = sorted[i + 1]?.date ?? today;
    let sum = 0, w = 0;
    for (const [t, wt] of r.weights) {
      const c = prices.get(t);
      if (!c) continue;
      const a = at(c, r.date), b = at(c, to);
      if (a === null || b === null || a <= 0) continue;
      sum += wt * (b / a - 1);
      w += wt;
    }
    const total = [...r.weights.values()].reduce((x, v) => x + v, 0) || 1;
    const ba = at(bench, r.date), bb = at(bench, to);
    return { from: r.date, to, ret: w / total >= 0.5 ? sum / w : null, bench: ba && bb ? bb / ba - 1 : null, covered: w / total };
  });
}

/** Compound return, annualized volatility and Sharpe (risk-free `rf` a year) of full quarters */
export function cloneStats(qs: CloneQuarter[], rf = 0.03): { total: number | null; bench: number | null; vol: number | null; sharpe: number | null; quarters: number } {
  const full = qs.filter((q) => q.ret !== null && q.bench !== null);
  if (!full.length) return { total: null, bench: null, vol: null, sharpe: null, quarters: 0 };
  const total = full.reduce((a, q) => a * (1 + q.ret!), 1) - 1;
  const bench = full.reduce((a, q) => a * (1 + q.bench!), 1) - 1;
  if (full.length < 3) return { total, bench, vol: null, sharpe: null, quarters: full.length };
  const rs = full.map((q) => q.ret!);
  const mean = rs.reduce((a, v) => a + v, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((a, v) => a + (v - mean) ** 2, 0) / (rs.length - 1));
  const vol = sd * 2;
  return { total, bench, vol, sharpe: vol ? (mean * 4 - rf) / vol : null, quarters: full.length };
}

/** OpenFIGI mapping answer → the US common-stock ticker, else any US ticker, else null */
export function figiTicker(answer: unknown): string | null {
  const data = (answer as { data?: { ticker?: string; exchCode?: string; securityType?: string; marketSector?: string }[] } | null)?.data;
  if (!Array.isArray(data) || !data.length) return null;
  const us = data.filter((d) => d.exchCode === 'US' && d.ticker);
  const pick = us.find((d) => /Common Stock|ADR|REIT|ETP|Depositary/i.test(d.securityType ?? '')) ?? us[0] ?? data.find((d) => d.ticker);
  return pick?.ticker ? pick.ticker.replace(/\//g, '.').toUpperCase() : null;
}

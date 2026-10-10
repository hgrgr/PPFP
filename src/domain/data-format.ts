/**
 * The import / export format: one sheet per kind of data, with Korean column names. The same
 * columns are written by export, read by import, listed on the format page and filled in the
 * sample files, so an exported file can always be imported again. Pure: rows in, checked
 * records (or row errors) out; the service looks names up and writes.
 */
import type { LotMethod, TxnType } from '@prisma/client';
import { BOOK_STATUS_LABEL } from './knowledge';
import { LOT_METHOD_LABEL } from './lots';
import { TXN_LABEL } from './ledger';

export interface ColumnSpec {
  header: string;
  required?: boolean;
  /** What goes in it, for the format page and the 안내 sheet */
  note: string;
}

export const SHEET_KEYS = ['portfolios', 'transactions', 'journals', 'notes', 'books', 'sages', 'topics'] as const;
export type SheetKey = (typeof SHEET_KEYS)[number];

const LINKS_NOTE = '이어 둘 항목. 줄바꿈이나 ;로 나눕니다. 예: 키워드: 가치투자; 투자 거장: 워런 버핏; 종목: 005930; 책: 현명한 투자자; 자산 성질: 가치주';

export const SHEETS: Record<SheetKey, { name: string; about: string; columns: ColumnSpec[] }> = {
  portfolios: {
    name: '포트폴리오',
    about: '포트폴리오와 상위·하위 구조. 한 포트폴리오가 상위 여러 곳에 속하면 그만큼 줄을 씁니다. 거래 내역보다 먼저 가져옵니다.',
    columns: [
      { header: '이름', required: true, note: '포트폴리오 이름' },
      { header: '상위 포트폴리오', note: '이 포트폴리오를 포함하는 상위 포트폴리오 이름. 비우면 맨 위' },
      { header: '할당(%)', note: '상위 포트폴리오에 포함되는 비율. 비우면 100' },
      { header: 'Lot 방식', note: `매도할 때 기본 Lot 방식: ${Object.values(LOT_METHOD_LABEL).join(', ')} (FIFO처럼 영문도 됨). 비우면 선입선출` },
      { header: '보관', note: 'Y면 보관된 포트폴리오. 비우면 N' },
    ],
  },
  transactions: {
    name: '거래 내역',
    about: '매수·매도·입출금·배당 등. 날짜 순서대로 다시 계산해 보유 종목과 Lot을 만듭니다. 포트폴리오가 없으면 새로 만듭니다.',
    columns: [
      { header: '일시', required: true, note: '한국 시간. 2026-03-02 또는 2026-03-02 10:30' },
      { header: '포트폴리오', required: true, note: '포트폴리오 이름' },
      { header: '유형', required: true, note: `${Object.values(TXN_LABEL).join(', ')} (BUY처럼 영문도 됨)` },
      { header: '종목코드', note: '상장 종목: 6자리 코드, 티커, KRW-BTC. 수기 자산(예금·부동산 등)은 비웁니다' },
      { header: '자산 이름', note: '처음 나오는 종목의 이름. 수기 자산은 필수' },
      { header: '자산 유형', note: '수기 자산에 필수: 채권, 현금·예금, 부동산, 펀드, 대안자산, 부채, 국내 주식·ETF, 해외 주식·ETF' },
      { header: '통화', required: true, note: 'KRW 또는 USD' },
      { header: '수량', note: '매수·매도에 필수. 분할·병합은 비율(2면 1주가 2주)' },
      { header: '단가', note: '매수·매도·평가 갱신에 필수. 수수료 빼고 1주 가격' },
      { header: '금액', note: '입금·출금·배당·이자·수수료·세금에 필수' },
      { header: '수수료', note: '매수·매도 수수료. 비우면 0' },
      { header: '세금', note: '매수·매도 세금. 비우면 0' },
      { header: '환율', note: 'USD 거래에 필수. 1달러당 원' },
      { header: '현금 사용', note: '매수는 포트폴리오 현금에서 내고 매도 대금은 현금으로 받으면 Y, 밖의 돈이면 N. 비우면 Y' },
      { header: 'Lot 방식', note: '매도에만. 비우면 포트폴리오의 기본 방식' },
      { header: '메모', note: '' },
      { header: '거래 ID', note: '내보낸 파일에 적힌 번호. 다시 가져올 때 이미 있는 거래를 건너뜁니다. 새 거래는 비웁니다' },
    ],
  },
  journals: {
    name: '매매일지',
    about: '종목별 매매일지. 연결된 거래는 옮기지 않습니다.',
    columns: [
      { header: '제목', required: true, note: '' },
      { header: '종목코드', note: '상장 종목 코드. 수기 자산은 비우고 자산 이름을 씁니다' },
      { header: '자산 이름', note: '처음 나오는 종목의 이름, 또는 수기 자산 이름' },
      { header: '자산 유형', note: '수기 자산에 필수: 채권, 현금·예금, 부동산, 펀드, 대안자산, 부채, 국내 주식·ETF, 해외 주식·ETF' },
      { header: '통화', note: '처음 나오는 종목의 통화(KRW·USD). 비우면 코드로 짐작' },
      { header: '작성일', note: '2026-03-02. 비우면 오늘' },
      { header: '상태', note: '진행 중 또는 종료. 비우면 진행 중' },
      { header: '목표 예상 가격', required: true, note: '종목 통화 기준' },
      { header: '기준 가격', note: '' },
      { header: '손절가', note: '' },
      { header: '목표 기한', note: '2026-12-31' },
      { header: '양식', note: '매수 계획, 매도 복기, 장기 투자 노트, 단기 매매, 빈 페이지 또는 내 양식 이름' },
      { header: '속성', note: '양식의 속성을 한 줄에 하나씩 "이름: 값". 양식에 없는 이름은 텍스트 속성이 됩니다' },
      { header: '본문', note: '마크다운. 제목(#), 목록(-, 1.), 체크(- [ ]), 인용(>), 표, 이미지, 코드를 씁니다' },
      { header: '일지 ID', note: '내보낸 파일의 번호. 다시 가져올 때 이미 있는 일지를 건너뜁니다' },
    ],
  },
  notes: {
    name: '메모',
    about: '투자 노트의 메모. 본문의 #키워드는 키워드로 이어집니다.',
    columns: [
      { header: '작성일', note: '2026-03-02. 비우면 가져온 때' },
      { header: '본문', required: true, note: '1만 자까지' },
      { header: '고정', note: 'Y면 위에 고정' },
      { header: '연결', note: LINKS_NOTE },
    ],
  },
  books: {
    name: '독서 노트',
    about: '책과 정리한 내용. 같은 제목의 책은 건너뜁니다.',
    columns: [
      { header: '제목', required: true, note: '' },
      { header: '저자', note: '' },
      { header: '출판사', note: '' },
      { header: '출간 연도', note: '2020' },
      { header: '상태', note: `${Object.values(BOOK_STATUS_LABEL).join(', ')}. 비우면 읽는 중` },
      { header: '별점', note: '1~5' },
      { header: '읽기 시작', note: '2026-01-05' },
      { header: '다 읽은 날', note: '2026-02-10' },
      { header: '한 줄 요약', note: '' },
      { header: '본문', note: '마크다운' },
      { header: '연결', note: LINKS_NOTE },
    ],
  },
  sages: {
    name: '투자 거장',
    about: '정리한 투자 거장. 같은 이름은 건너뜁니다.',
    columns: [
      { header: '이름', required: true, note: '' },
      { header: '영문 이름', note: '' },
      { header: '생몰', note: '1930–' },
      { header: '소속', note: '회사·펀드' },
      { header: '핵심 철학', note: '한 문장' },
      { header: '본문', note: '마크다운' },
      { header: '연결', note: LINKS_NOTE },
    ],
  },
  topics: {
    name: '키워드',
    about: '투자 노트의 키워드. 같은 이름은 건너뜁니다. 자산 성질과 이어 두면(예: 가치투자 → 가치주) 그 성질의 종목과 이어집니다.',
    columns: [
      { header: '이름', required: true, note: '#는 빼고 씁니다' },
      { header: '색', note: '#2a78d6처럼. 비우면 기본 색' },
      { header: '설명', note: '' },
      { header: '연결', note: LINKS_NOTE },
    ],
  },
};

/** Sheets in the order import writes them (names before the things that refer to them). */
export const IMPORT_ORDER: SheetKey[] = ['portfolios', 'transactions', 'topics', 'sages', 'books', 'notes', 'journals'];

export const headersOf = (key: SheetKey) => SHEETS[key].columns.map((c) => c.header);

/**
 * Which sheet a header row belongs to: one whose required columns are all there, recognizing
 * the most of the row's column names (at least half of them).
 */
export function detectSheet(headers: string[]): SheetKey | null {
  const have = headers.map((h) => h.trim()).filter(Boolean);
  let best: SheetKey | null = null;
  let score = 0;
  let tied = false;
  for (const key of SHEET_KEYS) {
    const cols = new Set(headersOf(key));
    if (!SHEETS[key].columns.every((c) => !c.required || have.includes(c.header))) continue;
    const s = have.filter((h) => cols.has(h)).length / Math.max(1, have.length);
    if (s > score) [best, score, tied] = [key, s, false];
    else if (s === score) tied = true;
  }
  // Two kinds fit equally well (a CSV of just 이름): let the user pick
  return score >= 0.5 && !tied ? best : null;
}

export const sheetByName = (name: string): SheetKey | null => SHEET_KEYS.find((k) => SHEETS[k].name === name.trim()) ?? null;

// ---------------------------------------------------------------- reading cells

export type Row = Record<string, string>;

export class RowError extends Error {}
const bad = (msg: string): never => {
  throw new RowError(msg);
};

const cell = (r: Row, h: string) => (r[h] ?? '').trim();
function need(r: Row, h: string): string {
  const v = cell(r, h);
  if (!v) bad(`${h}을(를) 채우세요.`);
  return v;
}

/** "1,234.5", "₩1,000", "$12" -> "1234.5" */
export function num(v: string, label: string, opts: { positive?: boolean; allowZero?: boolean } = {}): string {
  let t = v.replace(/[,\s₩$원%]/g, '');
  // Spreadsheets write very small numbers as 1.2e-7
  if (/^-?\d+(\.\d+)?e[-+]?\d+$/i.test(t)) t = Number(t).toFixed(12).replace(/\.?0+$/, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) bad(`${label} '${v}'을(를) 숫자로 쓰세요.`);
  const n = Number(t);
  if (opts.positive && (opts.allowZero ? n < 0 : n <= 0)) bad(`${label}은(는) ${opts.allowZero ? '0 이상' : '0보다 커야'} 합니다.`);
  return t.replace(/^(-?)0+(?=\d)/, '$1');
}
const optNum = (r: Row, h: string, opts: { positive?: boolean; allowZero?: boolean } = {}) => (cell(r, h) ? num(cell(r, h), h, opts) : undefined);

/** "2026-03-02", "2026.3.2", "2026/03/02 10:30" -> KST "2026-03-02T10:30" pieces. */
export function kstDateTime(v: string, label: string): { date: string; time: string } {
  const m = v.trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) bad(`${label} '${v}'을(를) 2026-03-02 또는 2026-03-02 10:30처럼 쓰세요.`);
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m!;
  const date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const t = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== date) bad(`${label} '${v}'은(는) 없는 날짜입니다.`);
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) bad(`${label} '${v}'의 시각을 확인하세요.`);
  return { date, time: `${h.padStart(2, '0')}:${mi.padStart(2, '0')}:${s.padStart(2, '0')}` };
}
const kstInstant = (v: string, label: string) => {
  const { date, time } = kstDateTime(v, label);
  const at = new Date(`${date}T${time}+09:00`);
  if (Number.isNaN(at.getTime())) bad(`${label} '${v}'을(를) 읽지 못했습니다.`);
  return at;
};
const optDate = (r: Row, h: string) => (cell(r, h) ? kstDateTime(cell(r, h), h).date : undefined);

export function yn(v: string, label: string, fallback: boolean): boolean {
  const t = v.trim().toLowerCase();
  if (!t) return fallback;
  if (['y', 'yes', 'true', '1', 'o', '예', '네', '사용'].includes(t)) return true;
  if (['n', 'no', 'false', '0', 'x', '아니오', '아니요', '미사용'].includes(t)) return false;
  return bad(`${label}은(는) Y 또는 N으로 쓰세요.`);
}

/** Label or code -> enum value. */
function pick<T extends string>(labels: Record<T, string>, v: string, label: string): T {
  const t = v.trim();
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  for (const [k, l] of Object.entries(labels) as [T, string][]) {
    if (norm(k) === norm(t) || norm(l) === norm(t) || norm(l.replace(/\s*\(.*\)$/, '')) === norm(t) || l.match(/\(([A-Z]+)\)$/)?.[1]?.toLowerCase() === norm(t)) return k;
  }
  return bad(`${label} '${v}'을(를) 알 수 없습니다. ${Object.values(labels).join(', ')} 중 하나로 쓰세요.`);
}

const TXN_ALIASES: Record<string, TxnType> = { 분할: 'SPLIT', 병합: 'SPLIT', 평가: 'VALUATION', 평가갱신: 'VALUATION' };
export const txnType = (v: string): TxnType => TXN_ALIASES[v.replace(/\s+/g, '')] ?? pick(TXN_LABEL, v, '유형');
export const lotMethod = (v: string, label = 'Lot 방식'): LotMethod => pick(LOT_METHOD_LABEL, v, label);

export const ASSET_TYPES = {
  KR_STOCK: '국내 주식·ETF',
  US_STOCK: '해외 주식·ETF',
  CRYPTO: '가상자산',
  BOND: '채권',
  CASH: '현금·예금',
  REAL_ESTATE: '부동산',
  FUND: '펀드',
  ALTERNATIVE: '대안자산',
  LIABILITY: '부채',
} as const;
export type AssetTypeKey = keyof typeof ASSET_TYPES;

function currency(v: string, label = '통화'): 'KRW' | 'USD' {
  const t = v.trim().toUpperCase();
  if (t === 'KRW' || t === '원') return 'KRW';
  if (t === 'USD' || t === '달러') return 'USD';
  return bad(`${label}는 KRW 또는 USD로 쓰세요.`);
}

/** Links cell -> [{ type, name }] */
export const LINK_TYPES = { note: '메모', book: '책', sage: '투자 거장', topic: '키워드', trait: '자산 성질', asset: '종목' } as const;
export type LinkType = keyof typeof LINK_TYPES;
export function parseLinks(v: string): { type: LinkType; name: string }[] {
  const out: { type: LinkType; name: string }[] = [];
  for (const part of v.split(/[;\n]/)) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (!m) bad(`연결 '${t}'을(를) "키워드: 가치투자"처럼 쓰세요.`);
    const kind = (Object.keys(LINK_TYPES) as LinkType[]).find((k) => LINK_TYPES[k] === m![1].trim() || (k === 'topic' && m![1].trim() === '태그') || (k === 'sage' && m![1].trim() === '거장'));
    if (!kind || kind === 'note') bad(`연결 '${m![1].trim()}'은(는) 키워드, 투자 거장, 책, 종목, 자산 성질 중 하나로 쓰세요.`);
    out.push({ type: kind!, name: m![2].trim().replace(/^#/, '') });
  }
  return out;
}
export const formatLinks = (links: { type: LinkType; name: string }[]) => links.map((l) => `${LINK_TYPES[l.type]}: ${l.name}`).join('; ');

// ---------------------------------------------------------------- records

export interface PortfolioRecord {
  name: string;
  parent: string | null;
  allocation: string;
  lotMethod: LotMethod | null;
  archived: boolean;
}

export interface AssetRef {
  symbol: string | null;
  name: string | null;
  type: AssetTypeKey | null;
  currency: 'KRW' | 'USD';
}

export interface TxnRecord {
  at: Date;
  portfolio: string;
  type: TxnType;
  currency: 'KRW' | 'USD';
  asset: AssetRef | null;
  qty?: string;
  price?: string;
  amount?: string;
  fee?: string;
  tax?: string;
  fxRate?: string;
  useCash: boolean;
  lotMethod: LotMethod | null;
  memo: string;
  id: string | null;
}

export interface JournalRecord {
  title: string;
  asset: AssetRef;
  entryDate?: string;
  closed: boolean;
  targetPrice: string;
  basePrice?: string;
  stopPrice?: string;
  targetDate?: string;
  format: string;
  props: { label: string; value: string }[];
  body: string;
  id: string | null;
}

export interface NoteRecord {
  date?: string;
  body: string;
  pinned: boolean;
  links: { type: LinkType; name: string }[];
}

export interface BookRecord {
  title: string;
  author: string;
  publisher: string;
  year: string;
  status: 'WANT' | 'READING' | 'DONE';
  rating: string;
  startedAt: string;
  finishedAt: string;
  oneLine: string;
  body: string;
  links: { type: LinkType; name: string }[];
}

export interface SageRecord {
  name: string;
  nameEn: string;
  lived: string;
  affiliation: string;
  oneLine: string;
  body: string;
  links: { type: LinkType; name: string }[];
}

export interface TopicRecord {
  name: string;
  color: string;
  description: string;
  links: { type: LinkType; name: string }[];
}

export type RecordOf<K extends SheetKey> = {
  portfolios: PortfolioRecord;
  transactions: TxnRecord;
  journals: JournalRecord;
  notes: NoteRecord;
  books: BookRecord;
  sages: SageRecord;
  topics: TopicRecord;
}[K];

function assetRef(r: Row, required: boolean, ccy?: 'KRW' | 'USD'): AssetRef | null {
  const raw = cell(r, '종목코드').toUpperCase();
  // Excel turns 005930 into 5930: Korean codes are six digits
  const symbol = (/^\d{1,5}$/.test(raw) ? raw.padStart(6, '0') : raw) || null;
  const name = cell(r, '자산 이름') || null;
  const typeText = cell(r, '자산 유형');
  const type = typeText ? pick(ASSET_TYPES, typeText, '자산 유형') : null;
  if (!symbol && !name) return required ? bad('종목코드나 자산 이름을 채우세요.') : null;
  if (!symbol && !type) bad('종목코드가 없는 수기 자산은 자산 유형을 채우세요.');
  const c = cell(r, '통화') ? currency(cell(r, '통화')) : (ccy ?? (symbol && /^\d{6}$|^KRW-/.test(symbol) ? 'KRW' : symbol ? 'USD' : 'KRW'));
  return { symbol, name, type, currency: c };
}

const PARSERS: { [K in SheetKey]: (r: Row) => RecordOf<K> } = {
  portfolios: (r) => ({
    name: need(r, '이름').slice(0, 60),
    parent: cell(r, '상위 포트폴리오') || null,
    allocation: optNum(r, '할당(%)', { positive: true }) ?? '100',
    lotMethod: cell(r, 'Lot 방식') ? lotMethod(cell(r, 'Lot 방식')) : null,
    archived: yn(cell(r, '보관'), '보관', false),
  }),
  transactions: (r) => {
    const type = txnType(need(r, '유형'));
    const ccy = currency(need(r, '통화'));
    const needsAsset = ['BUY', 'SELL', 'SPLIT', 'VALUATION'].includes(type);
    const asset = assetRef(r, needsAsset, ccy);
    if (asset && asset.currency !== ccy) bad('통화가 맞지 않습니다.');
    const t: TxnRecord = {
      at: kstInstant(need(r, '일시'), '일시'),
      portfolio: need(r, '포트폴리오'),
      type,
      currency: ccy,
      asset,
      fee: optNum(r, '수수료', { positive: true, allowZero: true }),
      tax: optNum(r, '세금', { positive: true, allowZero: true }),
      fxRate: optNum(r, '환율', { positive: true }),
      useCash: yn(cell(r, '현금 사용'), '현금 사용', true),
      lotMethod: cell(r, 'Lot 방식') ? lotMethod(cell(r, 'Lot 방식')) : null,
      memo: cell(r, '메모').slice(0, 500),
      id: cell(r, '거래 ID') || null,
    };
    if (type === 'BUY' || type === 'SELL') {
      t.qty = num(need(r, '수량'), '수량', { positive: true });
      t.price = num(need(r, '단가'), '단가', { positive: true, allowZero: true });
    } else if (type === 'VALUATION') t.price = num(need(r, '단가'), '단가', { positive: true, allowZero: true });
    else if (type === 'SPLIT') t.qty = num(need(r, '수량'), '수량(비율)', { positive: true });
    else t.amount = num(need(r, '금액'), '금액', { positive: true });
    if (ccy === 'USD' && type !== 'SPLIT' && !t.fxRate) bad('USD 거래는 환율을 채우세요.');
    return t;
  },
  journals: (r) => ({
    title: need(r, '제목').slice(0, 120),
    asset: assetRef(r, true)!,
    entryDate: optDate(r, '작성일'),
    closed: /^(종료|closed)$/i.test(cell(r, '상태')),
    targetPrice: num(need(r, '목표 예상 가격'), '목표 예상 가격', { positive: true }),
    basePrice: optNum(r, '기준 가격', { positive: true }),
    stopPrice: optNum(r, '손절가', { positive: true }),
    targetDate: optDate(r, '목표 기한'),
    format: cell(r, '양식'),
    props: cell(r, '속성')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        // Export writes "이름: 값"; a colon inside the name or a URL value stays put
        const m = l.match(/^(.+?)[:：]\s(.*)$/) ?? l.match(/^([^:：]+)[:：](.*)$/);
        if (!m) bad(`속성 '${l}'을(를) "이름: 값"으로 쓰세요.`);
        return { label: m![1].trim(), value: m![2].trim() };
      }),
    body: cell(r, '본문'),
    id: cell(r, '일지 ID') || null,
  }),
  notes: (r) => ({ date: optDate(r, '작성일'), body: need(r, '본문').slice(0, 10_000), pinned: yn(cell(r, '고정'), '고정', false), links: parseLinks(cell(r, '연결')) }),
  books: (r) => {
    const s = cell(r, '상태');
    const rating = cell(r, '별점');
    if (rating && !/^[1-5]$/.test(rating)) bad('별점은 1~5로 쓰세요.');
    const year = cell(r, '출간 연도');
    if (year && !/^\d{4}$/.test(year)) bad('출간 연도는 2020처럼 네 자리로 쓰세요.');
    return {
      title: need(r, '제목').slice(0, 200),
      author: cell(r, '저자'),
      publisher: cell(r, '출판사'),
      year,
      status: s ? pick(BOOK_STATUS_LABEL, s, '상태') : 'READING',
      rating,
      startedAt: optDate(r, '읽기 시작') ?? '',
      finishedAt: optDate(r, '다 읽은 날') ?? '',
      oneLine: cell(r, '한 줄 요약'),
      body: cell(r, '본문'),
      links: parseLinks(cell(r, '연결')),
    };
  },
  sages: (r) => ({ name: need(r, '이름').slice(0, 60), nameEn: cell(r, '영문 이름'), lived: cell(r, '생몰'), affiliation: cell(r, '소속'), oneLine: cell(r, '핵심 철학'), body: cell(r, '본문'), links: parseLinks(cell(r, '연결')) }),
  topics: (r) => {
    const color = cell(r, '색');
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) bad('색은 #2a78d6처럼 쓰세요.');
    return { name: need(r, '이름').replace(/^#/, '').slice(0, 30), color, description: cell(r, '설명').slice(0, 300), links: parseLinks(cell(r, '연결')) };
  },
};

export interface Parsed<K extends SheetKey> {
  /** Row number in the file (the header is row 1) */
  line: number;
  record?: RecordOf<K>;
  error?: string;
}

/** Checks every row of a sheet. Blank rows are skipped. */
export function parseSheet<K extends SheetKey>(key: K, rows: Row[], firstLine = 2): Parsed<K>[] {
  const out: Parsed<K>[] = [];
  rows.forEach((r, i) => {
    if (!Object.values(r).some((v) => String(v ?? '').trim())) return;
    try {
      out.push({ line: firstLine + i, record: PARSERS[key](r) as RecordOf<K> });
    } catch (e) {
      if (!(e instanceof RowError)) throw e;
      out.push({ line: firstLine + i, error: e.message });
    }
  });
  return out;
}

// ---------------------------------------------------------------- samples

/** Example rows for each sheet: made up, consistent with each other, and importable as is. */
export const SAMPLES: Record<SheetKey, Row[]> = {
  portfolios: [
    { 이름: '순자산', 'Lot 방식': '선입선출 (FIFO)' },
    { 이름: '미국 주식', '상위 포트폴리오': '순자산', '할당(%)': '100', 'Lot 방식': 'FIFO' },
    { 이름: '국내 주식', '상위 포트폴리오': '순자산', '할당(%)': '100' },
    { 이름: '안전 자산', '상위 포트폴리오': '순자산', '할당(%)': '100' },
  ],
  transactions: [
    { 일시: '2026-01-02 09:00', 포트폴리오: '미국 주식', 유형: '입금', 통화: 'USD', 금액: '10000', 환율: '1380', 메모: '달러 환전 후 입금' },
    { 일시: '2026-01-05 23:40', 포트폴리오: '미국 주식', 유형: '매수', 종목코드: 'AAPL', '자산 이름': '애플', 통화: 'USD', 수량: '10', 단가: '230.5', 수수료: '1.15', 환율: '1385' },
    { 일시: '2026-02-14', 포트폴리오: '미국 주식', 유형: '배당', 종목코드: 'AAPL', 통화: 'USD', 금액: '2.21', 환율: '1390' },
    { 일시: '2026-03-10 23:35', 포트폴리오: '미국 주식', 유형: '매도', 종목코드: 'AAPL', 통화: 'USD', 수량: '4', 단가: '248', 수수료: '0.5', 환율: '1395', 'Lot 방식': 'FIFO', 메모: '목표 비중 맞추기' },
    { 일시: '2026-01-06 09:30', 포트폴리오: '국내 주식', 유형: '매수', 종목코드: '005930', '자산 이름': '삼성전자', 통화: 'KRW', 수량: '20', 단가: '71500', 수수료: '210', '현금 사용': 'N' },
    { 일시: '2026-01-10', 포트폴리오: '안전 자산', 유형: '매수', '자산 이름': '정기예금 (12개월)', '자산 유형': '현금·예금', 통화: 'KRW', 수량: '1', 단가: '10000000', '현금 사용': 'N' },
    { 일시: '2026-06-30', 포트폴리오: '안전 자산', 유형: '평가 갱신', '자산 이름': '정기예금 (12개월)', '자산 유형': '현금·예금', 통화: 'KRW', 단가: '10165000', 메모: '반기 이자 반영' },
  ],
  journals: [
    {
      제목: '애플 1차 매수 계획',
      종목코드: 'AAPL',
      '자산 이름': '애플',
      통화: 'USD',
      작성일: '2026-01-05',
      상태: '진행 중',
      '목표 예상 가격': '280',
      '기준 가격': '230.5',
      손절가: '205',
      '목표 기한': '2026-12-31',
      양식: '매수 계획',
      속성: '진입 방식: 분할 매수\n투자 기간: 장기 (1년 이상)\n확신도: 4',
      본문: '## 매수 근거\n\n- 서비스 매출 비중이 커지며 이익률이 오름\n- 자사주 매입이 꾸준함\n\n## 리스크\n\n- [ ] 규제로 앱스토어 수수료가 줄어들 가능성 점검',
    },
  ],
  notes: [
    { 작성일: '2026-01-07', 본문: '비중이 커진 종목은 감정이 아니라 목표 비중표로 정리하기 #리스크_관리', 고정: 'Y' },
    { 작성일: '2026-02-01', 본문: '반도체 업황 바닥 신호. PBR 1배 아래면 분할 매수 검토', 연결: '키워드: 가치투자; 종목: 005930' },
  ],
  books: [
    {
      제목: '현명한 투자자',
      저자: '벤저민 그레이엄',
      출판사: '국일증권경제연구소',
      '출간 연도': '2020',
      상태: '다 읽음',
      별점: '5',
      '읽기 시작': '2026-01-05',
      '다 읽은 날': '2026-02-10',
      '한 줄 요약': '시장의 기분에 휘둘리지 말고, 안전마진을 두고 산다.',
      본문: '## 핵심 아이디어\n\n- 투자와 투기를 구분한다\n- 안전마진: 내재가치보다 충분히 싸게 산다\n\n## 내 투자에 적용할 점\n\n- [x] 매수 전에 일지에 내재가치 추정을 적는다',
      연결: '키워드: 가치투자; 투자 거장: 벤저민 그레이엄',
    },
  ],
  sages: [
    { 이름: '벤저민 그레이엄', '영문 이름': 'Benjamin Graham', 생몰: '1894–1976', 소속: '그레이엄-뉴먼', '핵심 철학': '내재가치보다 충분히 싸게 사서 안전마진을 확보한다.', 본문: '## 핵심 원칙\n\n- 미스터 마켓의 제안은 따를 의무가 없다\n- 안전마진', 연결: '키워드: 가치투자' },
  ],
  topics: [
    { 이름: '가치투자', 색: '#2a78d6', 설명: '내재가치보다 싸게 사는 투자', 연결: '자산 성질: 가치주' },
    { 이름: '리스크 관리', 색: '#eb6834', 설명: '비중·손절·분산' },
  ],
};

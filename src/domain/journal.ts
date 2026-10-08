/**
 * Trade journal: formats (templates), custom properties, and the checks the
 * server runs on what the editor sends.
 *
 * An entry always has the fixed properties stored in their own columns (asset,
 * target price, base price, stop, target date, status). A format adds custom
 * properties (FieldDef) and a starting body. The body is a BlockNote document:
 * an array of blocks, kept as JSON. Nothing here imports the editor, so the
 * rules are unit tested on plain objects.
 */

export const FIELD_TYPES = ['text', 'number', 'price', 'percent', 'date', 'select', 'rating', 'checkbox', 'url'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: '텍스트',
  number: '숫자',
  price: '가격',
  percent: '퍼센트',
  date: '날짜',
  select: '선택',
  rating: '별점 (1~5)',
  checkbox: '체크박스',
  url: '링크',
};

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** select only */
  options?: string[];
}

/** A property as stored on an entry: its definition plus the value ('' when empty). */
export interface FieldValue extends FieldDef {
  value: string;
}

export const LIMITS = {
  fields: 30,
  label: 40,
  options: 30,
  option: 40,
  value: 2_000,
  title: 120,
  /** Serialized body size */
  contentBytes: 1_000_000,
  depth: 12,
  text: 20_000,
} as const;

export class JournalInputError extends Error {}

const fail = (msg: string): never => {
  throw new JournalInputError(msg);
};

// ── custom properties ───────────────────────────────

/** Check a format's property list from the template editor. Keys are made unique and stable. */
export function parseFieldDefs(input: unknown): FieldDef[] {
  if (!Array.isArray(input)) fail('속성 목록 형식이 올바르지 않습니다.');
  const list = input as unknown[];
  if (list.length > LIMITS.fields) fail(`속성은 ${LIMITS.fields}개까지 만들 수 있습니다.`);
  const seen = new Set<string>();
  return list.map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const label = String(r.label ?? '').trim();
    if (!label) fail(`${i + 1}번째 속성의 이름을 입력하세요.`);
    if (label.length > LIMITS.label) fail(`속성 이름은 ${LIMITS.label}자 이내로 입력하세요: ${label.slice(0, 20)}…`);
    const type = String(r.type ?? '') as FieldType;
    if (!FIELD_TYPES.includes(type)) fail(`'${label}' 속성의 종류를 고르세요.`);
    let key = String(r.key ?? '').trim() || slug(label) || `f${i + 1}`;
    if (!/^[\w-]{1,40}$/.test(key)) key = `f${i + 1}`;
    while (seen.has(key)) key = `${key}_${i + 1}`;
    seen.add(key);
    const def: FieldDef = { key, label, type };
    if (type === 'select') {
      const opts = Array.isArray(r.options) ? r.options : String(r.options ?? '').split(',');
      const options = [...new Set(opts.map((o) => String(o).trim()).filter(Boolean))];
      if (!options.length) fail(`'${label}' 선택지는 하나 이상 있어야 합니다.`);
      if (options.length > LIMITS.options) fail(`'${label}' 선택지는 ${LIMITS.options}개까지입니다.`);
      if (options.some((o) => o.length > LIMITS.option)) fail(`'${label}' 선택지는 ${LIMITS.option}자 이내로 입력하세요.`);
      def.options = options;
    }
    return def;
  });
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);
}

const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const isNum = (v: string) => /^-?\d+(\.\d+)?$/.test(v);

/** Check one property value against its definition. Returns the normalized value; '' means empty. */
export function normalizeFieldValue(def: FieldDef, raw: unknown): string {
  let v = raw === undefined || raw === null ? '' : String(raw).trim();
  if (v.length > LIMITS.value) fail(`'${def.label}' 값이 너무 깁니다.`);
  if (v === '') return '';
  switch (def.type) {
    case 'number':
    case 'price':
    case 'percent':
      v = v.replace(/[,\s%₩$]/g, '');
      if (!isNum(v)) fail(`'${def.label}'에는 숫자를 입력하세요.`);
      return v;
    case 'date':
      if (!isYmd(v)) fail(`'${def.label}' 날짜 형식을 확인하세요.`);
      return v;
    case 'select':
      if (!def.options?.includes(v)) fail(`'${def.label}'은(는) 목록에서 고르세요.`);
      return v;
    case 'rating': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) fail(`'${def.label}'은(는) 1~5 사이로 고르세요.`);
      return String(n);
    }
    case 'checkbox':
      return v === 'true' || v === 'on' || v === '1' ? 'true' : '';
    case 'url':
      if (!safeHref(v) || v.startsWith('/')) fail(`'${def.label}'에는 http(s) 주소를 입력하세요.`);
      return v;
    default:
      return v;
  }
}

/** Entry properties: the definitions it carries (from its format) with their values. */
export function normalizeFieldValues(defs: FieldDef[], values: Record<string, unknown>): FieldValue[] {
  return parseFieldDefs(defs).map((d) => ({ ...d, value: normalizeFieldValue(d, values[d.key]) }));
}

// ── body ────────────────────────────────────────────

/** http(s), mailto, or a path on this site. Blocks javascript:, data: and the like. */
export function safeHref(href: string): boolean {
  const h = href.trim();
  if (h.startsWith('/') && !h.startsWith('//')) return true;
  return /^(https?:\/\/|mailto:)/i.test(h);
}

/** Media may come from our own upload endpoint or any https/http address. */
function safeMediaUrl(url: string): boolean {
  const u = url.trim();
  return u === '' || u.startsWith('/api/journal/images/') || /^https?:\/\//i.test(u);
}

/**
 * Check a body from the editor: an array of blocks within size and depth limits,
 * with unsafe links and media addresses removed. Returns the cleaned blocks.
 */
export function sanitizeContent(input: unknown): unknown[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) fail('본문 형식이 올바르지 않습니다.');
  const json = JSON.stringify(input);
  if (json.length > LIMITS.contentBytes) fail('본문이 너무 큽니다. 이미지는 붙여넣기 대신 업로드를 사용하세요.');
  // Round-trip through JSON: the editor leaves `undefined` in places (table column widths) that a JSON column cannot hold.
  return clean(JSON.parse(json), 0) as unknown[];
}

function clean(node: unknown, depth: number): unknown {
  if (depth > LIMITS.depth * 4) fail('본문의 중첩이 너무 깊습니다.');
  if (Array.isArray(node)) return node.map((n) => clean(n, depth + 1));
  if (!node || typeof node !== 'object') return node;
  const o = { ...(node as Record<string, unknown>) };
  // inline link
  if (o.type === 'link' && typeof o.href === 'string' && !safeHref(o.href)) {
    return { type: 'text', text: textOf(o.content), styles: {} };
  }
  if (o.props && typeof o.props === 'object') {
    const props = { ...(o.props as Record<string, unknown>) };
    if (typeof props.url === 'string' && !safeMediaUrl(props.url)) props.url = '';
    o.props = props;
  }
  for (const k of ['content', 'children', 'rows', 'cells']) if (k in o) o[k] = clean(o[k], depth + 1);
  return o;
}

function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).join('');
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    return textOf(o.content);
  }
  return '';
}

/** Plain text of a body: one line per block, table cells separated by " | ". */
export function plainText(blocks: unknown): string {
  const lines: string[] = [];
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const b of list) {
      if (!b || typeof b !== 'object') continue;
      const o = b as Record<string, unknown>;
      const c = o.content as Record<string, unknown> | unknown[] | undefined;
      if (c && !Array.isArray(c) && c.type === 'tableContent' && Array.isArray(c.rows)) {
        for (const row of c.rows as { cells?: unknown[] }[]) {
          const cells = (row.cells ?? []).map((x) => textOf(x).trim()).filter(Boolean);
          if (cells.length) lines.push(cells.join(' | '));
        }
      } else {
        const props = (o.props ?? {}) as Record<string, unknown>;
        const t = [textOf(c), typeof props.caption === 'string' ? props.caption : '', typeof props.title === 'string' ? props.title : ''].filter(Boolean).join(' ');
        if (t.trim()) lines.push(t.trim());
      }
      walk(o.children);
    }
  };
  walk(blocks);
  return lines.join('\n').slice(0, LIMITS.text);
}

// ── target price ────────────────────────────────────

export interface TargetProgress {
  /** Target above the base price (a rise is expected) or below it. */
  direction: 'up' | 'down';
  /** Share of the way from base to target already covered; may be negative or above 1. */
  ratio: number | null;
  /** Current price is at or beyond the target. */
  reached: boolean;
  /** Change still needed from the current price to the target. */
  remaining: number | null;
}

export function targetProgress(target: string | number, base: string | number | null | undefined, current: string | number | null | undefined): TargetProgress {
  const t = Number(target);
  const b = base === null || base === undefined || base === '' ? null : Number(base);
  const c = current === null || current === undefined || current === '' ? null : Number(current);
  const direction: 'up' | 'down' = b !== null && t < b ? 'down' : 'up';
  const reached = c !== null && (direction === 'up' ? c >= t : c <= t);
  const ratio = b !== null && c !== null && t !== b ? (c - b) / (t - b) : null;
  const remaining = c !== null && c !== 0 ? t / c - 1 : null;
  return { direction, ratio, reached, remaining };
}

// ── formats ─────────────────────────────────────────

type Inline = string;
const h = (text: Inline) => ({ type: 'heading', props: { level: 2 }, content: text });
const p = (text: Inline = '') => ({ type: 'paragraph', content: text });
const bullet = (text: Inline) => ({ type: 'bulletListItem', content: text });
const check = (text: Inline) => ({ type: 'checkListItem', props: { checked: false }, content: text });
const quote = (text: Inline) => ({ type: 'quote', content: text });
const table = (rows: string[][]) => ({ type: 'table', content: { type: 'tableContent', headerRows: 1, rows: rows.map((cells) => ({ cells })) } });
const stockChart = () => ({ type: 'stockChart', props: { symbol: '', interval: 'D' } });

export interface JournalFormat {
  /** "builtin:<key>" for the recommended formats, the template id for the user's own. */
  id: string;
  name: string;
  description: string;
  fields: FieldDef[];
  content: unknown[];
}

const HORIZON = ['단타 (며칠)', '스윙 (몇 주)', '중기 (몇 달)', '장기 (1년 이상)'];

export const BUILTIN_FORMATS: JournalFormat[] = [
  {
    id: 'builtin:buy',
    name: '매수 계획',
    description: '사기 전에 근거·시나리오·손절 조건을 정리합니다.',
    fields: [
      { key: 'entry', label: '진입 방식', type: 'select', options: ['일괄 매수', '분할 매수', '추가 매수(물타기·불타기)'] },
      { key: 'horizon', label: '투자 기간', type: 'select', options: HORIZON },
      { key: 'weight', label: '목표 비중', type: 'percent' },
      { key: 'conviction', label: '확신도', type: 'rating' },
    ],
    content: [
      h('매수 근거'),
      bullet('펀더멘털: '),
      bullet('차트·수급: '),
      bullet('촉매(이벤트·일정): '),
      h('시나리오'),
      table([
        ['시나리오', '예상 가격', '대응'],
        ['좋을 때', '', ''],
        ['보통', '', ''],
        ['나쁠 때', '', ''],
      ]),
      h('리스크와 손절 조건'),
      p(),
      h('매수 전 체크리스트'),
      check('실적 발표일·배당락일 확인'),
      check('포트폴리오 비중 한도 안인지 확인'),
      check('손절가를 정하고 기록'),
      h('참고 자료'),
      p(),
    ],
  },
  {
    id: 'builtin:sell',
    name: '매도 복기',
    description: '판 뒤에 처음 계획과 비교해 잘한 점·아쉬운 점을 남깁니다.',
    fields: [
      { key: 'reason', label: '매도 사유', type: 'select', options: ['목표가 도달', '손절', '전략 변경', '리밸런싱', '현금 필요', '기타'] },
      { key: 'followed', label: '계획대로 했나', type: 'select', options: ['예', '일부만', '아니오'] },
      { key: 'emotion', label: '그때 감정', type: 'select', options: ['차분', '불안', '탐욕', '조급', '확신'] },
      { key: 'score', label: '이번 매매 점수', type: 'rating' },
    ],
    content: [
      h('매도 사유'),
      p(),
      h('처음 계획과 비교'),
      table([
        ['항목', '계획', '실제'],
        ['가격', '', ''],
        ['기간', '', ''],
        ['비중', '', ''],
      ]),
      h('잘한 점'),
      bullet(''),
      h('아쉬운 점'),
      bullet(''),
      h('다음 매매에 바꿀 것'),
      check(''),
    ],
  },
  {
    id: 'builtin:thesis',
    name: '장기 투자 노트',
    description: '오래 들고 갈 종목의 투자 아이디어와 점검 기준을 적습니다.',
    fields: [
      { key: 'horizon', label: '투자 기간', type: 'select', options: HORIZON },
      { key: 'fair', label: '적정 가치', type: 'price' },
      { key: 'review', label: '점검 주기', type: 'select', options: ['매월', '분기', '반기', '연 1회'] },
      { key: 'conviction', label: '확신도', type: 'rating' },
    ],
    content: [
      quote('이 회사를 한 줄로: '),
      h('투자 아이디어'),
      p(),
      h('경쟁력 · 해자'),
      bullet(''),
      h('핵심 지표'),
      table([
        ['지표', '지금', '기대'],
        ['매출 성장률', '', ''],
        ['영업이익률', '', ''],
        ['PER', '', ''],
      ]),
      h('생각이 틀렸다고 볼 조건'),
      bullet(''),
      h('점검 기록'),
      p(),
    ],
  },
  {
    id: 'builtin:swing',
    name: '단기 매매',
    description: '차트를 보며 진입·청산 기준을 짧게 적습니다.',
    fields: [
      { key: 'setup', label: '셋업', type: 'select', options: ['돌파', '눌림목', '반등', '추세 추종', '기타'] },
      { key: 'rr', label: '손익비', type: 'number' },
      { key: 'conviction', label: '확신도', type: 'rating' },
    ],
    content: [h('차트'), stockChart(), h('진입 근거'), bullet(''), h('청산 계획'), bullet('익절: '), bullet('손절: '), h('결과'), p()],
  },
  {
    id: 'builtin:blank',
    name: '빈 페이지',
    description: '속성 없이 자유롭게 씁니다.',
    fields: [],
    content: [p()],
  },
];

/**
 * Formats in recommended order for an entry about these transactions:
 * a sale → review, a purchase → buy plan, nothing linked → long-term note.
 */
export function recommendFormats(txnTypes: readonly string[]): { order: string[]; reason: string } {
  const ids = BUILTIN_FORMATS.map((f) => f.id);
  const first = (id: string) => [id, ...ids.filter((x) => x !== id)];
  if (txnTypes.includes('SELL')) return { order: first('builtin:sell'), reason: '매도 거래가 연결되어 있어 매도 복기를 추천합니다.' };
  if (txnTypes.includes('BUY')) return { order: first('builtin:buy'), reason: '매수 거래가 연결되어 있어 매수 계획을 추천합니다.' };
  return { order: first('builtin:thesis'), reason: '연결된 거래가 없어 장기 투자 노트를 추천합니다. 거래를 연결하면 추천이 바뀝니다.' };
}

export const STATUS_LABEL = { OPEN: '진행 중', CLOSED: '종료' } as const;

// ── chart block ─────────────────────────────────────

export interface ChartData {
  series: string[];
  rows: Record<string, string | number>[];
}

/**
 * Data typed into a chart block: the first line names the columns (label, then
 * one column per series), each further line is one point. Tabs (pasted from a
 * spreadsheet) or commas separate columns; thousands separators inside a
 * tab-separated number are fine.
 */
export function parseChartData(text: string): ChartData {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 201);
  if (lines.length < 2) return { series: [], rows: [] };
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const cols = (l: string) => l.split(sep).map((c) => c.trim());
  const head = cols(lines[0]);
  const series = head.slice(1, 9).map((s, i) => s || `값${i + 1}`);
  const rows = lines.slice(1).map((l) => {
    const c = cols(l);
    const row: Record<string, string | number> = { label: c[0] ?? '' };
    series.forEach((s, i) => {
      const n = Number((c[i + 1] ?? '').replace(/[,%\s₩$]/g, ''));
      row[s] = Number.isFinite(n) ? n : 0;
    });
    return row;
  });
  return { series, rows };
}

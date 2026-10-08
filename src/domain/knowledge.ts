/**
 * Notes, book summaries and investor profiles, and how they connect to each
 * other and to the portfolio. Everything is an undirected link between two
 * items (note, book, sage, topic, trait, asset); a topic can also point at
 * traits (가치투자 → 가치주), which is how a 가치주 stock finds Buffett and
 * Buffett finds the user's 가치주 stocks. Pure; the service reads the links.
 */

export const KTYPES = ['note', 'book', 'sage', 'topic', 'trait', 'asset'] as const;
export type KType = (typeof KTYPES)[number];

export interface KRef {
  type: KType;
  id: string;
}

export const KTYPE_LABEL: Record<KType, string> = { note: '메모', book: '책', sage: '투자 거장', topic: '키워드', trait: '자산 성질', asset: '종목' };

export const isKType = (v: unknown): v is KType => typeof v === 'string' && (KTYPES as readonly string[]).includes(v);
export const key = (r: KRef) => `${r.type}:${r.id}`;

/** One stored order for a pair, so a link exists once whichever side created it. */
export function canonical(x: KRef, y: KRef): { a: KRef; b: KRef } {
  const ix = KTYPES.indexOf(x.type), iy = KTYPES.indexOf(y.type);
  return ix < iy || (ix === iy && x.id <= y.id) ? { a: x, b: y } : { a: y, b: x };
}

/** `#가치투자 #리스크_관리` → ['가치투자', '리스크 관리'] (`_` stands for a space). Pure numbers (#1) are not tags. */
export function hashtags(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_·-]{1,30})/gu)) {
    const t = m[2].replace(/[·-]+$/, '').replace(/_+/g, ' ').trim();
    if (t && !/^\d+$/.test(t)) out.add(t);
  }
  return [...out];
}

// ── related items ───────────────────────────────────

export interface Related {
  ref: KRef;
  /** How it is reached: null = linked directly, otherwise the trait or topic in between */
  via: (KRef | null)[];
}

/**
 * What relates to `ref`, directly or through traits and topics.
 * - an asset reaches what is linked to its traits, and to topics linked to those traits;
 * - a note, book, sage or topic reaches the traits it (or its topics) point at, and the
 *   assets carrying those traits;
 * - a trait reaches its topics, what those topics are linked to, and its assets.
 */
export function related(ref: KRef, links: { a: KRef; b: KRef }[], assetTraits: ReadonlyMap<string, readonly string[]>): Related[] {
  const adj = new Map<string, KRef[]>();
  const add = (x: KRef, y: KRef) => adj.set(key(x), [...(adj.get(key(x)) ?? []), y]);
  for (const l of links) {
    add(l.a, l.b);
    add(l.b, l.a);
  }
  // Asset → trait tags count as links too
  const traitAssets = new Map<string, string[]>();
  for (const [assetId, traits] of assetTraits) for (const t of traits) traitAssets.set(t, [...(traitAssets.get(t) ?? []), assetId]);
  const N = (r: KRef): KRef[] => {
    const base = adj.get(key(r)) ?? [];
    if (r.type === 'asset') return [...base, ...(assetTraits.get(r.id) ?? []).map((id) => ({ type: 'trait' as const, id }))];
    if (r.type === 'trait') return [...base, ...(traitAssets.get(r.id) ?? []).map((id) => ({ type: 'asset' as const, id }))];
    return base;
  };

  const out = new Map<string, Related>();
  const put = (r: KRef, via: KRef | null) => {
    if (key(r) === key(ref)) return;
    const cur = out.get(key(r));
    if (!cur) out.set(key(r), { ref: r, via: [via] });
    else if (!cur.via.some((v) => (v ? key(v) : null) === (via ? key(via) : null))) cur.via.push(via);
  };
  const direct = N(ref);
  for (const d of direct) put(d, null);
  const isItem = (r: KRef) => r.type === 'note' || r.type === 'book' || r.type === 'sage';

  if (ref.type === 'asset') {
    for (const t of direct.filter((d) => d.type === 'trait')) {
      for (const n of N(t)) {
        if (isItem(n) || n.type === 'topic') put(n, t);
        if (n.type === 'topic') for (const m of N(n)) if (isItem(m)) put(m, n);
      }
    }
    return [...out.values()];
  }

  // Traits this item stands for, directly or through its topics (or itself, for a trait)
  const traits = new Map<string, KRef | null>();
  if (ref.type === 'trait') traits.set(ref.id, null);
  for (const d of direct) {
    if (d.type === 'trait') traits.set(d.id, null);
    if (d.type === 'topic') {
      for (const n of N(d)) {
        if (n.type === 'trait' && !traits.has(n.id)) {
          traits.set(n.id, d);
          put(n, d);
        }
        if (ref.type === 'trait' && isItem(n)) put(n, d);
      }
    }
  }
  for (const [t] of traits) {
    const tr = { type: 'trait' as const, id: t };
    for (const a of traitAssets.get(t) ?? []) put({ type: 'asset', id: a }, ref.type === 'trait' ? null : tr);
  }
  return [...out.values()];
}

// ── presets ─────────────────────────────────────────

export interface TopicPreset {
  name: string;
  color: string;
  description: string;
  /** Trait names it implies, matched against the user's traits */
  traits: string[];
}

export const TOPIC_PRESETS: TopicPreset[] = [
  { name: '가치투자', color: '#2a78d6', description: '내재가치보다 싸게 사서 제값을 받을 때까지 기다리는 투자', traits: ['가치주'] },
  { name: '성장투자', color: '#eb6834', description: '이익이 빠르게 커질 기업에 투자', traits: ['성장주'] },
  { name: '배당투자', color: '#1baf7a', description: '꾸준한 배당으로 현금흐름을 만드는 투자', traits: ['배당주'] },
  { name: '지수투자', color: '#7a5af8', description: '시장 전체를 낮은 비용으로 사서 오래 들고 가는 투자', traits: ['핵심'] },
  { name: '자산배분', color: '#eda100', description: '경제 국면이 바뀌어도 버티도록 자산을 나눠 담는 투자', traits: ['성장 상승', '성장 하락', '물가 상승', '물가 하락'] },
  { name: '역발상', color: '#c2410c', description: '모두가 비관할 때 사고 낙관할 때 파는 투자', traits: [] },
  { name: '안전마진', color: '#2a78d6', description: '가치와 가격의 차이로 실수에 대비하는 여유', traits: ['가치주'] },
  { name: '경제적 해자', color: '#008300', description: '경쟁자가 넘보기 어려운 오래가는 경쟁력', traits: ['우량 대형주'] },
  { name: '장기보유', color: '#1baf7a', description: '좋은 기업을 오래 들고 복리로 키우는 습관', traits: [] },
  { name: '리스크 관리', color: '#e34948', description: '얼마를 벌지보다 얼마를 잃을 수 있는지 먼저 따지기', traits: [] },
];

const h = (text: string) => ({ type: 'heading', props: { level: 2 }, content: text });
const p = (text: string) => ({ type: 'paragraph', content: text });
const li = (text: string) => ({ type: 'bulletListItem', content: text });
const quote = (text: string) => ({ type: 'quote', content: text });

export interface SagePreset {
  key: string;
  name: string;
  nameEn: string;
  lived: string;
  affiliation: string;
  oneLine: string;
  principles: string[];
  books: string[];
  topics: string[];
  traits: string[];
}

/** Well-known investors, summarized from their own books and letters. */
export const SAGE_PRESETS: SagePreset[] = [
  {
    key: 'buffett',
    name: '워런 버핏',
    nameEn: 'Warren Buffett',
    lived: '1930–',
    affiliation: '버크셔 해서웨이',
    oneLine: '이해할 수 있는 훌륭한 기업을 적정한 가격에 사서 오래 보유한다.',
    principles: ['능력 범위 안의, 이해할 수 있는 사업에만 투자한다', '오래가는 경쟁 우위(경제적 해자)와 정직하고 유능한 경영진을 본다', '시장 가격이 아니라 기업의 내재가치를 기준으로 판단한다', '안전마진이 있을 때 사고, 가능하면 영원히 보유한다'],
    books: ['버크셔 해서웨이 주주 서한 (매년)', '『워런 버핏의 주주 서한』(로렌스 커닝햄 엮음)'],
    topics: ['가치투자', '경제적 해자', '안전마진', '장기보유'],
    traits: ['가치주', '우량 대형주'],
  },
  {
    key: 'graham',
    name: '벤저민 그레이엄',
    nameEn: 'Benjamin Graham',
    lived: '1894–1976',
    affiliation: '그레이엄-뉴먼, 컬럼비아 경영대학원',
    oneLine: '내재가치보다 충분히 싸게 사서 안전마진을 확보한다.',
    principles: ['주식은 기업의 일부 소유권이다', '시장(미스터 마켓)의 기분을 따르지 말고 이용한다', '내재가치 대비 큰 할인으로 사서 안전마진을 둔다', '투기와 투자를 구분하고 분산으로 위험을 줄인다'],
    books: ['『현명한 투자자』(The Intelligent Investor, 1949)', '『증권분석』(Security Analysis, 1934, 데이비드 도드 공저)'],
    topics: ['가치투자', '안전마진'],
    traits: ['가치주'],
  },
  {
    key: 'lynch',
    name: '피터 린치',
    nameEn: 'Peter Lynch',
    lived: '1944–',
    affiliation: '피델리티 마젤란 펀드 (1977–1990)',
    oneLine: '생활 속에서 아는 기업을 찾고, 성장에 비해 싼 주식을 산다.',
    principles: ['일상에서 먼저 알아본 기업을 깊이 조사한다', '기업을 저성장·대형우량·고성장·경기순환·회생·자산주로 나눠 다르게 대한다', '이익 성장률에 비해 주가가 싼지(PEG) 본다', '왜 샀는지 2분 안에 설명할 수 있어야 한다'],
    books: ['『전설로 떠나는 월가의 영웅』(One Up on Wall Street, 1989)', '『피터 린치의 이기는 투자』(Beating the Street, 1993)'],
    topics: ['성장투자'],
    traits: ['성장주', '중소형·신생'],
  },
  {
    key: 'munger',
    name: '찰리 멍거',
    nameEn: 'Charlie Munger',
    lived: '1924–2023',
    affiliation: '버크셔 해서웨이 부회장',
    oneLine: '여러 학문의 사고 모형으로 생각하고, 훌륭한 기업을 적정 가격에 산다.',
    principles: ['여러 분야의 핵심 개념을 엮은 사고 모형의 격자로 판단한다', '그저 그런 기업을 싸게 사기보다 훌륭한 기업을 적정 가격에 산다', '문제를 거꾸로 뒤집어 생각한다', '좋은 기회가 올 때까지 기다렸다가 크게 건다'],
    books: ['『가난한 찰리의 연감』(Poor Charlie\'s Almanack)'],
    topics: ['가치투자', '경제적 해자', '장기보유'],
    traits: ['가치주', '우량 대형주'],
  },
  {
    key: 'fisher',
    name: '필립 피셔',
    nameEn: 'Philip Fisher',
    lived: '1907–2004',
    affiliation: '피셔 앤드 컴퍼니',
    oneLine: '오랫동안 성장할 뛰어난 기업을 찾아 아주 오래 보유한다.',
    principles: ['매출이 수년간 크게 늘 제품·시장을 가진 기업을 찾는다', '고객·경쟁사·직원에게 묻는 사실 수집(scuttlebutt)으로 조사한다', '경영진의 역량과 정직성을 따진다(15가지 체크포인트)', '훌륭한 기업은 팔 이유가 거의 없다'],
    books: ['『위대한 기업에 투자하라』(Common Stocks and Uncommon Profits, 1958)'],
    topics: ['성장투자', '장기보유'],
    traits: ['성장주'],
  },
  {
    key: 'bogle',
    name: '존 보글',
    nameEn: 'John C. Bogle',
    lived: '1929–2019',
    affiliation: '뱅가드 창업자',
    oneLine: '시장 전체를 가장 낮은 비용으로 사서 오래 보유한다.',
    principles: ['대부분의 펀드는 비용을 빼면 시장을 이기지 못한다', '수수료와 세금 같은 비용이 장기 수익을 크게 깎는다', '시장 전체를 담은 저비용 인덱스펀드를 오래 보유한다', '시장 타이밍을 맞히려 하지 않는다'],
    books: ['『모든 주식을 소유하라』(The Little Book of Common Sense Investing, 2007)'],
    topics: ['지수투자', '장기보유'],
    traits: ['핵심'],
  },
  {
    key: 'dalio',
    name: '레이 달리오',
    nameEn: 'Ray Dalio',
    lived: '1949–',
    affiliation: '브리지워터 어소시에이츠',
    oneLine: '어떤 경제 국면에서도 버티도록 위험을 고르게 나눈다.',
    principles: ['성장과 물가가 예상보다 오르고 내리는 네 국면을 기준으로 생각한다', '서로 다른 국면에 강한 자산에 위험을 고르게 나눈다(올웨더)', '미래를 맞히기보다 어떤 미래에도 버티게 짠다', '원칙을 글로 적고 실수에서 배운다'],
    books: ['『원칙』(Principles, 2017)', '『변화하는 세계 질서』(2021)'],
    topics: ['자산배분', '리스크 관리'],
    traits: ['성장 상승', '성장 하락', '물가 상승', '물가 하락'],
  },
  {
    key: 'marks',
    name: '하워드 막스',
    nameEn: 'Howard Marks',
    lived: '1946–',
    affiliation: '오크트리 캐피털',
    oneLine: '시장 사이클과 리스크를 이해하고 남들과 다르게, 더 깊이 생각한다.',
    principles: ['남들과 같은 생각으로는 남보다 나은 결과를 얻지 못한다(2차적 사고)', '시장은 사이클을 그리며 극단으로 흔들린다', '좋은 투자는 좋은 자산을 사는 것이 아니라 좋은 가격에 사는 것이다', '수익보다 위험을 먼저 관리한다'],
    books: ['『투자에 대한 생각』(The Most Important Thing, 2011)', '『투자와 마켓 사이클의 법칙』(Mastering the Market Cycle, 2018)'],
    topics: ['리스크 관리', '역발상', '가치투자'],
    traits: [],
  },
  {
    key: 'templeton',
    name: '존 템플턴',
    nameEn: 'John Templeton',
    lived: '1912–2008',
    affiliation: '템플턴 그로스 펀드',
    oneLine: '비관이 극에 달했을 때 전 세계에서 싼 주식을 산다.',
    principles: ['강세장은 비관 속에 태어나 낙관 속에 끝난다', '모두가 팔 때 사고, 모두가 살 때 판다', '한 나라에 머물지 말고 전 세계에서 싼 것을 찾는다', '가격 대비 가치가 가장 큰 곳을 찾는다'],
    books: ['『존 템플턴의 가치투자 전략』(Investing the Templeton Way, 로렌 템플턴 외)'],
    topics: ['역발상', '가치투자'],
    traits: ['가치주', '신흥국'],
  },
  {
    key: 'kostolany',
    name: '앙드레 코스톨라니',
    nameEn: 'André Kostolany',
    lived: '1906–1999',
    affiliation: '유럽의 전설적 투자자',
    oneLine: '주가는 돈과 심리가 움직이니, 좋은 주식을 사서 오래 기다린다.',
    principles: ['주식시장은 돈(유동성)과 심리로 움직인다', '시장은 상승·과열·하락·침체를 도는 달걀 모양의 사이클을 그린다', '확신을 갖고 산 우량주는 오래 잊고 기다린다', '빚을 내서 투자하지 않는다'],
    books: ['『돈, 뜨겁게 사랑하고 차갑게 다루어라』'],
    topics: ['역발상', '장기보유'],
    traits: [],
  },
  {
    key: 'greenblatt',
    name: '조엘 그린블라트',
    nameEn: 'Joel Greenblatt',
    lived: '1957–',
    affiliation: '고담 캐피털',
    oneLine: '좋은 기업(높은 자본수익률)을 싼 가격(높은 이익수익률)에 기계적으로 산다.',
    principles: ['자본수익률이 높은 좋은 기업을 고른다', '이익수익률이 높은, 즉 싼 기업을 고른다', '두 순위를 합친 상위 종목을 규칙대로 사서 1년마다 바꾼다(마법공식)', '단기 성과가 나빠도 규칙을 지킨다'],
    books: ['『주식시장을 이기는 작은 책』(The Little Book That Beats the Market, 2005)'],
    topics: ['가치투자'],
    traits: ['가치주'],
  },
];

/** Starting body for a sage added from a preset. */
export function sageContent(s: SagePreset): unknown[] {
  return [quote(s.oneLine), h('핵심 원칙'), ...s.principles.map(li), h('대표 저서'), ...s.books.map(li), h('내 투자에 적용할 점'), p('')];
}

/** Starting body for a new book summary. */
export const BOOK_CONTENT: unknown[] = [
  quote('이 책을 한 줄로: '),
  h('핵심 아이디어'),
  li(''),
  h('인상 깊은 구절'),
  quote(''),
  h('내 투자에 적용할 점'),
  { type: 'checkListItem', props: { checked: false }, content: '' },
];

export const BOOK_STATUS_LABEL = { WANT: '읽을 책', READING: '읽는 중', DONE: '다 읽음' } as const;

/**
 * Asset traits ("자산 성질"): independent ways of classifying assets (a group,
 * e.g. 올웨더 경제 국면) and the classes within each (traits). This module
 * holds the built-in presets, the type-based suggestions, and the allocation
 * maths; it does not touch the database.
 */

export interface TraitDef {
  id: string;
  name: string;
  color: string;
  /** Wanted share of the group, 0..1 */
  targetWeight: number | null;
}

export interface AllocationItem {
  assetId: string;
  name: string;
  symbol?: string | null;
  /** KRW, positive */
  value: number;
}

export interface TraitSlice {
  key: string;
  label: string;
  color: string;
  value: number;
  share: number;
  target: number | null;
  /** target − share: positive means under target (room to buy) */
  gap: number | null;
  /** Left out of the shares (미지정 when the group measures only tagged assets) */
  excluded?: boolean;
  assets: { assetId: string; name: string; value: number }[];
}

export const UNASSIGNED = '__none__';
export const CASH_KEY = 'CASH_BAL';

/**
 * Value per trait. An asset tagged with several traits of the group counts
 * evenly in each; untagged assets go to "미지정". Portfolio cash counts as
 * `cash.traitId` (or 미지정 when none).
 */
export function traitAllocation(
  traits: TraitDef[],
  items: AllocationItem[],
  tagsOf: ReadonlyMap<string, readonly string[]>,
  cash?: { value: number; traitId: string | null },
  base: 'all' | 'tagged' = 'all',
): { slices: TraitSlice[]; total: number } {
  const known = new Set(traits.map((t) => t.id));
  const acc = new Map<string, { value: number; assets: Map<string, { assetId: string; name: string; value: number }> }>();
  const add = (key: string, assetId: string, name: string, v: number) => {
    const a = acc.get(key) ?? { value: 0, assets: new Map() };
    a.value += v;
    const cur = a.assets.get(assetId);
    if (cur) cur.value += v;
    else a.assets.set(assetId, { assetId, name, value: v });
    acc.set(key, a);
  };
  let total = 0;
  for (const it of items) {
    if (!(it.value > 0)) continue;
    total += it.value;
    const tags = [...new Set((tagsOf.get(it.assetId) ?? []).filter((t) => known.has(t)))];
    if (!tags.length) add(UNASSIGNED, it.assetId, it.name, it.value);
    else for (const t of tags) add(t, it.assetId, it.name, it.value / tags.length);
  }
  if (cash && cash.value > 0) {
    total += cash.value;
    add(cash.traitId && known.has(cash.traitId) ? cash.traitId : UNASSIGNED, CASH_KEY, '포트폴리오 현금', cash.value);
  }
  // "tagged": shares of what is tagged in this group, e.g. stock styles among stocks only
  if (base === 'tagged') total -= acc.get(UNASSIGNED)?.value ?? 0;
  const share = (v: number) => (total > 0 ? v / total : 0);
  const sortAssets = (m?: Map<string, { assetId: string; name: string; value: number }>) => [...(m?.values() ?? [])].sort((a, b) => b.value - a.value);
  const slices: TraitSlice[] = traits.map((t) => {
    const a = acc.get(t.id);
    const value = a?.value ?? 0;
    return { key: t.id, label: t.name, color: t.color, value, share: share(value), target: t.targetWeight, gap: t.targetWeight === null ? null : t.targetWeight - share(value), assets: sortAssets(a?.assets) };
  });
  const none = acc.get(UNASSIGNED);
  if (none) {
    const excluded = base === 'tagged';
    slices.push({ key: UNASSIGNED, label: '미지정', color: 'var(--series-other)', value: none.value, share: excluded ? 0 : share(none.value), target: null, gap: null, assets: sortAssets(none.assets), ...(excluded ? { excluded } : {}) });
  }
  return { slices, total };
}

/** Targets of a group add up to at most 100%. */
export function targetsValid(targets: (number | null)[]): boolean {
  const sum = targets.reduce<number>((a, b) => a + (b ?? 0), 0);
  return targets.every((t) => t === null || (t >= 0 && t <= 1)) && sum <= 1 + 1e-9;
}

// ── presets ─────────────────────────────────────────

export interface PresetTrait {
  name: string;
  color: string;
  description: string;
}

export interface Preset {
  key: string;
  name: string;
  description: string;
  traits: PresetTrait[];
  /** Trait name portfolio cash counts as */
  cashTrait?: string;
  /** Measure shares among tagged assets only (styles of stocks, not of the whole portfolio) */
  base?: 'all' | 'tagged';
  /** Optional example targets by trait name (shares, 0..1), with where they come from */
  example?: { label: string; targets: Record<string, number> };
}

export interface AssetLike {
  type: string;
  name: string;
  symbol: string | null;
  currency: string;
}

/**
 * Built-in groups. Sources: Bridgewater, "The All Weather Story" (2012) for the
 * four environments and which assets sit where; Morningstar Style Box and MSCI
 * value/growth and cyclical/defensive methodology for the equity styles; KRX
 * size indices for 대형/중형/소형.
 */
export const PRESETS: Preset[] = [
  {
    key: 'allWeather',
    name: '올웨더 경제 국면',
    description: '브리지워터 올웨더의 네 국면입니다. 시장 예상보다 성장·물가가 오르거나 내릴 때 어떤 자산이 유리한지로 나눕니다. 주식(성장 상승·물가 하락)처럼 두 국면에 걸친 자산은 반씩 셉니다. 원래 전략은 국면마다 위험을 25%씩 나누는 것이라 금액 비중과는 다릅니다.',
    traits: [
      { name: '성장 상승', color: '#1baf7a', description: '경기가 예상보다 좋을 때: 주식, 원자재, 회사채, 신흥국 채권' },
      { name: '성장 하락', color: '#2a78d6', description: '경기가 예상보다 나쁠 때: 국채, 물가연동채' },
      { name: '물가 상승', color: '#eb6834', description: '물가가 예상보다 오를 때: 물가연동채, 원자재, 금, 신흥국 채권' },
      { name: '물가 하락', color: '#7a5af8', description: '물가가 예상보다 내릴 때: 주식, 국채' },
    ],
  },
  {
    key: 'assetClass',
    name: '자산군',
    description: '가장 기본이 되는 분류입니다. 목표 비중을 정해 두면 리밸런싱할 때 무엇이 부족한지 바로 보입니다.',
    cashTrait: '현금성',
    traits: [
      { name: '주식', color: '#2a78d6', description: '개별 주식과 주식형 ETF·펀드' },
      { name: '채권', color: '#1baf7a', description: '국채·회사채·채권형 ETF' },
      { name: '금', color: '#eda100', description: '금 현물·금 ETF' },
      { name: '원자재', color: '#c2410c', description: '원유·농산물·원자재 ETF' },
      { name: '리츠·부동산', color: '#e87ba4', description: '리츠, 부동산' },
      { name: '암호화폐', color: '#7a5af8', description: '비트코인 등 가상자산' },
      { name: '현금성', color: '#aeb4be', description: '예금, MMF, 포트폴리오 현금' },
    ],
    example: { label: '올웨더 대중판 (토니 로빈스): 주식 30 · 채권 55 · 금 7.5 · 원자재 7.5', targets: { 주식: 0.3, 채권: 0.55, 금: 0.075, 원자재: 0.075 } },
  },
  {
    key: 'equityStyle',
    name: '주식 스타일',
    description: '모닝스타·MSCI 기준의 가치·성장 구분에 배당을 더했습니다. 주식마다 하나만 고르는 것을 권합니다. 비중은 이 분류를 지정한 종목끼리 나눠 셉니다.',
    base: 'tagged',
    traits: [
      { name: '성장주', color: '#eb6834', description: '이익·매출이 평균보다 빠르게 느는 주식 (예상 EPS 성장률, 매출 성장률)' },
      { name: '가치주', color: '#2a78d6', description: '이익·자산에 비해 싸게 거래되는 주식 (낮은 PER·PBR, 높은 배당수익률)' },
      { name: '혼합', color: '#aeb4be', description: '가치와 성장 어느 쪽도 뚜렷하지 않은 주식' },
      { name: '배당주', color: '#1baf7a', description: '배당수익률이 높고 꾸준히 배당하는 주식' },
    ],
  },
  {
    key: 'equitySize',
    name: '주식 체급',
    description: '회사 규모와 성숙도입니다. 한국거래소는 시가총액 1~100위를 대형주, 101~300위를 중형주로 봅니다. 비중은 이 분류를 지정한 종목끼리 나눠 셉니다.',
    base: 'tagged',
    traits: [
      { name: '우량 대형주', color: '#2a78d6', description: '시가총액 상위의 실적이 안정된 블루칩' },
      { name: '중형주', color: '#1baf7a', description: '대형주와 소형주 사이' },
      { name: '중소형·신생', color: '#eb6834', description: '규모가 작거나 아직 적자·상장 초기인 성장 기업' },
    ],
  },
  {
    key: 'cyclical',
    name: '경기 민감도',
    description: 'MSCI는 필수소비재·헬스케어·유틸리티(그리고 에너지)를 경기방어, 나머지 업종을 경기민감으로 나눕니다. 비중은 이 분류를 지정한 종목끼리 나눠 셉니다.',
    base: 'tagged',
    traits: [
      { name: '경기민감주', color: '#eb6834', description: 'IT·반도체, 금융, 산업재, 소재, 경기소비재 등' },
      { name: '경기방어주', color: '#1baf7a', description: '필수소비재, 헬스케어, 유틸리티 등' },
    ],
  },
  {
    key: 'region',
    name: '지역',
    description: '어느 나라 경제와 통화에 노출돼 있는지입니다. 국내 상장 해외 ETF는 투자하는 지역으로 고릅니다.',
    traits: [
      { name: '국내', color: '#2a78d6', description: '한국' },
      { name: '미국', color: '#eb6834', description: '미국' },
      { name: '기타 선진국', color: '#1baf7a', description: '유럽·일본 등' },
      { name: '신흥국', color: '#eda100', description: '중국·인도·베트남 등' },
    ],
  },
  {
    key: 'role',
    name: '운용 역할',
    description: '오래 들고 갈 핵심 자산과, 기회를 노리는 위성 자산을 나눕니다. 위성 비중에 한도를 두면 투기적인 종목이 커지는 것을 막을 수 있습니다.',
    traits: [
      { name: '핵심', color: '#2a78d6', description: '지수 ETF, 우량주 등 오래 들고 갈 자산' },
      { name: '위성', color: '#eb6834', description: '테마·개별 성장주·코인 등 기회를 노리는 자산' },
    ],
    example: { label: '핵심 80 · 위성 20', targets: { 핵심: 0.8, 위성: 0.2 } },
  },
];

// ── suggestions ─────────────────────────────────────

const has = (a: AssetLike, re: RegExp) => re.test(`${a.name} ${a.symbol ?? ''}`);
const BOND = /채권|국채|국고채|회사채|treasury|bond|\b(TLT|IEF|SHY|BND|AGG|EDV|ZROZ|VGLT|GOVT|LQD|HYG)\b/i;
const LINKER = /물가연동|TIPS|\b(SCHP|VTIP|STIP)\b/i;
const GOLD = /(^|[^가-힣])금(현물|선물)?($|[^가-힣])|골드|gold|\b(GLD|IAU|GLDM|SGOL)\b/i;
const COMMODITY = /원자재|원유|WTI|브렌트|농산물|commodit|\b(DBC|GSG|PDBC|USO|BCI)\b/i;
const REIT = /리츠|REIT|\b(VNQ|SCHH|XLRE)\b/i;
const EQUITY_TYPES = ['KR_STOCK', 'US_STOCK', 'FUND'];

type Kind = 'equity' | 'bond' | 'linker' | 'gold' | 'commodity' | 'reit' | 'crypto' | 'cash' | 'other';

/** What an asset mostly is, from its type, name and ticker. */
export function assetKind(a: AssetLike): Kind {
  if (a.type === 'CRYPTO') return 'crypto';
  if (a.type === 'CASH') return 'cash';
  if (a.type === 'LIABILITY') return 'other';
  if (has(a, LINKER)) return 'linker';
  if (a.type === 'BOND' || has(a, BOND)) return 'bond';
  if (has(a, GOLD)) return 'gold';
  if (has(a, COMMODITY)) return 'commodity';
  if (a.type === 'REAL_ESTATE' || has(a, REIT)) return 'reit';
  if (EQUITY_TYPES.includes(a.type)) return 'equity';
  return 'other';
}

const ALL_WEATHER: Record<Kind, string[]> = {
  equity: ['성장 상승', '물가 하락'],
  bond: ['성장 하락', '물가 하락'],
  linker: ['성장 하락', '물가 상승'],
  commodity: ['성장 상승', '물가 상승'],
  gold: ['물가 상승'],
  reit: ['성장 상승', '물가 상승'],
  crypto: [],
  cash: [],
  other: [],
};
const ASSET_CLASS: Record<Kind, string[]> = {
  equity: ['주식'],
  bond: ['채권'],
  linker: ['채권'],
  commodity: ['원자재'],
  gold: ['금'],
  reit: ['리츠·부동산'],
  crypto: ['암호화폐'],
  cash: ['현금성'],
  other: [],
};

function region(a: AssetLike): string[] {
  if (a.type === 'CRYPTO' || a.type === 'LIABILITY') return [];
  if (/신흥|이머징|중국|인도|베트남|\b(EEM|VWO|IEMG|FXI|INDA)\b/i.test(`${a.name} ${a.symbol ?? ''}`)) return ['신흥국'];
  if (/선진국|유럽|일본|\b(EFA|VEA|IEFA|EWJ|VGK)\b/i.test(`${a.name} ${a.symbol ?? ''}`)) return ['기타 선진국'];
  if (a.type === 'KR_STOCK' && /미국|S&P|나스닥|NASDAQ|다우|필라델피아/i.test(a.name)) return ['미국'];
  if (a.type === 'KR_STOCK') return ['국내'];
  if (a.type === 'US_STOCK') return ['미국'];
  return a.currency === 'KRW' ? ['국내'] : a.currency === 'USD' ? ['미국'] : [];
}

/**
 * Trait names a preset would give this asset, from its type, name and ticker.
 * Empty when the preset needs judgement the data cannot give (styles, size, role).
 */
export function suggestTraits(presetKey: string, a: AssetLike): string[] {
  const kind = assetKind(a);
  switch (presetKey) {
    case 'allWeather':
      return ALL_WEATHER[kind];
    case 'assetClass':
      return ASSET_CLASS[kind];
    case 'region':
      return region(a);
    default:
      return [];
  }
}

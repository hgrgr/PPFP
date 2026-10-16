/**
 * Regenerates the screenshots in docs/images for docs/user-guide.md.
 *
 *   npm run build && npm run docs:screenshots
 *
 * 1. Recreates a throwaway database next to DATABASE_URL (same server, name + "_docs").
 * 2. Seeds the fictional demo account (seed-demo.ts) against fake broker servers.
 * 3. Starts the built app on DOCS_PORT (default 3100) with the fakes preloaded.
 * 4. Drives headless Chrome over the DevTools protocol, marks numbered callouts
 *    and saves each shot as WebP. Then stops everything and drops the database.
 *
 * Real accounts, keys and the main database are never touched. Set CHROME_PATH
 * if Chrome is not in the default location, DOCS_PORT to move the demo server,
 * or DOCS_ONLY=market,login to retake only some shots.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'docs/images');
const PORT = Number(process.env.DOCS_PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;
const ONLY = process.env.DOCS_ONLY?.split(',').filter(Boolean);
/** Chromium that `npx playwright install chromium` puts in ~/.cache (Linux arm64 has no Google Chrome) */
function playwrightChromium(): string[] {
  const root = path.join(process.env.HOME ?? '', '.cache/ms-playwright');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse().map((d) => path.join(root, d, 'chrome-linux/chrome'));
}
const CHROME =
  process.env.CHROME_PATH ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', ...playwrightChromium()].find((p) => existsSync(p));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- shots
/** An element on the page: CSS selector, optionally narrowed by its own text, then widened to an ancestor. */
interface Find {
  sel?: string;
  text?: string;
  closest?: string;
  nth?: number;
  within?: Find;
}
/**
 * click, set a form value, pause, or wait until a page expression is true;
 * `press` is a real mouse click at the element's centre (it places the caret in an editor),
 * `type` types text with real key input, `key` presses Enter or End.
 */
type Step = { click: Find } | { set: Find; value: string } | { wait: number } | { until: string; timeout?: number } | { press: Find } | { type: string } | { key: 'Enter' | 'End' };
interface Shot {
  file: string;
  path: (ids: Ids) => string;
  /** Leave out the session cookie (login page) */
  anonymous?: boolean;
  width?: number;
  height?: number;
  scale?: number;
  dark?: boolean;
  mobile?: boolean;
  wait?: number;
  steps?: Step[];
  /** Numbered callouts, 1-based in order */
  marks?: Find[];
  /** Elements to crop to (their union, padded). Omit for the first screen. */
  clip?: Find[];
  pad?: number;
  /** Keep the floating memo and AI buttons (hidden elsewhere so they do not cover content) */
  fabs?: boolean;
}
interface Ids {
  root: string;
  us: string;
  home: string;
  /** A split strategy portfolio that shares holdings with the others */
  growth: string;
  /** A strategy that takes whole accounts */
  accountStrategy: string;
  apartment: string;
  house: string;
  aapl: string;
  nvdaJournal: string;
  /** The demo 가상 포트폴리오 with positions */
  virtual: string;
  aaplJournal: string;
  template: string;
  allWeather: string;
  assetClass: string;
  equityStyle: string;
  samsung: string;
  buffett: string;
  book: string;
  /** A finished AI advisor conversation, prepared through the demo server before capturing */
  aiChat: string;
  /** A research conversation that used a skill */
  aiSkillChat: string;
  /** Today's morning briefing conversation */
  aiBriefing: string;
}

const card = (heading: string, sel = 'h2'): Find => ({ sel, text: heading, closest: '.card' });

/** The 실적·공시 분석가 set to the Buffett guideline and the Buffett sage from the demo 투자 노트 */
const EARNINGS_LENS: Step[] = [
  { click: { sel: 'button', text: '워런 버핏', within: { sel: '.earnings-lens' } } },
  {
    until:
      "(() => { const s = document.querySelector('select[aria-label=\"투자 거장 관점\"]'); const o = [...s.options].find((x) => x.text.startsWith('워런 버핏')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()",
  },
  { wait: 300 },
];

const SHOTS: Shot[] = [
  { file: 'login', path: () => '/login', anonymous: true, width: 1100, height: 760, scale: 2, clip: [{ sel: '.auth .card' }], pad: 28 },
  {
    file: 'dashboard',
    path: () => '/dashboard',
    wait: 2200,
    marks: [
      { sel: 'span', text: '보기 범위', closest: 'label' },
      { sel: 'button', text: '금액 가리기' },
      { sel: '[aria-label="기간 선택"]' },
      { sel: 'section[aria-label="요약"]' },
      card('평가액 추이'),
      card('자산 배분'),
    ],
  },
  { file: 'dashboard-tables', path: (ids) => `/dashboard?p=${ids.root}`, wait: 2200, width: 1680, clip: [{ sel: 'h2', text: '비중 변화', closest: 'section' }, { sel: 'h2', text: '보유 종목', closest: 'section' }] },
  { file: 'dashboard-dark', path: () => '/dashboard', wait: 2200, dark: true },
  {
    file: 'analysis',
    path: () => '/analysis',
    width: 1440,
    // Tall from the start: headless Chrome leaves charts that start below the first screen empty
    height: 14000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('.indicator')].some((c) => c.textContent.includes('불러오는 중'))", timeout: 90_000 }, { wait: 1500 }],
    clip: [{ sel: '.page-head' }, { sel: '#ind-us-10y-fisher' }],
    marks: [{ sel: '[aria-label="기간"]' }, { sel: 'select', closest: 'label' }, { sel: 'summary', text: '지표 고르기' }, { sel: '.ind-toc-groups' }, { sel: '.ind-jump' }, { sel: '.indicator .ind-latest' }, { sel: '[aria-label="선 켜고 끄기"]' }],
  },
  {
    file: 'analysis-realestate',
    path: () => '/analysis',
    width: 1440,
    height: 14000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('.indicator')].some((c) => c.textContent.includes('불러오는 중'))", timeout: 90_000 }, { wait: 1500 }],
    clip: [{ sel: 'h2', text: '부동산', closest: 'section' }],
  },
  {
    file: 'analysis-cycle',
    path: () => '/analysis',
    width: 1440,
    height: 14000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('.indicator')].some((c) => c.textContent.includes('불러오는 중'))", timeout: 90_000 }, { wait: 1500 }],
    clip: [{ sel: 'h2', text: '경기 사이클', closest: 'section' }],
  },
  {
    file: 'analysis-liquidity',
    path: () => '/analysis',
    width: 1440,
    height: 14000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('.indicator')].some((c) => c.textContent.includes('불러오는 중'))", timeout: 90_000 }, { wait: 1500 }],
    clip: [{ sel: 'h2', text: '유동성 · 수급', closest: 'section' }],
  },
  {
    file: 'analysis-stocks',
    path: () => '/analysis',
    width: 1440,
    height: 14000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('.indicator')].some((c) => c.textContent.includes('불러오는 중'))", timeout: 90_000 }, { wait: 1500 }],
    clip: [{ sel: 'h2', text: '주식 · 위험', closest: 'section' }],
  },
  {
    file: 'regions',
    path: () => `/regions?r=${encodeURIComponent('경기>성남시>분당구')}`,
    width: 1440,
    height: 9000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 90_000 }, { wait: 1500 }],
    clip: [{ sel: '.page-head' }, { sel: 'section[aria-label="지역 분석 설정"]' }, { sel: 'section[aria-label="요약"]' }, { sel: 'section[aria-label="매매 · 전세 4분면"]' }],
    marks: [{ sel: '[aria-label="화면"]' }, { sel: '[aria-label="기간"]' }, { sel: 'input[list]', closest: 'label' }, { sel: 'section[aria-label="요약"] .ind-latest' }, { sel: 'section[aria-label="요약"] .badge' }],
  },
  {
    file: 'regions-charts',
    path: () => `/regions?r=${encodeURIComponent('경기>성남시>분당구')}`,
    width: 1440,
    height: 9000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 90_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="벌집순환모형"]' }, { sel: 'section[aria-label="기술적 분석: 보조지표"]' }, { sel: 'section[aria-label="거래 성수기"]' }],
  },
  {
    file: 'regions-compare',
    path: () => `/regions?tab=compare&c=${encodeURIComponent('서울>강남구')}&c=${encodeURIComponent('경기>성남시>분당구')}&c=${encodeURIComponent('대구>수성구')}&c=${encodeURIComponent('전국')}`,
    width: 1440,
    height: 6000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 90_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="지역 분석 설정"]' }, { sel: 'section[aria-label="지역 비교표"]' }, { sel: 'section[aria-label="상관계수 (월간 매매 변동률)"]' }],
  },
  {
    file: 'regions-cycle',
    path: () => '/regions?tab=cycle',
    width: 1440,
    height: 6000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 90_000 }, { wait: 1000 }, { click: { sel: 'th[scope="row"]', text: '서울', closest: 'tr' } }, { wait: 800 }],
    clip: [{ sel: 'section[aria-label="지역 분석 설정"]' }, { sel: 'section[aria-label="지역별 국면"]' }, { sel: 'section[aria-label="국면별 지역"]' }],
  },
  {
    file: 'regions-corr',
    path: () => `/regions?tab=corr&r=${encodeURIComponent('서울')}&m=mortgage&years=0`,
    width: 1440,
    height: 6000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 90_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="지역 분석 설정"]' }, { sel: 'section[aria-label="시차별 상관계수"]' }, { sel: 'section[aria-label="두 변화 겹쳐 보기"]' }],
  },
  {
    file: 'regions-buyers',
    path: () => `/regions?tab=buyers&r=${encodeURIComponent('경기>성남시>분당구')}`,
    width: 1440,
    height: 6000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="지역 분석 설정"]' }, { sel: 'section[aria-label="매수자 거주지 · 외지인 비율"]' }, { sel: 'section[aria-label="면적대별 매매거래"]' }, { sel: 'section[aria-label="토지거래허가 처리"]' }, { sel: 'section[aria-label="법인 매수 · 매도"]' }, { sel: 'section[aria-label="이웃 지역 외지인 매수"]' }],
  },
  {
    file: 'regions-map',
    path: () => '/regions?tab=map',
    width: 1440,
    height: 4000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))" + " && !!document.querySelector('svg[aria-label$=\"지도\"] path')", timeout: 120_000 }, { wait: 1000 }],
    clip: [{ sel: 'section[aria-label="지역 분석 설정"]' }, { sel: 'section[aria-label="지역 지도"]' }, { sel: 'section[aria-label="지도 순위"]' }],
    marks: [{ sel: '[aria-label="지도 지표"]' }, { sel: 'select[aria-label="시도"]', closest: 'label' }],
  },
  {
    file: 'regions-apply',
    path: () => `/regions?tab=apply&r=${encodeURIComponent('서울>강남구')}&ay=3`,
    width: 1440,
    height: 5000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { click: { sel: 'th[scope="row"]', text: '개포 새솔마을', closest: 'tr' } }, { wait: 1200 }],
    clip: [{ sel: 'section[aria-label="지역 분석 설정"]' }, { sel: 'section[aria-label="규제지역"]' }, { sel: 'section[aria-label="입주 예정"]' }, { sel: 'section[aria-label="분양가 흐름"]' }, { sel: 'section[aria-label="분양 공고"]' }],
    marks: [{ sel: '[aria-label="공고 기간"]' }],
  },
  {
    file: 'regions-location',
    path: () => `/regions?tab=location&r=${encodeURIComponent('경기>성남시>분당구')}`,
    width: 1440,
    height: 9000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 800 }],
    clip: [{ sel: 'section[aria-label="지역 분석 설정"]' }, { sel: 'section[aria-label="입지 요약"]' }, { sel: 'section[aria-label="입지 순위"]' }],
    marks: [{ sel: 'select[aria-label="입지 시도"]', closest: 'label' }, { sel: 'button', text: '종합' }],
  },
  {
    file: 'regions-rtpi',
    path: () => `/regions?r=${encodeURIComponent('서울')}`,
    width: 1440,
    height: 9000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1200 }],
    clip: [{ sel: 'section[aria-label="실거래가격지수 vs 매매가격지수"]' }],
  },
  {
    file: 'markets-sectors',
    path: () => '/markets?tab=sectors&p=3M',
    width: 1440,
    height: 2600,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1200 }],
    clip: [{ sel: 'section[aria-label="시장 개요 설정"]' }, { sel: 'section[aria-label="시점 재생"]' }, { sel: 'section[aria-label="섹터 히트맵"]' }, { sel: 'section[aria-label="섹터 순위"]' }, { sel: 'section[aria-label="스타일 박스"]' }],
    marks: [{ sel: '[aria-label="기간"]' }, { sel: '.timeline-play' }, { sel: 'section[aria-label="스타일 박스"] .mo-style' }],
  },
  {
    file: 'markets-map',
    path: () => '/markets?tab=map&p=1M',
    width: 1440,
    height: 2600,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중')) && !!document.querySelector('.mo-map rect')", timeout: 120_000 }, { wait: 1200 }],
    clip: [{ sel: 'section[aria-label="S&P 500 지도"]' }, { sel: 'section[aria-label="섹터별 수익률"]' }],
    marks: [{ sel: '[aria-label="색 범례"]' }],
  },
  {
    file: 'markets-yields',
    path: () => '/markets?tab=yields',
    width: 1440,
    height: 3000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중')) && !!document.querySelector('.timeline input[type=range]')", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="국채 금리 표"]' }, { sel: 'section[aria-label="금리 곡선"]' }, { sel: 'section[aria-label="10년물 추이"]' }, { sel: 'section[aria-label="장단기 금리차"]' }],
    marks: [{ sel: 'section[aria-label="국채 금리 표"] [aria-label="보기"]' }, { sel: '.timeline-play' }],
  },
  {
    file: 'markets-watch',
    path: () => '/markets?tab=watch',
    width: 1440,
    height: 3000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 800 }],
    clip: [{ sel: 'section[aria-label="기간 수익률"]' }],
    marks: [],
  },
  {
    file: 'gurus',
    path: () => '/gurus?tab=list',
    width: 1440,
    height: 3600,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중')) && !document.body.textContent.includes('SEC에서 13F 보고서를 받는 중') && !document.body.textContent.includes('티커로 바꾸는 중') && !document.body.textContent.includes('샤프·소르티노 등을 계산하는 중')", timeout: 400_000 }, { wait: 800 }],
    clip: [{ sel: 'section[aria-label="거장 포트폴리오 설정"]' }, { sel: 'section[aria-label="거장 목록"]' }],
    marks: [{ sel: '[aria-label="화면"]' }, { sel: '[aria-label="정렬"]' }],
  },
  {
    file: 'gurus-trades',
    path: () => '/gurus?tab=trades',
    width: 1440,
    height: 3000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중')) && !document.body.textContent.includes('SEC에서 13F 보고서를 받는 중') && !document.body.textContent.includes('티커로 바꾸는 중')", timeout: 240_000 }, { wait: 800 }],
    clip: [{ sel: 'section[aria-label="많이 산 종목"]' }, { sel: 'section[aria-label="많이 판 종목"]' }],
    marks: [],
  },
  {
    file: 'gurus-similar',
    path: () => '/gurus?tab=similar',
    width: 1440,
    height: 1600,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중')) && !document.body.textContent.includes('SEC에서 13F 보고서를 받는 중') && !document.body.textContent.includes('티커로 바꾸는 중')", timeout: 240_000 }, { wait: 800 }],
    clip: [{ sel: 'section[aria-label="나와 비슷한 거장"]' }],
    marks: [],
  },
  {
    file: 'gurus-detail',
    path: () => '/gurus?g=buffett',
    width: 1440,
    height: 3600,
    steps: [{ until: "!!document.querySelector('section[aria-label=\"거장 요약\"]') && !!document.querySelector('.race-row')", timeout: 240_000 }, { set: { sel: '.timeline input[type=range]' }, value: '5' }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="거장 요약"]' }, { sel: 'section[aria-label="분기별 보유 변화"]' }, { sel: 'section[aria-label="따라 산 수익률"]' }, { sel: 'section[aria-label="섹터 비중"]' }, { sel: 'section[aria-label="보유 종목"]' }],
    marks: [{ sel: '.timeline-play' }, { sel: 'section[aria-label="거장 요약"] .gu-kpis' }],
  },
  {
    file: 'macro',
    path: () => '/macro?tab=countries',
    width: 1440,
    height: 3000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="글로벌 매크로 설정"]' }, { sel: 'section[aria-label="국가 비교 표"]' }, { sel: 'section[aria-label="경기 시계"]' }],
    marks: [{ sel: '[aria-label="화면"]' }, { sel: '.timeline-play' }],
  },
  {
    file: 'macro-cycle',
    path: () => '/macro?tab=cycle',
    width: 1440,
    height: 3000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="경기 국면 히트맵"]' }, { sel: 'section[aria-label="좋아지는 지표 비율"]' }],
    marks: [{ sel: '.timeline-play' }],
  },
  {
    file: 'macro-rotation',
    path: () => '/macro?tab=rotation',
    width: 1440,
    height: 2600,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="섹터 순환 그래프"]' }, { sel: 'section[aria-label="섹터 순환 표"]' }],
    marks: [{ sel: '[aria-label="꼬리 길이"]' }],
  },
  {
    file: 'macro-cot',
    path: () => '/macro?tab=cot',
    width: 1440,
    height: 2400,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="선물 포지션 표"]' }, { sel: 'section[aria-label="순포지션 추이"]' }],
    marks: [],
  },
  {
    file: 'macro-gdp',
    path: () => '/macro?tab=gdp',
    width: 1440,
    height: 1600,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="미국 GDP 성장 기여도"]' }, { sel: 'section[aria-label="한국 GDP 성장 기여도"]' }],
    marks: [],
  },
  {
    file: 'stocks',
    path: () => '/stocks?t=NVDA&tab=fin',
    width: 1440,
    height: 3200,
    steps: [{ until: "!!document.querySelector('section[aria-label=\"종목 요약\"]') && document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="종목 고르기"]' }, { sel: 'section[aria-label="종목 요약"]' }, { sel: 'section[aria-label="실적 추이"]' }, { sel: 'section[aria-label="재무제표"]' }],
    marks: [{ sel: '[aria-label="티커"]' }, { sel: '[aria-label="기간 단위"]' }],
  },
  {
    file: 'stocks-peers',
    path: () => '/stocks?t=NVDA&tab=peers',
    width: 1440,
    height: 2600,
    steps: [{ until: "!!document.querySelector('section[aria-label=\"종목 요약\"]') && document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="동종 비교 표"]' }, { sel: 'section[aria-label="동종 비교 그래프"]' }],
    marks: [],
  },
  {
    file: 'stocks-insider',
    path: () => '/stocks?t=NVDA&tab=insider',
    width: 1440,
    height: 2600,
    steps: [{ until: "!!document.querySelector('section[aria-label=\"종목 요약\"]') && document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="내부자 순매수"]' }, { sel: 'section[aria-label="내부자 거래"]' }],
    marks: [{ sel: '[aria-label="거래 종류"]' }],
  },
  {
    file: 'stocks-value',
    path: () => '/stocks?t=NVDA&tab=value',
    width: 1440,
    height: 2800,
    steps: [{ until: "!!document.querySelector('section[aria-label=\"종목 요약\"]') && document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="평가 입력"]' }, { sel: 'section[aria-label="평가 결과"]' }, { sel: 'section[aria-label="저장한 평가"]' }],
    marks: [{ sel: '[aria-label="평가 방법"]' }],
  },
  {
    file: 'markets-rank',
    path: () => '/markets?tab=rank',
    width: 1440,
    height: 3000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { click: { sel: 'button', text: '200일선 위' } }, { wait: 800 }],
    clip: [{ sel: 'section[aria-label="기술적 순위"]' }],
    marks: [{ sel: '[aria-label="조건"]' }, { sel: 'select[aria-label="섹터"]', closest: 'label' }],
  },
  {
    file: 'risk',
    path: () => '/risk?y=3',
    width: 1440,
    height: 3600,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 2000 }],
    clip: [{ sel: 'section[aria-label="리스크 분석 설정"]' }, { sel: 'section[aria-label="리스크 요약"]' }, { sel: 'section[aria-label="가치 변화"]' }, { sel: 'section[aria-label="낙폭"]' }, { sel: 'section[aria-label="위험 기여"]' }, { sel: 'section[aria-label="요인 노출"]' }, { sel: 'section[aria-label="베타 변화"]' }, { sel: 'section[aria-label="상관관계"]' }],
    marks: [{ sel: '[aria-label="기간"]' }],
  },
  {
    file: 'stocks-kr',
    path: () => '/stocks?t=999990&tab=fin',
    width: 1440,
    height: 3000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중')) && !!document.querySelector('section[aria-label=\"종목 요약\"]')", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="종목 고르기"]' }, { sel: 'section[aria-label="종목 요약"]' }, { sel: 'section[aria-label="실적 추이"]' }],
    marks: [{ sel: '[aria-label="티커"]' }],
  },
  {
    file: 'stocks-kr-filings',
    path: () => '/stocks?t=999990&tab=insider',
    width: 1440,
    height: 2400,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중')) && !!document.querySelector('section[aria-label=\"공시 목록\"]')", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="임원·주요주주 소유"]' }, { sel: 'section[aria-label="공시 목록"]' }],
    marks: [{ sel: '[aria-label="공시 종류"]' }],
  },
  {
    file: 'macro-calendar',
    path: () => '/macro?tab=calendar',
    width: 1440,
    height: 2600,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="경제 지표 일정"]' }],
    marks: [],
  },
  {
    file: 'macro-sheet',
    path: () => '/macro?tab=sheet',
    width: 1440,
    height: 2400,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="지표 추가"]' }, { sel: 'section[aria-label="Consumer Price Index for All Urban Consumers"]' }, { sel: 'section[aria-label="Unemployment Rate"]' }, { sel: 'section[aria-label="10-Year Treasury Minus 2-Year Treasury"]' }, { sel: 'section[aria-label="M2"]' }],
    marks: [{ sel: 'input[aria-label="FRED 검색어"]' }],
  },
  {
    file: 'virtual',
    path: () => '/portfolios/virtual',
    width: 1440,
    height: 1400,
    steps: [{ until: "document.querySelectorAll('section').length > 1 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중')) && !!document.querySelector('section[aria-label=\"가상 포트폴리오 목록\"]')", timeout: 120_000 }, { wait: 800 }],
    clip: [{ sel: 'section[aria-label="가상 포트폴리오 만들기"]' }, { sel: 'section[aria-label="가상 포트폴리오 목록"]' }],
    marks: [{ sel: 'input[aria-label="가상 포트폴리오 이름"]' }],
  },
  {
    file: 'virtual-detail',
    path: () => '/portfolios/virtual',
    width: 1440,
    height: 3200,
    steps: [{ until: "!!document.querySelector('section[aria-label=\"가상 포트폴리오 목록\"] a')", timeout: 120_000 }, { click: { sel: 'section[aria-label="가상 포트폴리오 목록"] a', text: '코로나 저점에 샀다면' } }, { until: "!!document.querySelector('section[aria-label=\"가치 변화\"] .recharts-line')", timeout: 120_000 }, { wait: 1800 }],
    clip: [{ sel: 'section[aria-label="가상 포트폴리오 요약"]' }, { sel: 'section[aria-label="가치 변화"]' }, { sel: 'section[aria-label="종목 담기"]' }, { sel: 'section[aria-label="담은 종목"]' }],
    marks: [{ sel: '[aria-label="자산 종류"]' }, { sel: 'select[aria-label="비교 지수"]', closest: 'label' }],
  },
  {
    file: 'portfolios-virtual',
    path: () => '/portfolios',
    width: 1440,
    height: 2400,
    steps: [{ until: "!!document.querySelector('section[aria-label=\"가상 포트폴리오\"] table')", timeout: 120_000 }, { wait: 800 }],
    clip: [{ sel: 'section[aria-label="가상 포트폴리오"]' }],
    marks: [{ sel: 'section[aria-label="가상 포트폴리오"] a.btn', text: '분석' }],
  },
  {
    file: 'dashboard-virtual',
    path: (ids) => `/dashboard?p=v:${ids.virtual}&period=ALL`,
    width: 1440,
    height: 2600,
    steps: [{ until: "!!document.querySelector('.recharts-line, .recharts-area')", timeout: 120_000 }, { wait: 1800 }],
    marks: [{ sel: 'select', closest: 'label' }],
  },
  {
    file: 'compare',
    path: () => '/performance/compare?period=3Y',
    width: 1440,
    height: 3000,
    steps: [{ until: "!!document.querySelector('section[aria-label=\"누적 수익률\"] .recharts-line')", timeout: 180_000 }, { wait: 1800 }],
    clip: [{ sel: 'section[aria-label="비교할 포트폴리오"]' }, { sel: 'section[aria-label="누적 수익률"]' }, { sel: 'section[aria-label="성과 지표"]' }, { sel: 'section[aria-label="연도별 수익률"]' }, { sel: 'section[aria-label="상관관계"]' }],
    marks: [{ sel: 'section[aria-label="비교할 포트폴리오"]' }],
  },
  {
    file: 'basket',
    path: () => '/portfolios/basket',
    width: 1440,
    height: 1800,
    steps: [
      { until: "(localStorage.setItem('ppfp:fun','1'), window.dispatchEvent(new CustomEvent('ppfp:fun', { detail: true })), true)", timeout: 20_000 },
      { until: "!!document.querySelector('.basket .thing')", timeout: 60_000 },
      { wait: 600 },
      { until: "(() => { const t = document.querySelector('.basket:not(.virtual) .thing'); const b = document.querySelector('.basket.virtual'); if (!t || !b) return false; b.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(), q = b.getBoundingClientRect(); const o = { bubbles: true, pointerId: 7, pointerType: 'mouse', isPrimary: true }; t.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); t.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: q.left + q.width / 2, clientY: q.top + q.height / 2 })); return true; })()", timeout: 20_000 },
      { until: "!!document.querySelector('.thing-ghost') && !!document.querySelector('.basket.virtual.over')", timeout: 20_000 },
      { wait: 500 },
    ],
    marks: [{ sel: '.thing-ghost' }, { sel: '.basket.virtual.over' }],
  },
  {
    file: 'basket-drop',
    path: () => '/portfolios/basket',
    width: 1440,
    height: 1800,
    steps: [
      { until: "(localStorage.setItem('ppfp:fun','1'), window.dispatchEvent(new CustomEvent('ppfp:fun', { detail: true })), true)", timeout: 20_000 },
      { until: "!!document.querySelector('.basket .thing')", timeout: 60_000 },
      { wait: 600 },
      { until: "(() => { const t = document.querySelector('.basket:not(.virtual) .thing'); const b = document.querySelector('.basket.virtual'); if (!t || !b) return false; b.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(), q = b.getBoundingClientRect(); const o = { bubbles: true, pointerId: 7, pointerType: 'mouse', isPrimary: true }; t.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); t.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: q.left + q.width / 2, clientY: q.top + q.height / 2 })); return true; })()", timeout: 20_000 },
      { wait: 300 },
      { until: "(() => { const b = document.querySelector('.basket.virtual'); const t = document.querySelector('.thing.lifted'); if (!b || !t) return false; window.confirm = () => true; const q = b.getBoundingClientRect(); t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, clientX: q.left + q.width / 2, clientY: q.top + q.height / 2 })); return true; })()", timeout: 20_000 },
      { until: "!!document.querySelector('.fun-toast') && /꿈 바구니|담았/.test(document.querySelector('.fun-toast').textContent)", timeout: 60_000 },
      { wait: 400 },
    ],
    marks: [{ sel: '.fun-toast' }],
  },
  {
    file: 'fun-dashboard',
    path: () => '/dashboard',
    width: 1440,
    height: 900,
    steps: [{ until: "(localStorage.setItem('ppfp:fun','1'), window.dispatchEvent(new CustomEvent('ppfp:fun', { detail: true })), true)", timeout: 20_000 }, { until: "!!document.querySelector('.fun-weather')", timeout: 30_000 }, { wait: 800 }],
    clip: [{ sel: 'header.page-head' }],
    marks: [{ sel: '.fun-weather' }],
  },
  {
    file: 'regions-map-time',
    path: () => '/regions?tab=map',
    width: 1440,
    height: 4000,
    steps: [
      { until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))" + " && !!document.querySelector('svg[aria-label$=\"지도\"] path')", timeout: 120_000 },
      { click: { sel: 'button', text: '시간 흐름' } },
      { until: "!!document.querySelector('.timeline input[type=range]') && !!document.querySelector('.race-row')", timeout: 120_000 },
      { set: { sel: '.timeline input[type=range]' }, value: '30' },
      { wait: 1500 },
    ],
    clip: [{ sel: 'section[aria-label="지역 지도"]' }, { sel: 'section[aria-label="지도 순위"]' }, { sel: 'section[aria-label="증감 히트맵"]' }],
    marks: [{ sel: '[aria-label="지도 시점"]' }, { sel: '.timeline-play' }, { sel: '.timeline input[type=range]' }, { sel: '[aria-label="재생 속도"]' }, { sel: '.race' }],
  },
  {
    file: 'regions-supply',
    path: () => `/regions?r=${encodeURIComponent('경기>성남시>분당구')}`,
    width: 1440,
    height: 9000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1500 }],
    clip: [{ sel: 'section[aria-label="인구 · 연령대 · 세대수"]' }, { sel: 'section[aria-label="공급: 인허가 · 미분양"]' }, { sel: 'section[aria-label="주택구입부담"]' }],
  },
  {
    file: 'regions-complex',
    path: () => `/regions?tab=complex&r=${encodeURIComponent('서울>강남구')}&cy=10`,
    width: 1440,
    height: 7000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1200 }],
    clip: [{ sel: 'section[aria-label="지역 분석 설정"]' }, { sel: 'section[aria-label="단지 · 평형별 시세"]' }],
    marks: [{ sel: '[aria-label="거래 기간"]' }, { sel: '[aria-label="면적"]' }, { sel: 'span', text: '준공', closest: 'label' }, { sel: 'button[aria-pressed]', text: '★' }, { sel: 'button', text: '최고가 대비' }],
  },
  {
    file: 'regions-complex-cards',
    path: () => `/regions?tab=complex&r=${encodeURIComponent('서울>강남구')}&cy=10`,
    width: 1440,
    height: 7000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 1200 }],
    clip: [{ sel: 'section[aria-label="최고가 대비 분포"]' }, { sel: 'section[aria-label="이달 거래량 예측"]' }, { sel: 'section[aria-label="급지: 동별 평당가"]' }, { sel: 'section[aria-label="급지: 단지 평당가 순위"]' }],
  },
  {
    file: 'regions-complex-detail',
    path: () => `/regions?tab=complex&r=${encodeURIComponent('서울>강남구')}&cy=10`,
    width: 1440,
    height: 7000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { click: { sel: 'th[scope="row"]', text: '개포숲마을' } }, { until: "!!document.querySelector('#complex-detail')", timeout: 60_000 }, { wait: 1200 }],
    clip: [{ sel: '#complex-detail' }],
  },
  {
    file: 'regions-fav',
    path: () => '/regions?tab=fav',
    width: 1440,
    height: 4000,
    steps: [{ until: "document.querySelectorAll('.indicator').length > 0 && ![...document.querySelectorAll('p.empty')].some((p) => p.textContent.includes('불러오는 중'))", timeout: 120_000 }, { wait: 800 }],
    clip: [{ sel: 'section[aria-label="지역 분석 설정"]' }, { sel: 'section[aria-label="한빛마을래미안"]' }, { sel: 'section[aria-label="개포숲마을"]' }],
  },
  {
    file: 'portfolios',
    path: () => '/portfolios',
    wait: 1200,
    clip: [{ sel: '.page-head' }, card('구조'), card('새 포트폴리오')],
    marks: [{ sel: '.badge', text: '포함' }, { sel: 'a', text: '분석' }, { sel: 'button', text: '분리' }, card('새 포트폴리오'), card('기존 포트폴리오 연결')],
  },
  {
    file: 'portfolio-detail',
    path: (ids) => `/portfolios/${ids.us}`,
    wait: 1500,
    clip: [{ sel: '.page-head' }, { sel: '.card.kpi', closest: 'section' }, card('직접 보유 종목')],
    marks: [{ sel: 'a', text: '보유종목 가져오기', within: { sel: '.page-head' } }, { sel: 'a', text: '+ 거래 추가' }, { sel: '.card.kpi', closest: 'section' }, card('직접 보유 종목'), { sel: 'button', text: '제거', within: card('직접 보유 종목') }],
  },
  {
    file: 'portfolio-strategies',
    path: () => '/portfolios',
    wait: 1200,
    width: 1280,
    clip: [{ sel: '#strategies' }],
    marks: [{ sel: 'td', text: '겹쳐 담기 허용' }, { sel: '#strategies .badge', text: '중복' }, { sel: 'a', text: '분석', within: { sel: '#strategies' } }],
  },
  {
    file: 'strategy-detail',
    path: (ids) => `/portfolios/${ids.growth}`,
    wait: 1500,
    width: 1280,
    clip: [{ sel: '.page-head' }, { sel: '.card.kpi', closest: 'section' }, card('담은 종목'), card('계좌의 종목 하나씩 담기')],
    marks: [
      { sel: '.card.kpi', closest: 'section' },
      { sel: '.share-form', within: card('담은 종목') },
      { sel: '.strategy-tag', within: card('담은 종목') },
      { sel: 'button', text: '빼기', within: card('담은 종목') },
      { sel: 'button', text: '담기', within: card('계좌의 종목 하나씩 담기') },
    ],
  },
  {
    file: 'strategy-accounts',
    path: (ids) => `/portfolios/${ids.accountStrategy}`,
    wait: 1500,
    width: 1280,
    clip: [{ sel: '.page-head' }, { sel: '.card.kpi', closest: 'section' }, card('담은 종목'), { sel: '#accounts' }],
    marks: [
      { sel: '.card.kpi .note' },
      { sel: '.sub', text: '계좌로', within: card('담은 종목') },
      { sel: '#accounts input', text: '미국 주식 담을 비율', closest: 'form' },
      { sel: '#accounts button', text: '빼기' },
    ],
  },
  {
    file: 'assets',
    path: () => '/assets',
    wait: 1500,
    width: 1280,
    clip: [{ sel: '.page-head' }, { sel: '.card.kpi', closest: 'section' }, { sel: '[aria-label="보유 자산 목록"]' }],
    marks: [
      { sel: '.asset-filters' },
      { sel: '.port-chip', closest: 'td' },
      { sel: '.trait-chip', closest: 'td' },
      { sel: 'button', text: '관리', within: { sel: 'table.asset-book' } },
      { sel: 'a', text: '+ 자산 추가' },
    ],
  },
  {
    file: 'assets-manage',
    path: () => '/assets',
    wait: 1500,
    width: 1280,
    steps: [{ click: { sel: 'button.linkish', text: '애플' } }, { wait: 600 }],
    clip: [{ sel: 'tr.open' }, { sel: 'tr.asset-detail' }],
    marks: [
      { sel: 'form.move-form' },
      { sel: 'button', text: '제거', within: { sel: 'tr.asset-detail' } },
      { sel: 'h3', text: '매수 추가', closest: '.stack' },
      { sel: 'h3', text: '성질', closest: '.stack' },
    ],
  },
  {
    file: 'dashboard-own',
    path: (ids) => `/dashboard?p=${ids.root}`,
    wait: 2200,
    width: 1280,
    clip: [card('자산 배분')],
    marks: [{ sel: '[aria-label="배분 기준"] a', text: '구성' }, { sel: 'li.pick-slice span', text: '미국 주식', closest: 'li' }],
  },
  {
    file: 'portfolio-add',
    path: (ids) => `/portfolios/${ids.us}`,
    wait: 1500,
    clip: [{ sel: '#add' }],
    marks: [{ sel: '[aria-label="자산 종류"]' }, { sel: 'label', text: '이 포트폴리오의 현금으로 결제' }, { sel: 'select[name="type"]', within: card('입출금 · 배당 · 이자') }],
  },
  {
    file: 'holding-sell',
    path: (ids) => `/holdings/${ids.aapl}`,
    wait: 1500,
    steps: [{ set: { sel: 'input[aria-describedby="qty-help"]' }, value: '12' }, { wait: 600 }],
    clip: [card('보유 Lot'), card('매도 · Lot 선택')],
    marks: [card('보유 Lot'), { sel: '[aria-label="Lot 선택 방식"]' }, { sel: 'input[aria-describedby="qty-help"]', closest: 'label' }, { sel: 'span', text: '예상 실현손익', closest: 'div' }],
  },
  {
    file: 'realestate-pick',
    path: (ids) => `/portfolios/${ids.home}`,
    wait: 1500,
    steps: [
      { click: { sel: '[aria-label="자산 종류"] button', text: '수기 자산' } },
      { set: { sel: '.apt-picker input' }, value: '한빛마을래미안' },
      { click: { sel: '.apt-picker button', text: '찾기' } },
      { until: "!!document.querySelector('.apt-picker .book-hits li button')" },
      { click: { sel: '.apt-picker .book-hits li button' } },
      { until: "!!document.querySelector('.apt-picked select')" },
      { wait: 600 },
    ],
    clip: [{ sel: '#add' }],
    marks: [{ sel: '.apt-picker label.field' }, { sel: '.apt-picked label', text: '실거래가 단지' }, { sel: '.apt-picked label', text: '전용면적' }, { sel: '.apt-widen' }, { sel: 'input[name="name"]', closest: 'label' }],
  },
  {
    file: 'realestate-kinds',
    path: (ids) => `/portfolios/${ids.home}`,
    wait: 1500,
    steps: [
      { click: { sel: '[aria-label="자산 종류"] button', text: '수기 자산' } },
      { set: { sel: 'select[name="propertyKind"]' }, value: 'villa' },
      { wait: 400 },
      { set: { sel: '.apt-picker input' }, value: '대치동 903-12' },
      { click: { sel: '.apt-picker button', text: '찾기' } },
      { until: "!!document.querySelector('.apt-picker .book-hits li button')" },
      { click: { sel: '.apt-picker .book-hits li button' } },
      { until: "!!document.querySelector('.apt-picked select')" },
      { wait: 600 },
    ],
    clip: [{ sel: '#add' }],
    marks: [{ sel: 'select[name="propertyKind"]', closest: 'label' }, { sel: '.apt-picked label', text: '실거래가 건물' }, { sel: '.apt-picked label', text: '전용면적' }, { sel: 'input[name="name"]', closest: 'label' }],
  },
  {
    file: 'realestate-lot-pick',
    path: (ids) => `/portfolios/${ids.home}`,
    wait: 1500,
    steps: [
      { click: { sel: '[aria-label="자산 종류"] button', text: '수기 자산' } },
      { set: { sel: 'select[name="propertyKind"]' }, value: 'land' },
      { wait: 400 },
      { set: { sel: '.apt-picker input' }, value: '대치동 120' },
      { click: { sel: '.apt-picker button', text: '찾기' } },
      { until: "!!document.querySelector('.apt-picker .book-hits li button')" },
      { click: { sel: '.apt-picker .book-hits li button' } },
      { until: "!!document.querySelector('.apt-picked select')" },
      { set: { sel: '.apt-picked input' }, value: '165' },
      { wait: 600 },
    ],
    clip: [{ sel: '#add' }],
    marks: [{ sel: 'select[name="propertyKind"]', closest: 'label' }, { sel: '.apt-picked label', text: '비교할 지목' }, { sel: '.apt-picked label', text: '토지 면적' }],
  },
  {
    file: 'realestate-lot',
    path: (ids) => `/holdings/${ids.house}`,
    width: 1280,
    height: 1800,
    steps: [{ until: "!!document.querySelector('#real-estate .kpi')" }, { wait: 1200 }],
    clip: [{ sel: '#real-estate' }],
    marks: [{ sel: '#real-estate .kpi .label', text: '참고 시세', closest: '.kpi' }, { sel: '#real-estate .kpi .label', text: '단독 3.3㎡당', closest: '.kpi' }, { sel: '#real-estate tbody tr.strong' }, { sel: '#real-estate h3', text: '거래 (최근 2년)' }],
  },
  {
    file: 'realestate-holding',
    path: (ids) => `/holdings/${ids.apartment}`,
    width: 1280,
    height: 1800,
    steps: [{ until: "!!document.querySelector('#real-estate .kpi')" }, { wait: 1200 }],
    clip: [{ sel: '#real-estate' }],
    marks: [{ sel: '#real-estate .kpi .label', text: '추정 시세', closest: '.kpi' }, { sel: '#real-estate button', text: '추정 시세를 평가 가치로 기록' }, { sel: '#real-estate a', text: '네이버 부동산 매물' }, { sel: '#real-estate h3', text: '같은 면적 거래' }, { sel: '#real-estate h3', text: '단지 (최근 1년)' }],
  },
  {
    file: 'market-commodities',
    path: () => '/market',
    width: 1280,
    height: 1900,
    steps: [{ until: "!!document.querySelector('#commodities tbody tr') && !!document.querySelector('#my-real-estate tbody tr')" }, { wait: 800 }],
    clip: [{ sel: '#commodities' }, { sel: '#my-real-estate' }],
    marks: [{ sel: '#commodities tbody tr' }, { sel: '#commodities td span', text: 'GCZ' , closest: 'td' }, { sel: '#my-real-estate tbody tr' }],
  },
  {
    file: 'settings-keys',
    path: () => '/settings',
    wait: 1000,
    width: 1100,
    clip: [{ sel: '#key-backup' }],
    marks: [{ sel: 'form[aria-label="키 백업 파일 만들기"]' }, { sel: 'form[aria-label="키 백업 파일에서 되살리기"]' }],
  },
  {
    file: 'alerts-realestate',
    path: () => '/alerts',
    width: 1280,
    height: 1600,
    wait: 1500,
    clip: [{ sel: '#real-estate' }],
    marks: [{ sel: '#real-estate select', closest: 'label', nth: 1 }, { sel: '#real-estate fieldset.re-events' }, { sel: '#real-estate legend', text: '새 거래 조건', closest: 'fieldset' }, { sel: '#real-estate button', text: '지금 확인' }, { sel: '#real-estate tbody tr', nth: 1 }],
  },
  { file: 'settings-realestate', path: () => '/settings', wait: 1000, width: 1100, clip: [{ sel: '#real-estate' }] },
  {
    file: 'settings-security',
    path: () => '/settings',
    wait: 1000,
    width: 1200,
    clip: [{ sel: '#security' }],
    marks: [
      { sel: 'h3', text: '2단계 인증' },
      { sel: 'h3', text: '비밀번호 바꾸기' },
      { sel: 'h3', text: '로그인한 기기' },
      { sel: 'h3', text: '가입 초대' },
      { sel: 'h3', text: '최근 보안 기록' },
    ],
  },
  {
    file: 'settings-menu',
    path: () => '/settings',
    wait: 1000,
    width: 1100,
    // Untick a few (not saved) so the card shows both states
    steps: [{ click: { sel: '#menu label', text: '세금' } }, { click: { sel: '#menu label', text: '자산 성질' } }, { click: { sel: '#menu label', text: '사용량 · 비용' } }],
    clip: [{ sel: '#menu' }],
  },
  {
    file: 'help',
    path: () => '/help',
    wait: 1500,
    width: 1280,
    height: 900,
    marks: [{ sel: 'a.btn', text: 'GitHub에서 보기' }],
  },
  { file: 'data-backup', path: () => '/data', wait: 1000, width: 1100, clip: [{ sel: '.backup-status' }] },
  { file: 'transactions', path: () => '/transactions', wait: 1200, marks: [{ sel: 'form[method="get"]' }] },
  {
    file: 'import-broker',
    path: () => '/import',
    wait: 2500,
    clip: [{ sel: '.page-head' }, card('한국투자 데모 계좌')],
    marks: [{ sel: 'input', text: '카카오 선택' }, { sel: 'select', text: '카카오 넣을 포트폴리오' }, { sel: 'button', text: '가져오기', within: card('한국투자 데모 계좌') }],
  },
  {
    file: 'import-coin',
    path: () => '/import',
    wait: 2500,
    clip: [card('빗썸 (새로 연결)')],
    marks: [{ sel: 'input', text: '비트코인 선택' }, { sel: 'select', text: '비트코인 넣을 포트폴리오' }],
  },
  {
    file: 'import-crypto',
    path: () => '/import',
    wait: 2500,
    clip: [card('코인 거래소 거래내역')],
    marks: [
      { sel: 'span', text: '업비트 데모', closest: '.spread' },
      { sel: 'button', text: '새 거래내역 동기화' },
      { sel: 'span', text: '넣을 포트폴리오', closest: 'label' },
      { sel: 'span', text: '시작일', closest: 'label' },
      { sel: 'button', text: '거래내역 가져오기' },
    ],
  },
  { file: 'import-paste', path: () => '/import', wait: 2500, clip: [card('잔고 붙여넣기 · 파일')] },
  {
    file: 'settings',
    path: () => '/settings',
    wait: 1500,
    steps: [{ set: { sel: 'select[name="broker"]' }, value: 'UPBIT' }, { wait: 400 }],
    clip: [card('연결된 증권사 · 코인 거래소'), card('증권사 · 거래소 추가')],
    marks: [{ sel: 'table', within: card('연결된 증권사 · 코인 거래소') }, { sel: 'button', text: '연결 확인' }, { sel: 'select[name="broker"]', closest: 'label' }, { sel: 'a', text: 'API 관리' }],
  },
  {
    file: 'market',
    path: () => '/market',
    wait: 3000,
    // Mini charts fill in the background after the first board
    steps: [{ until: "document.querySelectorAll('tbody tr.pick svg path').length >= 10", timeout: 30_000 }, { wait: 500 }],
    clip: [{ sel: 'main' }],
    pad: 0,
    marks: [{ sel: '.ticker' }, { sel: 'form[aria-label="관심종목 추가"]' }, card('내 종목'), card('실시간 랭킹')],
  },
  {
    file: 'market-candles',
    path: () => '/market?s=005930',
    wait: 5500,
    scale: 2,
    width: 1280,
    clip: [{ sel: '#stock-detail' }],
    marks: [{ sel: '[aria-label="봉 간격"]' }, { sel: 'span', text: '묶어 만듦' }, { sel: '.book' }],
  },
  {
    file: 'market-coin',
    path: () => '/market?s=KRW-BTC',
    wait: 5000,
    scale: 2,
    width: 1280,
    steps: [{ click: { sel: 'button', text: '4시간' } }, { wait: 2500 }],
    clip: [{ sel: '#stock-detail' }],
    marks: [{ sel: 'button', text: '4시간' }],
  },
  {
    file: 'market-rankings-coin',
    path: () => '/market',
    wait: 4000,
    scale: 2,
    steps: [{ click: { sel: 'button', text: '코인', within: { sel: '[aria-label="시장"]' } } }, { wait: 2500 }],
    clip: [card('실시간 랭킹')],
    marks: [{ sel: '[aria-label="시장"]' }, { sel: '[aria-label="랭킹 기준"]' }],
  },
  {
    file: 'journal-list',
    path: () => '/journal',
    wait: 2500,
    marks: [{ sel: 'form[method="get"]' }, { sel: '.target-bar' }, { sel: 'a', text: '양식 관리' }],
  },
  {
    file: 'journal-entry',
    path: (ids) => `/journal/${ids.nvdaJournal}`,
    wait: 4000,
    width: 1280,
    clip: [{ sel: '.doc-bar' }, { sel: '.format-pick' }],
    marks: [{ sel: '#j-target', closest: 'dd' }, { sel: 'button[aria-label="연결 해제"]', closest: '.chip' }, { sel: 'button', text: '속성 편집', closest: 'div' }, { sel: '.format-pick' }],
  },
  { file: 'journal-body', path: (ids) => `/journal/${ids.nvdaJournal}`, wait: 4000, width: 1280, clip: [{ sel: '.doc-body' }], pad: 16 },
  {
    file: 'journal-indicators',
    path: (ids) => `/journal/${ids.nvdaJournal}`,
    wait: 3000,
    width: 1600,
    height: 1100,
    steps: [{ click: { sel: 'button', text: '분석 지표' } }, { until: "!!document.querySelector('.indicator-panel svg.recharts-surface .recharts-line-curve')", timeout: 60_000 }, { wait: 1200 }],
    clip: [{ sel: '.doc-bar' }, { sel: '.indicator-panel' }],
    marks: [{ sel: 'button', text: '분석 지표' }, { sel: '.indicator-panel select' }, { sel: '.indicator-panel .ind-latest' }, { sel: 'button', text: '일지에 넣기' }],
  },
  {
    file: 'journal-stock-chart',
    path: (ids) => `/journal/${ids.aaplJournal}`,
    wait: 5000,
    width: 1280,
    scale: 2,
    steps: [
      { click: { sel: '.jb-stock button', text: '일' } },
      { wait: 1500 },
      { until: "(document.querySelector('.jb-stock .recharts-surface')?.getBoundingClientRect().width ?? 0) > 100 && document.querySelectorAll('.jb-stock .recharts-bar-rectangle').length > 40", timeout: 20_000 },
      { wait: 1000 },
    ],
    clip: [{ sel: '.jb-stock' }],
    pad: 16,
  },
  {
    file: 'journal-templates',
    path: () => '/journal/templates',
    wait: 1500,
    clip: [{ sel: 'main' }],
    pad: 0,
    marks: [{ sel: 'a', text: '이 양식으로 쓰기' }, { sel: 'a', text: '복사해서 내 양식 만들기' }, { sel: 'a', text: '+ 새 양식' }],
  },
  {
    file: 'journal-template-edit',
    path: (ids) => `/journal/templates/${ids.template}`,
    wait: 3000,
    width: 1280,
    clip: [{ sel: '.doc-bar' }, { sel: 'h2', text: '속성', closest: 'section' }],
    marks: [{ sel: '.def-row select', nth: 1 }, { sel: 'button', text: '+ 속성 추가' }],
  },
  {
    file: 'dashboard-journal',
    path: () => '/dashboard?alloc=holding',
    wait: 2500,
    width: 1280,
    steps: [{ click: { sel: 'li.pick-slice span', text: '엔비디아', closest: 'li' } }, { until: "!!document.querySelector('#journal-panel .journal-list button')" }, { wait: 800 }],
    clip: [card('자산 배분'), { sel: '#journal-panel' }],
    marks: [{ sel: 'li.pick-slice span', text: '엔비디아', closest: 'li' }, { sel: '#journal-panel .journal-list' }],
  },
  {
    file: 'dashboard-journal-drawer',
    path: () => '/dashboard?alloc=holding',
    wait: 2500,
    steps: [
      { click: { sel: 'li.pick-slice span', text: '엔비디아', closest: 'li' } },
      { until: "!!document.querySelector('#journal-panel .journal-list button')" },
      { click: { sel: '#journal-panel .journal-list button' } },
      { until: "!!document.querySelector('.drawer .bn-editor')" },
      // Keep the list in view next to the side window
      { until: "(window.scrollTo(0, document.getElementById('journal-panel').getBoundingClientRect().top + scrollY - 380), true)" },
      { wait: 2500 },
    ],
    marks: [{ sel: '#journal-panel .journal-list button .strong' }, { sel: '.drawer .props' }],
  },
  {
    file: 'journal-tree',
    path: () => '/journal?view=tree',
    wait: 2500,
    clip: [{ sel: 'h2', text: '자산 구성 트리', closest: 'section' }],
    pad: 0,
    marks: [{ sel: '[aria-label="분류 기준"]' }, { sel: '.tree-node.k-category' }, { sel: '.tree-node.k-asset .tgl' }, { sel: '.tree-node.k-journal' }, { sel: '.tree-node.k-trade' }],
  },
  {
    file: 'journal-tree-detail',
    path: (ids) => `/journal?view=tree&by=${ids.allWeather}`,
    wait: 2500,
    steps: [{ press: { sel: '.tree-node.k-asset' } }, { until: "!!document.querySelector('.drawer.tree-detail')" }, { wait: 800 }],
    marks: [{ sel: '.tree-node.k-asset' }, { sel: '.drawer.tree-detail .props' }, { sel: '.drawer.tree-detail .detail-list' }],
  },
  {
    file: 'traits',
    path: (ids) => `/traits?g=${ids.assetClass}`,
    wait: 2500,
    clip: [{ sel: '.page-head' }, { sel: 'h2', text: '무엇을 살까', closest: 'section' }],
    marks: [{ sel: '[role="tablist"]' }, { sel: 'table.trait-table thead' }, { sel: '.alloc-bar .target' }, { sel: 'table.trait-table .badge.warn' }, { sel: 'h2', text: '무엇을 살까', closest: 'section' }],
  },
  {
    file: 'traits-style',
    path: (ids) => `/traits?g=${ids.equityStyle}`,
    wait: 2500,
    width: 1280,
    clip: [{ sel: 'h2', text: '무엇을 살까', closest: 'section' }, { sel: 'h2', text: '종목별 성질 지정', closest: 'section' }],
    marks: [{ sel: '.buy-row .chip-btn' }, { sel: '.trait-chip[aria-pressed="true"]' }, { sel: 'button', text: '성질 지정하기' }],
  },
  {
    file: 'traits-edit',
    path: (ids) => `/traits?g=${ids.equityStyle}`,
    wait: 2500,
    width: 1280,
    steps: [{ click: { sel: 'button', text: '성질 · 목표 비중 편집' } }, { wait: 500 }],
    clip: [{ sel: '.card.tight', within: { sel: 'h2', text: '주식 스타일', closest: 'section' } }],
    marks: [{ sel: 'input[aria-label="목표 비중 %"]' }, { sel: 'span', text: '목표 합계' }, { sel: 'select', within: { sel: '.card.tight' } }],
  },
  {
    file: 'traits-add',
    path: () => '/traits',
    wait: 2000,
    width: 1280,
    steps: [{ click: { sel: 'button[role="tab"]', text: '+ 분류 추가' } }, { wait: 500 }],
    clip: [{ sel: 'h2', text: '분류 추가', closest: 'section' }],
    marks: [{ sel: 'label', text: '자동으로 지정' }, { sel: 'h3', text: '지역', closest: '.card' }, { sel: 'h3', text: '직접 만들기', closest: '.card' }],
  },
  {
    file: 'dashboard-traits',
    path: (ids) => `/dashboard?alloc=trait&g=${ids.allWeather}`,
    wait: 2500,
    width: 1280,
    clip: [card('자산 배분')],
    marks: [{ sel: 'a', text: '성질', within: { sel: '[aria-label="배분 기준"]' } }, { sel: '[aria-label="성질 분류"]' }],
  },
  {
    file: 'alerts',
    path: () => '/alerts',
    wait: 2500,
    marks: [{ sel: '.nav-badge', closest: 'a' }, { sel: '.inbox li' }, { sel: 'button', text: '모두 읽음' }, { sel: 'a', text: '브리핑 전체 보기' }, { sel: 'button', text: 'AI로 분석' }],
  },
  {
    file: 'alerts-price',
    path: () => '/alerts',
    wait: 2500,
    width: 1280,
    clip: [{ sel: 'h2', text: '가격 알림', closest: 'section' }],
    marks: [{ sel: 'form.grid' }, { sel: 'th', text: '남은 거리' }, { sel: '.badge', text: '일지 목표가', closest: 'td' }, { sel: 'button', text: '다시 켜기', closest: 'tr' }],
  },
  {
    file: 'alerts-push',
    path: () => '/alerts',
    wait: 2500,
    width: 1280,
    clip: [{ sel: 'h2', text: '목표 비중 알림', closest: 'section' }, { sel: 'h2', text: '푸시 알림 받을 기기', closest: 'section' }],
    marks: [{ sel: 'h2', text: '목표 비중 알림', closest: 'section' }, { sel: 'button', text: '이 기기에서 알림 받기' }, { sel: 'button', text: '테스트 알림 보내기' }],
  },
  {
    file: 'portfolio-targets',
    path: (ids) => `/portfolios/${ids.us}`,
    wait: 2500,
    width: 1280,
    clip: [{ sel: '#targets' }],
    marks: [{ sel: '#targets input[inputmode="decimal"]' }, { sel: '#targets .badge.warn' }, { sel: 'th', text: '목표대로 맞추려면' }, { sel: 'label', text: '허용 오차' }, { sel: 'label', text: '벗어나면 알림 받기' }],
  },
  {
    file: 'journal-slash',
    path: (ids) => `/journal/${ids.nvdaJournal}`,
    wait: 4000,
    width: 1280,
    steps: [
      { press: { sel: '.bn-editor [data-content-type="paragraph"] .bn-inline-content' } },
      { key: 'End' },
      { key: 'Enter' },
      { type: '/' },
      { until: "!!document.querySelector('.bn-suggestion-menu')" },
      { wait: 600 },
    ],
    clip: [{ sel: '.bn-suggestion-menu' }, { sel: '.bn-editor [data-content-type="heading"]' }],
  },
  {
    file: 'notes',
    path: () => '/notes',
    wait: 2000,
    clip: [{ sel: '.page-head' }, { sel: '.note-grid' }],
    marks: [{ sel: '[aria-label="투자 노트"]' }, { sel: 'textarea', closest: '.card' }, { sel: '.hashtag' }, { sel: '.note-card .kchip', closest: '.inline' }, { sel: 'form[method="get"]' }],
  },
  {
    file: 'quick-memo',
    path: (ids) => `/holdings/${ids.samsung}`,
    wait: 2000,
    fabs: true,
    steps: [{ click: { sel: '.memo-fab' } }, { until: "!!document.querySelector('.memo-drawer textarea')" }, { set: { sel: '.memo-drawer textarea' }, value: '실적 발표 후 외국인 순매수 전환. 목표가 다시 점검 #가치투자' }, { wait: 600 }],
    marks: [{ sel: '.memo-fab' }, { sel: '.memo-drawer textarea' }, { sel: '.memo-drawer .sub', text: 'Ctrl+Enter' }],
  },
  {
    file: 'quick-memo-edit',
    path: (ids) => `/holdings/${ids.samsung}`,
    wait: 2000,
    fabs: true,
    steps: [
      { click: { sel: '.memo-fab' } },
      { until: "!!document.querySelector('.memo-recent li button')" },
      { click: { sel: '.memo-recent li button' } },
      { wait: 600 },
    ],
    marks: [{ sel: '.memo-recent li button' }, { sel: '.memo-drawer textarea' }, { sel: '.memo-drawer button', text: '다시 저장' }, { sel: '.memo-drawer button', text: '새 메모' }],
  },
  {
    file: 'sages',
    path: () => '/sages',
    wait: 1500,
    clip: [{ sel: 'h2', text: '내가 정리한 거장', closest: 'section' }, { sel: 'h2', text: '거장 추가', closest: 'section' }],
    pad: 16,
    marks: [{ sel: '.badge.ok' }, { sel: 'button.primary', text: '추가' }, { sel: 'button', text: '직접 추가' }],
  },
  {
    file: 'sage-detail',
    path: (ids) => `/sages/${ids.buffett}`,
    wait: 4000,
    width: 1280,
    clip: [{ sel: '.doc-bar' }, { sel: 'details.card' }],
    marks: [{ sel: '.props' }, { sel: 'span', text: '속성 —', closest: 'section' }, { sel: 'details.card .related' }],
  },
  {
    file: 'book-detail',
    path: (ids) => `/books/${ids.book}`,
    wait: 4000,
    width: 1280,
    clip: [{ sel: '.doc-bar' }, { sel: '.doc-body' }],
    marks: [{ sel: 'button', text: '제목으로 찾아 채우기' }, { sel: '[aria-label="읽은 상태"]' }, { sel: 'span', text: '속성 —', closest: 'section' }, { sel: 'details.card' }, { sel: '.doc-body' }],
  },
  {
    file: 'books-search',
    path: () => '/books',
    wait: 2000,
    width: 1280,
    steps: [{ set: { sel: 'input[aria-label="책 제목"]' }, value: '현명한 투자자' }, { click: { sel: 'button', text: '찾기' } }, { until: "!!document.querySelector('.book-hits li')", timeout: 15_000 }, { wait: 300 }],
    clip: [{ sel: 'nav[aria-label="투자 노트"]' }, { sel: '.book-hits' }, { sel: '[aria-label="상태"]' }],
    marks: [{ sel: 'button', text: '찾기' }, { sel: '.book-hits li' }, { sel: 'button', text: '그냥 추가' }, { sel: 'button', text: 'AI에게 다음 책 추천받기' }],
  },
  {
    file: 'topics',
    path: () => '/topics',
    wait: 2000,
    width: 1280,
    clip: [{ sel: '.topic-layout' }],
    pad: 16,
    marks: [{ sel: '[aria-label="키워드 목록"]' }, { sel: 'span', text: '연결 —', closest: 'div' }],
  },
  {
    file: 'holding-knowledge',
    path: (ids) => `/holdings/${ids.samsung}`,
    wait: 2000,
    width: 1280,
    clip: [{ sel: '#knowledge' }],
  },
  {
    file: 'journal-tree-related',
    path: (ids) => `/journal?view=tree&by=${ids.equityStyle}`,
    wait: 2500,
    steps: [{ press: { sel: '.tree-node.k-category' } }, { until: "!!document.querySelector('.drawer.tree-detail .related')", timeout: 20_000 }, { wait: 800 }],
    marks: [{ sel: '.tree-node.k-category' }, { sel: '.drawer.tree-detail .related' }],
  },
  {
    file: 'ai-page',
    path: (ids) => `/ai?c=${ids.aiChat}`,
    wait: 2500,
    height: 1180,
    steps: [{ until: "(document.querySelector('.ai-log').scrollTop = 0, true)" }, { wait: 300 }],
    marks: [{ sel: '[aria-label="새 대화"]' }, { sel: '[aria-label="지난 대화"]' }, { sel: '.ai-steps' }, { sel: '.ai-md table' }, { sel: '.ai-action' }, { sel: '.ai-input textarea' }],
  },
  {
    file: 'ai-earnings',
    path: () => '/ai?agent=EARNINGS',
    wait: 2000,
    steps: EARNINGS_LENS,
    clip: [{ sel: '.ai-main' }],
    marks: [{ sel: '[aria-label="가이드라인 예시"]' }, { sel: 'textarea[aria-label="분석 가이드라인"]' }, { sel: 'select[aria-label="투자 거장 관점"]' }, { sel: '.ai-starter' }],
  },
  {
    file: 'ai-earnings-answer',
    path: () => '/ai?agent=EARNINGS',
    wait: 2000,
    height: 2400,
    steps: [
      ...EARNINGS_LENS,
      { click: { sel: '.ai-starter' } },
      { until: "!!document.querySelector('.ai-main .ai-action') && !document.querySelector('.ai-steps.live')", timeout: 40_000 },
      // The whole answer, not the chat's scrolling window
      { until: "(document.querySelector('.ai-main .ai-chat').style.height = 'auto', document.querySelector('.ai-main .ai-log').style.overflow = 'visible', true)" },
      { wait: 600 },
    ],
    clip: [{ sel: '.ai-main' }],
    marks: [{ sel: '.ai-main .earnings-lens' }, { sel: '.ai-main .ai-steps' }, { sel: '.ai-main .ai-md table' }, { sel: '.ai-main .ai-md h2', text: '내 가이드라인으로 본 평가' }, { sel: '.ai-main .ai-action' }],
  },
  {
    file: 'ai-drawer',
    path: (ids) => `/holdings/${ids.samsung}`,
    wait: 2000,
    fabs: true,
    steps: [{ click: { sel: 'button', text: 'AI에게 이 종목 묻기' } }, { until: "!!document.querySelector('.ai-drawer .ai-action') && !document.querySelector('.ai-drawer .ai-steps.live')", timeout: 30_000 }, { wait: 800 }],
    marks: [{ sel: '.ai-drawer select' }, { sel: '.ai-drawer .ai-steps' }, { sel: '.ai-drawer .ai-action' }, { sel: '.ai-drawer textarea' }],
  },
  {
    file: 'ai-sage',
    path: (ids) => `/sages/${ids.buffett}`,
    wait: 2500,
    steps: [{ click: { sel: 'button', text: '관점으로 내 포트폴리오 보기' } }, { until: "!!document.querySelector('.ai-drawer .ai-action') && !document.querySelector('.ai-drawer .ai-steps.live')", timeout: 30_000 }, { wait: 800 }],
    marks: [{ sel: 'button', text: '관점으로 내 포트폴리오 보기' }, { sel: '.ai-drawer select' }, { sel: '.ai-drawer .ai-action' }],
  },
  {
    file: 'ai-research',
    path: () => '/market?s=NVDA',
    wait: 5000,
    steps: [{ click: { sel: '#stock-detail button', text: 'AI 리서치' } }, { until: "!!document.querySelector('.ai-drawer .ai-action') && !document.querySelector('.ai-drawer .ai-steps.live')", timeout: 40_000 }, { wait: 800 }],
    marks: [{ sel: '.ai-drawer select' }, { sel: '.ai-drawer .ai-md h2', text: '리스크' }, { sel: '.ai-drawer .ai-action' }, { sel: '.ai-drawer .ai-sources' }],
  },
  {
    file: 'ai-coach',
    path: (ids) => `/journal/${ids.nvdaJournal}`,
    wait: 4000,
    steps: [{ click: { sel: 'button', text: 'AI와 복기' } }, { until: "!!document.querySelector('.ai-drawer .ai-action') && !document.querySelector('.ai-drawer .ai-steps.live')", timeout: 40_000 }, { wait: 800 }],
    marks: [{ sel: '.ai-drawer select' }, { sel: '.ai-drawer .ai-md table' }, { sel: '.ai-drawer .ai-action' }],
  },
  {
    file: 'ai-librarian',
    path: () => '/books',
    wait: 2000,
    steps: [{ click: { sel: 'button', text: 'AI에게 다음 책 추천받기' } }, { until: "!!document.querySelector('.ai-drawer .ai-action') && !document.querySelector('.ai-drawer .ai-steps.live')", timeout: 40_000 }, { wait: 800 }],
    marks: [{ sel: '.ai-drawer select' }, { sel: '.ai-drawer .ai-md .table-wrap' }, { sel: '.ai-drawer .ai-action' }],
  },
  {
    file: 'ai-briefing',
    path: (ids) => `/ai?c=${ids.aiBriefing}`,
    wait: 2500,
    width: 1280,
    steps: [{ until: "(document.querySelector('.ai-log').scrollTop = 0, true)" }, { wait: 300 }],
    clip: [{ sel: '.ai-main' }],
    pad: 12,
    marks: [{ sel: '.ai-main h2' }, { sel: '.ai-turn.user' }, { sel: '.ai-md h2', text: '오늘 할 일' }],
  },
  {
    file: 'ai-skills',
    path: () => '/ai/skills',
    wait: 1500,
    width: 1280,
    clip: [{ sel: '.page-head' }, { sel: 'nav[aria-label="스킬"]' }, { sel: '.skill-table', closest: '.card' }],
    marks: [
      { sel: 'button', text: '+ 새 스킬', closest: '.inline' },
      { sel: '.skill-table input[type="checkbox"]' },
      { sel: '.skill-table a.badge' },
      { sel: '.skill-table .skill-agents' },
      { sel: 'button', text: '다시 가져오기' },
    ],
  },
  {
    file: 'ai-skills-community',
    path: () => '/ai/skills?tab=community',
    wait: 2000,
    width: 1440,
    height: 1100,
    steps: [{ click: { sel: '.skill-pick span', text: 'dcf-valuation', closest: '.skill-pick' } }, { until: "!!document.querySelector('.skill-preview h2')", timeout: 15_000 }, { wait: 400 }],
    clip: [{ sel: '.skill-community' }],
    marks: [
      { sel: 'input[aria-label="커뮤니티 스킬 찾기"]' },
      { sel: '[aria-label="분류"]' },
      { sel: '.skill-rank tbody tr' },
      { sel: '.skill-warn' },
      { sel: 'button', text: '내 어드바이저에 적용', closest: '.inline' },
      { sel: '.skill-body' },
    ],
  },
  {
    file: 'ai-skill-use',
    path: (ids) => `/ai?c=${ids.aiSkillChat}`,
    wait: 2500,
    width: 1280,
    steps: [{ until: "(document.querySelector('.ai-log').scrollTop = 0, true)" }, { wait: 300 }],
    clip: [{ sel: '.ai-main h2' }, { sel: '.ai-turn.user' }, { sel: '.ai-steps' }, { sel: '.ai-steps', nth: 1 }],
    pad: 10,
    marks: [{ sel: '.ai-steps' }, { sel: '.ai-steps', nth: 1 }],
  },
  {
    file: 'ai-settings',
    path: () => '/settings',
    wait: 1500,
    width: 1280,
    clip: [{ sel: '#ai' }],
    marks: [
      { sel: '.ai-key-table' },
      { sel: '.ai-model-all' },
      { sel: '.ai-model-table' },
      { sel: 'input[name="monthlyLimit"]', closest: 'label' },
      { sel: 'input[name="webSearch"]', closest: 'label' },
      { sel: 'input[name="briefing"]', closest: 'label' },
      { sel: 'input[name="alertAnalysis"]', closest: 'label' },
      { sel: 'button', text: '지금 브리핑 받아 보기' },
    ],
  },
  {
    file: 'tax',
    path: () => '/tax',
    wait: 2500,
    clip: [{ sel: 'main' }],
    pad: 0,
    marks: [{ sel: '[aria-label="연도"]' }, { sel: '.card.kpi' }, { sel: '#overseas table' }, { sel: '#harvest' }, { sel: '#financial .alloc-bar' }],
  },
  {
    file: 'dividends',
    path: () => '/dividends',
    wait: 2500,
    clip: [{ sel: 'main' }],
    pad: 0,
    marks: [{ sel: 'section[aria-label="요약"]' }, { sel: '#flow .recharts-surface' }, { sel: '.div-month:not(.empty)' }, { sel: '#by-asset table' }],
  },
  {
    file: 'performance',
    path: () => '/performance',
    wait: 3000,
    clip: [{ sel: 'main' }],
    pad: 0,
    marks: [{ sel: '[aria-label="기간 선택"]' }, { sel: 'section[aria-label="요약"]' }, { sel: '[aria-label="해외 자산 금액 통화"]' }, { sel: '#contrib .contrib' }, { sel: '#contrib-group .contrib' }],
  },
  {
    file: 'performance-benchmarks',
    path: () => '/performance',
    wait: 3000,
    steps: [{ click: { sel: '#benchmarks summary' } }, { wait: 500 }],
    clip: [{ sel: 'section[aria-label="요약"]' }, { sel: '#benchmarks' }],
    marks: [{ sel: '.bench-remove' }, { sel: '#benchmarks summary' }, { sel: '.bench-group', nth: 2 }, { sel: '#benchmarks a', text: '연동 · 설정' }],
  },
  {
    file: 'goals',
    path: () => '/goals',
    wait: 3000,
    clip: [{ sel: '.page-head' }, { sel: '.goal-card' }],
    marks: [{ sel: '.goal-kpis .kpi' }, { sel: '.goal-kpis .kpi', nth: 1 }, { sel: '.goal-kpis .kpi', nth: 2 }, { sel: '.goal-card .recharts-surface' }, { sel: 'button', text: '고치기' }],
  },
  {
    file: 'goals-backtest',
    path: () => '/goals/backtest',
    wait: 3000,
    clip: [{ sel: 'main' }],
    pad: 0,
    marks: [{ sel: '#rules table' }, { sel: '#rules .recharts-surface' }, { sel: '#parts .bt-parts' }],
  },
  {
    file: 'data-export',
    path: () => '/data',
    wait: 1000,
    clip: [{ sel: 'main' }],
    pad: 0,
    marks: [{ sel: 'form[aria-label="내보낼 범위"]' }, { sel: 'h2', text: '데이터 (다시', closest: '.card' }, { sel: 'a', text: '전체 XLSX 받기' }, { sel: 'h2', text: '보고서', closest: '.card' }],
  },
  {
    file: 'data-import',
    path: () => '/data?tab=import',
    wait: 1000,
    steps: [
      { until: "(async () => { const b = await (await fetch('/api/data/sample/all?format=xlsx')).blob(); const dt = new DataTransfer(); dt.items.add(new File([b], 'ppfp-sample-all.xlsx')); const i = document.querySelector('input[type=file]'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()" },
      { wait: 300 },
      { click: { sel: 'button', text: '확인하기' } },
      { until: "!!document.querySelector('[aria-label=\"가져오기 미리 보기\"] table')", timeout: 20_000 },
      { until: "(document.querySelectorAll('.import-issues').forEach((d) => (d.open = d.classList.contains('err'))), true)" },
      { wait: 300 },
    ],
    clip: [{ sel: 'main' }],
    pad: 0,
    marks: [{ sel: 'input[type="file"]' }, { sel: 'button', text: '확인하기' }, { sel: '.import-summary' }, { sel: '.import-issues' }, { sel: '[aria-label="가져오기 미리 보기"] .btn.primary' }],
  },
  {
    file: 'data-format',
    path: () => '/data?tab=format',
    wait: 1000,
    clip: [{ sel: 'h2', text: '샘플 파일', closest: '.card' }, { sel: '#transactions' }],
    marks: [{ sel: 'a', text: '샘플 전체 XLSX 받기' }, { sel: 'a', text: '샘플 CSV', within: { sel: '#transactions' } }, { sel: '.badge.warn', within: { sel: '#transactions' } }, { sel: '#transactions .data-format td.mono' }],
  },
  { file: 'mobile-market', path: () => '/market', wait: 5000, mobile: true, width: 390, height: 844, scale: 2 },
  {
    file: 'usage',
    path: () => '/usage',
    wait: 1500,
    width: 1360,
    clip: [{ sel: 'main' }],
    pad: 0,
    marks: [
      { sel: '.usage-strip .usage-chip' },
      { sel: 'section[aria-label="AI 비용 요약"]' },
      { sel: 'section[aria-label="일별 AI 비용"]' },
      { sel: 'h2', text: '모델별', closest: '.card' },
      { sel: 'section[aria-label="외부 API"] table' },
    ],
  },
  // These turn on 현지 통화 for the demo user, so they come last
  {
    file: 'dashboard-local',
    path: () => '/dashboard',
    wait: 2200,
    width: 1360,
    steps: [{ click: { sel: '[aria-label="해외 자산 금액 통화"] button', text: '현지 통화' } }, { until: "document.querySelector('[aria-label=\"해외 자산 금액 통화\"] button[aria-pressed=\"true\"]')?.textContent.includes('현지')", timeout: 15_000 }, { wait: 1500 }],
    clip: [{ sel: '.page-head' }, { sel: 'section[aria-label="요약"]' }],
    marks: [{ sel: '[aria-label="해외 자산 금액 통화"]' }, { sel: '.page-head .sub', text: 'USD/KRW' }, { sel: '.note', text: '달러 자산' }],
  },
  {
    file: 'dashboard-local-holdings',
    path: () => '/dashboard',
    wait: 2200,
    width: 1680,
    clip: [{ sel: 'h2', text: '보유 종목', closest: '.card' }],
    marks: [{ sel: 'td.money', text: '$', within: { sel: 'h2', text: '보유 종목', closest: '.card' } }],
  },
];

// ---------------------------------------------------------------- page helpers (run in the browser)
const PAGE_HELPERS = String.raw`
window.__docs = {
  find(f, root = document) {
    const scope = f.within ? this.find(f.within) : root;
    let list = [...scope.querySelectorAll(f.sel || '*')];
    if (f.text) {
      const t = f.text;
      list = list.filter((e) =>
        [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.replace(/\s+/g, ' ').includes(t)) ||
        (e.getAttribute('aria-label') || '').includes(t));
    }
    let el = list[f.nth || 0] || null;
    if (el && f.closest) el = el.closest(f.closest);
    if (!el) throw new Error('element not found: ' + JSON.stringify(f));
    return el;
  },
  box(fs, pad) {
    const rs = fs.map((f) => this.find(f).getBoundingClientRect());
    const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - pad + scrollX);
    const y = Math.max(0, Math.min(...rs.map((r) => r.top)) - pad + scrollY);
    const right = Math.min(document.documentElement.scrollWidth, Math.max(...rs.map((r) => r.right)) + pad + scrollX);
    const bottom = Math.max(...rs.map((r) => r.bottom)) + pad + scrollY;
    return { x, y, width: right - x, height: bottom - y };
  },
  click(f) { this.find(f).click(); },
  center(f) {
    const el = this.find(f);
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  },
  set(f, value) {
    const el = this.find(f);
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  },
  mark(fs) {
    const layer = document.createElement('div');
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
    fs.forEach((f, i) => {
      const r = this.find(f).getBoundingClientRect();
      const box = document.createElement('div');
      box.style.cssText = 'position:absolute;border:2.5px solid #FF5A1F;border-radius:10px;box-shadow:0 0 0 3px rgba(255,90,31,.18)';
      Object.assign(box.style, { left: r.left + scrollX - 5 + 'px', top: r.top + scrollY - 5 + 'px', width: r.width + 10 + 'px', height: r.height + 10 + 'px' });
      const badge = document.createElement('div');
      badge.textContent = String(i + 1);
      badge.style.cssText = 'position:absolute;width:26px;height:26px;border-radius:13px;background:#FF5A1F;color:#fff;font:700 14px/26px system-ui,sans-serif;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.3)';
      Object.assign(badge.style, { left: Math.max(2, r.left + scrollX - 24) + 'px', top: Math.max(2, r.top + scrollY - 20) + 'px' });
      layer.append(box, badge);
    });
    document.body.append(layer);
  },
};
`;

// ---------------------------------------------------------------- DevTools protocol
class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners: ((m: any) => void)[] = [];
  private constructor(private ws: WebSocket) {
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('DevTools connection closed'));
      this.pending.clear();
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else p.resolve(msg.result);
      } else for (const l of this.listeners) l(msg);
    });
  }
  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)));
      ws.addEventListener('error', () => reject(new Error('DevTools connection failed')));
    });
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  once(method: string, sessionId: string, timeout = 30_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeout);
      const l = (m: any) => {
        if (m.method === method && m.sessionId === sessionId) {
          clearTimeout(t);
          this.listeners = this.listeners.filter((x) => x !== l);
          resolve(m.params);
        }
      };
      this.listeners.push(l);
    });
  }
  close() {
    this.ws.close();
  }
}

// Ubuntu blocks Chrome's user-namespace sandbox for binaries outside /opt (Playwright's Chromium on the VM);
// the page is our own demo server, so run it unsandboxed there
const LINUX_FLAGS = process.platform === 'linux' ? ['--no-sandbox'] : [];

async function launchChrome(): Promise<{ proc: ChildProcess; cdp: Cdp; dir: string }> {
  if (!CHROME) throw new Error('Chrome not found: set CHROME_PATH.');
  const dir = mkdtempSync(path.join(tmpdir(), 'ppfp-docs-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--force-color-profile=srgb', '--lang=ko-KR', ...LINUX_FLAGS, 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const [port, wsPath] = readFileSync(portFile, 'utf8').trim().split('\n');
  const cdp = await Cdp.connect(`ws://127.0.0.1:${port}${wsPath}`);
  // Headless Chrome quits when its last page closes: keep one blank page open throughout
  await cdp.send('Target.createTarget', { url: 'about:blank' });
  return { proc, cdp, dir };
}

async function capture(cdp: Cdp, shot: Shot, ids: Ids, token: string) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method: string, params: Record<string, unknown> = {}) => cdp.send(method, params, sessionId);
  try {
    await s('Page.enable');
    // A tab in the background gets its animation frames throttled, and charts measure in one
    await s('Page.bringToFront');
    await s('Emulation.setFocusEmulationEnabled', { enabled: true });
    await s('Runtime.enable');
    await s('Network.enable');
    if (!shot.anonymous) await s('Network.setCookie', { name: 'ppfp_session', value: token, url: BASE, httpOnly: true, sameSite: 'Lax' });
    const width = shot.width ?? 1440;
    const height = shot.height ?? 900;
    const scale = shot.scale ?? 1;
    await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: !!shot.mobile });
    if (shot.mobile) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: shot.dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    await s('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Seoul' });
    await s('Emulation.setLocaleOverride', { locale: 'ko-KR' });
    const loaded = cdp.once('Page.loadEventFired', sessionId, 90_000);
    await s('Page.navigate', { url: BASE + shot.path(ids) });
    await loaded;
    await sleep(shot.wait ?? 1200);
    const run = async (expr: string) => {
      const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`${shot.file}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    };
    await run(PAGE_HELPERS);
    if (!shot.fabs) await run("document.head.insertAdjacentHTML('beforeend', '<style>.memo-fab,.ai-fab{display:none!important}</style>')");
    for (const step of shot.steps ?? []) {
      if ('wait' in step) await sleep(step.wait);
      else if ('until' in step) {
        const end = Date.now() + (step.timeout ?? 15_000);
        while (!(await run(step.until))) {
          if (Date.now() > end) throw new Error(`${shot.file}: timed out waiting for ${step.until}`);
          await sleep(250);
        }
      } else if ('click' in step) await run(`__docs.click(${JSON.stringify(step.click)})`);
      else if ('press' in step) {
        const { x, y } = await run(`__docs.center(${JSON.stringify(step.press)})`);
        for (const type of ['mousePressed', 'mouseReleased']) await s('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      } else if ('type' in step) {
        await s('Input.insertText', { text: step.type });
        await sleep(150);
      } else if ('key' in step) {
        const code = { Enter: 13, End: 35 }[step.key];
        for (const type of ['keyDown', 'keyUp']) await s('Input.dispatchKeyEvent', { type, key: step.key, code: step.key, windowsVirtualKeyCode: code, ...(type === 'keyDown' && step.key === 'Enter' ? { text: '\r' } : {}) });
        await sleep(150);
      } else await run(`__docs.set(${JSON.stringify(step.set)}, ${JSON.stringify(step.value)})`);
    }
    // Lay the whole page out at once for crops, so nothing depends on scrolling
    let full = 0;
    if (shot.clip) {
      full = await run('Math.ceil(document.documentElement.scrollHeight)');
      await s('Emulation.setDeviceMetricsOverride', { width, height: Math.min(full, Math.max(6000, height)), deviceScaleFactor: scale, mobile: !!shot.mobile });
      // Charts that just came into view lay out and animate
      await sleep(2000);
      // A chart sized while it was off screen can stay empty for a while; wait until each has drawn
      // (a surface of width 0 has not been measured yet; a resize event makes it measure again)
      const drawn =
        "[...document.querySelectorAll('.recharts-responsive-container')].every((c) => Number(c.querySelector('.recharts-surface')?.getAttribute('width')) > 0 && c.querySelector('.recharts-line-curve, .recharts-area-area, .recharts-bar-rectangle, .recharts-pie-sector'))";
      for (const end = Date.now() + 10_000; !(await run(drawn)) && Date.now() < end; ) {
        await run("window.dispatchEvent(new Event('resize'))");
        await sleep(250);
      }
      await run(PAGE_HELPERS);
    }
    if (shot.marks?.length) await run(`__docs.mark(${JSON.stringify(shot.marks)})`);
    const clip = shot.clip ? { ...(await run(`__docs.box(${JSON.stringify(shot.clip)}, ${shot.pad ?? 28})`)), scale: 1 } : undefined;
    // When the whole page fits the window, capture it as shown: capturing beyond the viewport
    // sometimes leaves SVG charts out
    const { data } = await s('Page.captureScreenshot', { format: 'webp', quality: 92, captureBeyondViewport: !!clip && full > Math.max(6000, height), ...(clip ? { clip } : {}) });
    const file = path.join(OUT, `${shot.file}.webp`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`  ${shot.file}.webp  ${(Buffer.byteLength(data, 'base64') / 1024).toFixed(0)} KB`);
  } finally {
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

// ---------------------------------------------------------------- orchestration
function demoUrl(): { main: string; demo: string; name: string } {
  const main = process.env.DATABASE_URL;
  if (!main) throw new Error('DATABASE_URL is not set (run through npm run docs:screenshots, which loads .env).');
  const u = new URL(main);
  const name = `${u.pathname.slice(1) || 'ppfp'}_docs`;
  u.pathname = '/' + name;
  return { main, demo: u.toString(), name };
}

async function waitForServer(proc: ChildProcess) {
  for (let i = 0; i < 120; i++) {
    if (proc.exitCode !== null) throw new Error('The demo server exited; see its output above.');
    try {
      const r = await fetch(`${BASE}/login`);
      if (r.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error('The demo server did not start.');
}

async function main() {
  if (!existsSync(path.join(ROOT, '.next/BUILD_ID'))) throw new Error('No production build: run npm run build first.');
  const { main: mainUrl, demo, name } = demoUrl();
  const admin = new PrismaClient({ datasourceUrl: mainUrl });
  // The AI advisor talks to the scripted fake in fake-claude.cjs, never to the real API
  const env = {
    ...process.env,
    DATABASE_URL: demo,
    COOKIE_SECURE: 'false',
    ANTHROPIC_API_KEY: 'sk-ant-docs-demo-not-a-real-key',
    ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    CRON_SECRET: 'docs-demo-cron-secret',
    // Book search goes to the fake in fake-books.cjs
    KAKAO_REST_API_KEY: '0123456789abcdef0123456789abcdef',
    // Apartment deals come from fake-realestate.cjs
    DATA_GO_KR_API_KEY: 'docs-demo-data-go-kr-key-not-real',
    VWORLD_API_KEY: 'DOCS-DEMO-VWORLD-KEY-NOT-REAL',
    // Community skills come from the made-up catalog in fake-skills.cjs
    PPFP_FAKE_SKILLS: '1',
    // 분석 지표 series come from fake-indicators.cjs (FRED, ECOS, KOSIS, the New York Fed's ACM file)
    PPFP_FAKE_INDICATORS: '1',
    ECOS_API_KEY: 'DOCSDEMOECOSKEY0000',
    KOSIS_API_KEY: 'docsDemoKosisKeyNotReal0000',
    RONE_API_KEY: 'docsDemoRoneKeyNotReal0000',
    // OpenDART and FRED answer from fake-dart-fred.cjs
    DART_API_KEY: '0000000000000000000000000000000000000000',
    FRED_API_KEY: '00000000000000000000000000000000',
    // Two-step sign-in, devices and a backup record for the security screens (seed-demo.ts)
    DOCS_CAPTURE: '1',
  };
  let server: ChildProcess | null = null;
  let chrome: Awaited<ReturnType<typeof launchChrome>> | null = null;
  try {
    console.log(`demo database ${name}`);
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    const bin = (b: string) => path.join(ROOT, 'node_modules/.bin', b);
    const migrate = spawnSync(bin('prisma'), ['migrate', 'deploy'], { cwd: ROOT, env, encoding: 'utf8' });
    if (migrate.status !== 0) throw new Error(`prisma migrate deploy failed:\n${migrate.stderr || migrate.stdout}`);

    console.log('seeding the demo account');
    const seed = spawnSync(bin('tsx'), [path.join(__dirname, 'seed-demo.ts')], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (seed.status !== 0) throw new Error(`seed failed:\n${seed.stderr}\n${seed.stdout}`);
    const token = seed.stdout.trim().split('\n').at(-1)!;

    const db = new PrismaClient({ datasourceUrl: demo });
    const pf = await db.portfolio.findMany({ select: { id: true, name: true } });
    const pid = (n: string) => pf.find((p) => p.name === n)!.id;
    const aapl = await db.holding.findFirstOrThrow({ where: { portfolioId: pid('미국 주식'), asset: { symbol: 'AAPL' } } });
    const journal = async (symbol: string) => (await db.journalEntry.findFirstOrThrow({ where: { asset: { symbol } } })).id;
    const ids: Ids = {
      root: pid('순자산'),
      us: pid('미국 주식'),
      aapl: aapl.id,
      nvdaJournal: await journal('NVDA'),
      virtual: (await db.virtualPortfolio.findFirstOrThrow({ where: { positions: { some: {} } } })).id,
      aaplJournal: await journal('AAPL'),
      template: (await db.journalTemplate.findFirstOrThrow()).id,
      allWeather: (await db.traitGroup.findFirstOrThrow({ where: { preset: 'allWeather' } })).id,
      assetClass: (await db.traitGroup.findFirstOrThrow({ where: { preset: 'assetClass' } })).id,
      equityStyle: (await db.traitGroup.findFirstOrThrow({ where: { preset: 'equityStyle' } })).id,
      samsung: (await db.holding.findFirstOrThrow({ where: { asset: { symbol: '005930' } } })).id,
      home: pid('부동산'),
      growth: pid('성장'),
      accountStrategy: pid('올웨더'),
      apartment: (await db.holding.findFirstOrThrow({ where: { asset: { type: 'REAL_ESTATE', name: { startsWith: '한빛마을래미안' } } } })).id,
      house: (await db.holding.findFirstOrThrow({ where: { asset: { type: 'REAL_ESTATE', name: '대치동 958 단독' } } })).id,
      buffett: (await db.sage.findFirstOrThrow({ where: { preset: 'buffett' } })).id,
      book: (await db.book.findFirstOrThrow()).id,
      aiChat: '',
      aiSkillChat: '',
      aiBriefing: '',
    };

    console.log(`starting the demo server on ${BASE}`);
    server = spawn(process.execPath, ['--require', path.join(__dirname, 'fake-market.cjs'), path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT)], {
      cwd: ROOT,
      env: { ...env, NODE_ENV: 'production' },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    await waitForServer(server);

    console.log('preparing an AI advisor conversation');
    const chat = await fetch(`${BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `ppfp_session=${token}` },
      body: JSON.stringify({ text: '내 포트폴리오를 점검해 줘. 지금 가장 신경 써야 할 점 3가지는?', path: '/dashboard' }),
    });
    const events = await chat.text();
    if (!events.includes('"t":"done"')) throw new Error(`AI conversation failed:\n${events}`);
    ids.aiChat = (await db.aiConversation.findFirstOrThrow()).id;
    // A research answer that reads the analyst's skill first
    const research = await fetch(`${BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `ppfp_session=${token}` },
      body: JSON.stringify({ agent: 'RESEARCH', text: '엔비디아(NVDA)의 경쟁력과 해자를 점검해 줘', path: '/market?s=NVDA' }),
    });
    if (!(await research.text()).includes('"t":"done"')) throw new Error('AI research conversation failed');
    ids.aiSkillChat = (await db.aiConversation.findFirstOrThrow({ where: { agent: 'RESEARCH' } })).id;
    // The scheduled-job endpoint sends the morning briefing that is due (from midnight, whatever the time now)
    await db.aiSettings.updateMany({ data: { briefingHour: 0 } });
    const cron = await fetch(`${BASE}/api/cron/alerts`, { method: 'POST', headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
    if (!cron.ok) throw new Error(`cron failed: ${await cron.text()}`);
    // The server's own timer may have claimed it first: wait for whichever ran
    for (let i = 0; i < 120 && !ids.aiBriefing; i++) {
      const n = await db.notification.findFirst({ where: { kind: 'BRIEFING', aiConversationId: { not: null } } });
      if (n) ids.aiBriefing = n.aiConversationId!;
      else await sleep(500);
    }
    if (!ids.aiBriefing) throw new Error('The morning briefing did not arrive.');
    // Read already, so the unread badge on every screen stays as before
    await db.notification.updateMany({ where: { kind: 'BRIEFING' }, data: { readAt: new Date() } });
    await db.aiSettings.updateMany({ data: { briefingHour: 7 } });
    await db.$disconnect();

    mkdirSync(OUT, { recursive: true });
    chrome = await launchChrome();
    console.log('capturing');
    for (const shot of SHOTS.filter((x) => !ONLY || ONLY.includes(x.file))) await capture(chrome.cdp, shot, ids, token);

  } finally {
    // Every step runs even if an earlier one fails, so nothing is left behind
    const quietly = async (what: string, f: () => unknown) => {
      try {
        await f();
      } catch (e) {
        console.error(`cleanup: ${what}: ${e instanceof Error ? e.message : e}`);
      }
    };
    if (chrome) {
      const { cdp, proc, dir } = chrome;
      await quietly('chrome', async () => {
        cdp.close();
        const exited = new Promise((r) => proc.once('exit', r));
        proc.kill();
        await Promise.race([exited, sleep(5000)]);
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      });
    }
    if (server) {
      const proc = server;
      await quietly('server', async () => {
        const exited = new Promise((r) => proc.once('exit', r));
        proc.kill();
        await Promise.race([exited, sleep(5000)]);
      });
    }
    await quietly('database', () => admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    await quietly('disconnect', () => admin.$disconnect());
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

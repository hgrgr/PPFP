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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'docs/images');
const PORT = Number(process.env.DOCS_PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;
const ONLY = process.env.DOCS_ONLY?.split(',').filter(Boolean);
const CHROME =
  process.env.CHROME_PATH ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));

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
  apartment: string;
  aapl: string;
  nvdaJournal: string;
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
  { file: 'dashboard-tables', path: () => '/dashboard', wait: 2200, width: 1680, clip: [{ sel: 'h2', text: '비중 변화', closest: 'section' }, { sel: 'h2', text: '보유 종목', closest: 'section' }] },
  { file: 'dashboard-dark', path: () => '/dashboard', wait: 2200, dark: true },
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
    marks: [{ sel: '.apt-picker label.field' }, { sel: '.apt-picked label', text: '실거래가 단지' }, { sel: '.apt-picked label', text: '전용면적' }, { sel: 'input[name="name"]', closest: 'label' }],
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
  { file: 'transactions', path: () => '/transactions', wait: 1200, marks: [{ sel: 'form[method="get"]' }] },
  {
    file: 'import-broker',
    path: () => '/import',
    wait: 2500,
    clip: [{ sel: '.page-head' }, card('한국투자 데모 계좌')],
    marks: [{ sel: 'input', text: '카카오 선택' }, { sel: 'select', text: '카카오 넣을 포트폴리오' }, { sel: 'button', text: '가져오기', within: card('한국투자 데모 계좌') }],
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

async function launchChrome(): Promise<{ proc: ChildProcess; cdp: Cdp; dir: string }> {
  if (!CHROME) throw new Error('Chrome not found: set CHROME_PATH.');
  const dir = mkdtempSync(path.join(tmpdir(), 'ppfp-docs-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--force-color-profile=srgb', '--lang=ko-KR', 'about:blank'], { stdio: 'ignore' });
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
    const loaded = cdp.once('Page.loadEventFired', sessionId);
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
    if (shot.clip) {
      const full = await run('Math.ceil(document.documentElement.scrollHeight)');
      await s('Emulation.setDeviceMetricsOverride', { width, height: Math.min(full, 6000), deviceScaleFactor: scale, mobile: !!shot.mobile });
      // Charts that just came into view lay out and animate
      await sleep(2000);
      await run(PAGE_HELPERS);
    }
    if (shot.marks?.length) await run(`__docs.mark(${JSON.stringify(shot.marks)})`);
    const clip = shot.clip ? { ...(await run(`__docs.box(${JSON.stringify(shot.clip)}, ${shot.pad ?? 28})`)), scale: 1 } : undefined;
    const { data } = await s('Page.captureScreenshot', { format: 'webp', quality: 92, captureBeyondViewport: !!clip, ...(clip ? { clip } : {}) });
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
      aaplJournal: await journal('AAPL'),
      template: (await db.journalTemplate.findFirstOrThrow()).id,
      allWeather: (await db.traitGroup.findFirstOrThrow({ where: { preset: 'allWeather' } })).id,
      assetClass: (await db.traitGroup.findFirstOrThrow({ where: { preset: 'assetClass' } })).id,
      equityStyle: (await db.traitGroup.findFirstOrThrow({ where: { preset: 'equityStyle' } })).id,
      samsung: (await db.holding.findFirstOrThrow({ where: { asset: { symbol: '005930' } } })).id,
      home: pid('부동산'),
      apartment: (await db.holding.findFirstOrThrow({ where: { asset: { type: 'REAL_ESTATE' } } })).id,
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

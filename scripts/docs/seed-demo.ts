/**
 * Fills an empty database with the fictional demo account used for the user
 * guide's screenshots: a portfolio tree, a year of stock trades, an imported
 * brokerage account, a replayed 업비트 history, a manual deposit, a few
 * trade journal entries, asset trait groups, price alerts and target weights,
 * and investment notes (memos, a book summary, investor profiles).
 *
 * Run by scripts/docs/capture.ts against its own throwaway database; never
 * against real data. Broker calls go to the fake servers in fake-market.cjs.
 * Prints the session token for the demo user on the last line.
 */
import fake from './fake-market.cjs';
import { Dec } from '@/domain/decimal';
import { prisma } from '@/server/db';
import { newToken, sha256 } from '@/server/crypto';
import { storeFx } from '@/server/market';
import { createManualAsset, ensureListedAsset } from '@/server/services/assets';
import { setServiceKey } from '@/server/services/api-keys';
import { saveConnection, sourceKey } from '@/server/services/brokers';
import { syncExchangeHistory } from '@/server/services/exchange-sync';
import { importHoldings } from '@/server/services/imports';
import { runDailyForUser } from '@/server/services/jobs';
import { saveJournal, saveTemplate } from '@/server/services/journal';
import { addLink, addPresetSage, createBook, createNote, saveBook } from '@/server/services/knowledge';
import { checkDrift, checkPriceAlerts, createAlert, savePortfolioTargets } from '@/server/services/alerts';
import { applyExampleTargets, createGroupFromPreset, saveGroup, setAssetTraits, trackWatchItem } from '@/server/services/traits';
import { createPortfolio } from '@/server/services/portfolios';
import { checkRealEstateAlerts, createReAlert } from '@/server/services/real-estate-alerts';
import { SKILL_STARTERS } from '@/domain/ai-skills';
import { BUILTIN_FORMATS } from '@/domain/journal';
import { recordBuy, recordCash, recordSell, recordValuation } from '@/server/services/trading';

const D = 86_400_000;
const H = 3_600_000;

/** KST calendar date n days ago, as YYYYMMDD. */
const ago = (n: number) => new Date(Date.now() + 9 * H - n * D).toISOString().slice(0, 10).replace(/-/g, '');
const dash = (ymd: string) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

/** USD/KRW on a day: a slow wave ending near today's rate. */
const fxOn = (ms: number) => fake.USDKRW * Math.exp(0.035 * (fake.smooth('fx-long', ms / (75 * D)) - fake.smooth('fx-long', Date.now() / (75 * D))));

/** A trade during the session nearest to `n` days ago, at that day's close. */
function sessionTrade(symbol: string, n: number) {
  const m = fake.stockMeta(symbol)!;
  const day = fake.sessionOnOrBefore(m.mkt, ago(n), Infinity);
  const bar = fake.dayBar(m, day);
  const close = Date.parse(`${dash(day)}T${m.mkt === 'KR' ? '15:20:00+09:00' : '15:50:00-04:00'}`);
  return { price: String(bar.c), at: new Date(close), fx: fxOn(close).toFixed(2) };
}

async function main() {
  if (await prisma.user.count()) throw new Error('The demo database is not empty; capture.ts recreates it for every run.');
  const user = await prisma.user.create({ data: { email: 'demo@ppfp.example', name: '데모', passwordHash: 'disabled' } });
  const uid = user.id;

  const kis = await saveConnection(uid, { broker: 'KIS', label: '한국투자 데모 계좌', appKey: 'DEMO-APP-KEY', appSecret: 'DEMO-APP-SECRET', accountNo: '12345678-01' });
  const upbit = await saveConnection(uid, { broker: 'UPBIT', label: '업비트 데모', appKey: 'DEMO-ACCESS-KEY', appSecret: 'DEMO-SECRET-KEY' });
  // Linked but never synced, so the import page shows the first-sync form too
  await saveConnection(uid, { broker: 'BITHUMB', label: '빗썸 (새로 연결)', appKey: 'DEMO-BITHUMB-KEY', appSecret: 'DEMO-BITHUMB-SECRET' });

  const root = await createPortfolio(uid, { name: '순자산', color: '#1F2A44', description: '모든 계좌와 자산을 모은 맨 위 포트폴리오' });
  const kr = await createPortfolio(uid, { name: '국내 주식', color: '#2F4FC9', lotMethod: 'FIFO', parentId: root.id, allocation: '1', description: '한국투자 계좌' });
  const us = await createPortfolio(uid, { name: '미국 주식', color: '#0E9F6E', lotMethod: 'HIFO', parentId: root.id, allocation: '1', description: '미국 성장주와 ETF' });
  const coin = await createPortfolio(uid, { name: '코인', color: '#E8A200', parentId: root.id, allocation: '1', description: '업비트 거래내역을 그대로 재현' });
  const cash = await createPortfolio(uid, { name: '예금 · 현금', color: '#7C3AED', parentId: root.id, allocation: '1' });

  for (let n = 430; n >= 0; n--) {
    const day = ago(n);
    await storeFx('USDKRW', dash(day), Dec.of(fxOn(Date.parse(`${dash(day)}T12:00:00+09:00`)).toFixed(2)));
  }

  // 국내 주식: the brokerage balance imported a year ago, then dividends.
  const kisConn = await prisma.brokerConnection.findUniqueOrThrow({ where: { id: kis.id } });
  await importHoldings(uid, {
    sourceKey: sourceKey(kisConn),
    sourceLabel: kisConn.label,
    tradeAt: new Date(`${dash(ago(330))}T09:00:00+09:00`),
    rows: fake.KIS_ACCOUNT.filter(([sym]) => sym !== '035720').map(([sym, qty, avg]) => ({
      symbol: sym, name: fake.KR[sym][0], currency: 'KRW', market: 'KRX', qty: String(qty), price: String(avg), portfolioId: kr.id,
    })),
  });
  const holdingOf = async (portfolioId: string, symbol: string) =>
    prisma.holding.findFirstOrThrow({ where: { portfolioId, asset: { userId: uid, symbol } } });
  const samsung = await holdingOf(kr.id, '005930');
  const kodex = await holdingOf(kr.id, '069500');
  for (const n of [140, 50]) {
    await recordCash(uid, { portfolioId: kr.id, type: 'DIVIDEND', amount: '18050', currency: 'KRW', holdingId: samsung.id, tradeAt: new Date(`${dash(ago(n))}T08:00:00+09:00`), memo: '분기 배당 361원 × 50주' });
  }
  await recordCash(uid, { portfolioId: kr.id, type: 'DIVIDEND', amount: '30000', currency: 'KRW', holdingId: kodex.id, tradeAt: new Date(`${dash(ago(70))}T08:00:00+09:00`), memo: '분배금' });

  // 미국 주식: cash in dollars, several lots per stock, one partial sale.
  for (const [n, amount] of [[365, '20000'], [210, '15000']] as const) {
    const at = new Date(`${dash(ago(n))}T10:00:00+09:00`);
    await recordCash(uid, { portfolioId: us.id, type: 'DEPOSIT', amount, currency: 'USD', fxRate: fxOn(at.getTime()).toFixed(2), tradeAt: at, memo: '달러 환전 입금' });
  }
  const usAssets = {
    AAPL: await ensureListedAsset(uid, 'AAPL', { name: '애플', currency: 'USD', market: 'NASDAQ' }),
    NVDA: await ensureListedAsset(uid, 'NVDA', { name: '엔비디아', currency: 'USD', market: 'NASDAQ' }),
    VOO: await ensureListedAsset(uid, 'VOO', { name: '뱅가드 S&P 500 ETF', currency: 'USD', market: 'AMEX' }),
  };
  const buys: [keyof typeof usAssets, number, string][] = [
    ['AAPL', 350, '20'], ['VOO', 340, '12'], ['NVDA', 300, '40'], ['AAPL', 250, '15'], ['NVDA', 150, '20'], ['AAPL', 120, '10'], ['VOO', 60, '5'],
  ];
  for (const [sym, n, qty] of buys) {
    const t = sessionTrade(sym, n);
    await recordBuy(uid, { portfolioId: us.id, assetId: usAssets[sym].id, tradeAt: t.at, qty, price: t.price, fee: '1.5', fxRate: t.fx, fromCash: true });
  }
  const nvda = await holdingOf(us.id, 'NVDA');
  const sale = sessionTrade('NVDA', 45);
  await recordSell(uid, { holdingId: nvda.id, tradeAt: sale.at, qty: '25', price: sale.price, fee: '1.5', fxRate: sale.fx, method: 'HIFO', toCash: true, memo: '비중 조절' });
  const aapl = await holdingOf(us.id, 'AAPL');
  const voo = await holdingOf(us.id, 'VOO');
  for (const n of [100, 10]) {
    const at = new Date(`${dash(ago(n))}T22:00:00+09:00`);
    await recordCash(uid, { portfolioId: us.id, type: 'DIVIDEND', amount: '11.70', currency: 'USD', holdingId: aapl.id, fxRate: fxOn(at.getTime()).toFixed(2), tradeAt: at });
    await recordCash(uid, { portfolioId: us.id, type: 'DIVIDEND', amount: '30.60', currency: 'USD', holdingId: voo.id, fxRate: fxOn(at.getTime()).toFixed(2), tradeAt: at });
  }

  // 예금 · 현금: a manual asset revalued as interest accrues.
  const deposit = await createManualAsset(uid, { type: 'CASH', name: '정기예금 (12개월)', currency: 'KRW' });
  await recordBuy(uid, { portfolioId: cash.id, assetId: deposit.id, tradeAt: new Date(`${dash(ago(200))}T11:00:00+09:00`), qty: '1', price: '10000000', fromCash: false, memo: '연 3.3%' });
  const depositHolding = await prisma.holding.findFirstOrThrow({ where: { portfolioId: cash.id, assetId: deposit.id } });
  await recordValuation(uid, { holdingId: depositHolding.id, price: '10180000', tradeAt: new Date(`${dash(ago(20))}T09:00:00+09:00`), memo: '경과 이자 반영' });

  // 부동산: an apartment linked to its 실거래가 complex (fake-realestate.cjs). Its own top-level
  // portfolio, so the 순자산 screens stay as they are.
  const home = await createPortfolio(uid, { name: '부동산', color: '#F08A3E', description: '실거주 아파트' });
  const apt = await createManualAsset(uid, {
    type: 'REAL_ESTATE',
    name: '한빛마을래미안 34평형',
    currency: 'KRW',
    meta: { kind: 'apartment', address: '서울 강남구 대치동 508', roadAddress: '서울 강남구 삼성로 51', placeName: '한빛마을래미안', lat: 37.4949, lng: 127.0631, lawdCd: '11680', umdCd: '10600', umdNm: '대치동', aptNm: '한빛마을래미안', jibun: '508', aptSeq: '11680-9001', area: 84.97 },
  });
  await recordBuy(uid, { portfolioId: home.id, assetId: apt.id, tradeAt: new Date(`${dash(ago(400))}T14:00:00+09:00`), qty: '1', price: '2780000000', tax: '91740000', fromCash: false, memo: '취득세 포함' });
  // 부동산 알림: the first check records what is there; pretend it ran before the latest sale,
  // one registration and the 토지거래허가구역 designation, so the next check reports them.
  const watch = await createReAlert(uid, { assetId: apt.id, events: ['TRADE', 'REGISTERED', 'CANCELLED', 'ZONE'], scope: 'COMPLEX', note: '실거주 단지' });
  await createReAlert(uid, { assetId: apt.id, events: ['TRADE'], scope: 'DONG', minEok: '25', newHighOnly: true, note: '대치동 신고가' });
  const seen = { ...((await prisma.realEstateAlert.findUniqueOrThrow({ where: { id: watch.id } })).seen as Record<string, string>) };
  const byDate = Object.keys(seen).sort((a, b) => b.split('|')[1].localeCompare(a.split('|')[1]));
  delete seen[byDate[0]];
  const registered = byDate.find((k) => seen[k] === 'R');
  if (registered) seen[registered] = '';
  await prisma.realEstateAlert.update({ where: { id: watch.id }, data: { seen, zone: false } });
  await checkRealEstateAlerts(uid);

  // 코인: the 업비트 history replayed from a year ago.
  await syncExchangeHistory(uid, upbit.id, { portfolioId: coin.id, since: new Date(Date.now() - 365 * D) });

  await prisma.watchItem.createMany({
    data: [
      { userId: uid, symbol: '035420', name: 'NAVER', currency: 'KRW', market: 'KRX' },
      { userId: uid, symbol: 'TSLA', name: '테슬라', currency: 'USD', market: 'NASDAQ' },
      { userId: uid, symbol: 'KRW-DOGE', name: '도지코인', currency: 'KRW', market: 'CRYPTO' },
    ],
  });

  await runDailyForUser(uid, { fullRebuild: true });
  await seedJournals(uid);
  await seedTraits(uid);
  await seedAlerts(uid, { root: root.id, us: us.id });
  await seedKnowledge(uid);

  const token = newToken();
  await prisma.session.create({ data: { id: sha256(token), userId: uid, expiresAt: new Date(Date.now() + D) } });
  const cashLeft = await prisma.cashBalance.findMany({ where: { portfolio: { userId: uid } }, include: { portfolio: { select: { name: true } } } });
  console.error('[seed] cash', cashLeft.map((c) => `${c.portfolio.name} ${c.currency} ${c.amount}`).join(' | '));
  console.log(token);
}

// ---------------------------------------------------------------- trade journal
const h2 = (text: string) => ({ type: 'heading', props: { level: 2 }, content: text });
const para = (text: string) => ({ type: 'paragraph', content: text });
const li = (text: string) => ({ type: 'bulletListItem', content: text });
const todo = (text: string, checked = false) => ({ type: 'checkListItem', props: { checked }, content: text });
const grid = (rows: string[][]) => ({ type: 'table', content: { type: 'tableContent', headerRows: 1, rows: rows.map((cells) => ({ cells })) } });
const formatOf = (id: string) => BUILTIN_FORMATS.find((f) => f.id === id)!;
const won = (v: number) => Math.round(v / 100) * 100;

async function seedJournals(uid: string) {
  const asset = (symbol: string) => prisma.asset.findFirstOrThrow({ where: { userId: uid, symbol } });
  const txnOf = (symbol: string, type: 'BUY' | 'SELL', nth = 0) =>
    prisma.transaction.findMany({ where: { type, holding: { asset: { userId: uid, symbol } } }, orderBy: { tradeAt: 'desc' } }).then((r) => r[nth]);
  const now = (symbol: string) => Number(sessionTrade(symbol, 0).price);
  const ymd = (d: Date) => new Date(d.getTime() + 9 * H).toISOString().slice(0, 10);

  const nvda = await asset('NVDA');
  const nvdaSale = (await txnOf('NVDA', 'SELL'))!;
  const sold = Number(nvdaSale.price);
  await saveJournal(uid, {
    assetId: nvda.id,
    title: '엔비디아 일부 매도 — 비중 조절',
    entryDate: ymd(nvdaSale.tradeAt),
    status: 'OPEN',
    targetPrice: (sold * 1.18).toFixed(2),
    basePrice: sold.toFixed(2),
    stopPrice: (sold * 0.85).toFixed(2),
    template: 'builtin:sell',
    fields: formatOf('builtin:sell').fields,
    values: { reason: '리밸런싱', followed: '예', emotion: '차분', score: '4' },
    txnIds: [nvdaSale.id],
    content: [
      h2('매도 사유'),
      para('미국 주식 포트폴리오에서 엔비디아 비중이 35%를 넘어 25주를 정리했습니다. 남은 물량은 목표가까지 들고 갑니다.'),
      {
        type: 'chart',
        props: { kind: 'bar', title: '포트폴리오 내 비중 (%)', data: '종목,매도 전,매도 후\n엔비디아,36,27\n애플,34,39\nS&P 500 ETF,30,34' },
      },
      h2('처음 계획과 비교'),
      grid([
        ['항목', '계획', '실제'],
        ['가격', '목표가 근처에서 일부 익절', `$${sold.toFixed(2)}에 25주`],
        ['비중', '30% 이하', '27%'],
      ]),
      h2('잘한 점'),
      li('정해 둔 비중 한도를 지켰습니다.'),
      h2('아쉬운 점'),
      li('실적 발표 직후 변동성이 커서 분할로 나눠 팔았으면 더 좋았습니다.'),
      h2('다음 매매에 바꿀 것'),
      todo('실적 발표 주간에는 3번에 나눠서 매도', true),
      todo('남은 물량 목표가 도달 시 다시 비중 점검'),
    ],
  });

  const aapl = await asset('AAPL');
  const aaplBuy = (await txnOf('AAPL', 'BUY'))!;
  const bought = Number(aaplBuy.price);
  await saveJournal(uid, {
    assetId: aapl.id,
    title: '애플 추가 매수 계획',
    entryDate: ymd(aaplBuy.tradeAt),
    targetPrice: (bought * 1.25).toFixed(2),
    basePrice: bought.toFixed(2),
    stopPrice: (bought * 0.9).toFixed(2),
    targetDate: ymd(new Date(Date.now() + 120 * D)),
    template: 'builtin:buy',
    fields: formatOf('builtin:buy').fields,
    values: { entry: '추가 매수(물타기·불타기)', horizon: '중기 (몇 달)', weight: '35', conviction: '4' },
    txnIds: [aaplBuy.id],
    content: [
      h2('매수 근거'),
      li('펀더멘털: 서비스 매출 비중이 꾸준히 늘어 이익률이 좋아지는 중'),
      li('차트·수급: 200일선 위에서 눌림 후 반등'),
      li('촉매(이벤트·일정): 가을 신제품 발표'),
      h2('차트'),
      { type: 'stockChart', props: { symbol: '' } },
      h2('시나리오'),
      grid([
        ['시나리오', '예상 가격', '대응'],
        ['좋을 때', `$${(bought * 1.25).toFixed(0)}`, '목표가에서 절반 익절'],
        ['보통', `$${(bought * 1.08).toFixed(0)}`, '보유, 분기 실적 확인'],
        ['나쁠 때', `$${(bought * 0.9).toFixed(0)}`, '손절가에서 전량 정리'],
      ]),
      h2('매수 전 체크리스트'),
      todo('실적 발표일·배당락일 확인', true),
      todo('포트폴리오 비중 한도 안인지 확인', true),
      todo('손절가를 정하고 기록', true),
    ],
  });

  const samsung = await asset('005930');
  const sNow = now('005930');
  await saveJournal(uid, {
    assetId: samsung.id,
    title: '삼성전자 장기 보유 점검',
    entryDate: ymd(new Date(Date.now() - 30 * D)),
    targetPrice: String(won(sNow * 1.3)),
    basePrice: String(won(sNow * 0.97)),
    template: 'builtin:thesis',
    fields: formatOf('builtin:thesis').fields,
    values: { horizon: '장기 (1년 이상)', fair: String(won(sNow * 1.25)), review: '분기', conviction: '3' },
    txnIds: [],
    content: [
      { type: 'quote', content: '메모리 업황 회복과 파운드리 수주가 함께 오면 재평가될 회사' },
      h2('핵심 지표'),
      grid([
        ['지표', '지금', '기대'],
        ['매출 성장률', '8%', '15%'],
        ['영업이익률', '11%', '18%'],
        ['PER', '14배', '12배'],
      ]),
      h2('생각이 틀렸다고 볼 조건'),
      li('두 분기 연속 메모리 가격 하락'),
      li('주요 고객사 수주 이탈'),
    ],
  });

  await saveTemplate(uid, {
    name: '실적 시즌 매매',
    description: '실적 발표 전후로 짧게 들어가는 매매',
    fields: [
      { key: 'earnings', label: '실적 발표일', type: 'date' },
      { key: 'consensus', label: '컨센서스 대비', type: 'select', options: ['상회', '부합', '하회'] },
      { key: 'ir', label: 'IR 자료', type: 'url' },
      { key: 'conviction', label: '확신도', type: 'rating' },
    ],
    content: [h2('발표 전 기대'), li(''), h2('발표 후 반응'), li(''), h2('대응'), todo('')],
  });
}

// ---------------------------------------------------------------- asset traits
async function seedTraits(uid: string) {
  await createGroupFromPreset(uid, 'allWeather', true);
  const cls = await createGroupFromPreset(uid, 'assetClass', true);
  await applyExampleTargets(uid, cls);
  const style = await createGroupFromPreset(uid, 'equityStyle', false);
  const role = await createGroupFromPreset(uid, 'role', false);
  await applyExampleTargets(uid, role);
  const traitsOf = async (groupId: string) => new Map((await prisma.trait.findMany({ where: { groupId } })).map((t) => [t.name, t]));
  const styles = await traitsOf(style);
  await saveGroup(uid, style, {
    name: '주식 스타일',
    cashTrait: '',
    traits: [...styles.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({ id: t.id, name: t.name, color: t.color, description: t.description ?? '', target: { 성장주: '40', 가치주: '30', 배당주: '20', 혼합: '10' }[t.name] ?? '' })),
  });
  const roles = await traitsOf(role);
  const tesla = await trackWatchItem(uid, 'TSLA');
  const bySymbol = async (symbol: string) => (await prisma.asset.findFirstOrThrow({ where: { userId: uid, symbol } })).id;
  const tag = async (symbol: string, groupId: string, names: string[], map: Map<string, { id: string }>) =>
    setAssetTraits(uid, symbol === 'TSLA' ? tesla : await bySymbol(symbol), groupId, names.map((n) => map.get(n)!.id));
  for (const [sym, st, ro] of [
    ['AAPL', '성장주', '핵심'],
    ['NVDA', '성장주', '위성'],
    ['VOO', '혼합', '핵심'],
    ['005930', '가치주', '핵심'],
    ['000660', '성장주', '위성'],
    ['069500', '혼합', '핵심'],
    ['TSLA', '성장주', '위성'],
  ] as const) {
    await tag(sym, style, [st], styles);
    await tag(sym, role, [ro], roles);
  }
  for (const sym of ['KRW-BTC', 'KRW-ETH', 'KRW-XRP', 'KRW-SOL']) {
    if (await prisma.asset.findFirst({ where: { userId: uid, symbol: sym } })) await tag(sym, role, ['위성'], roles);
  }
}

// ---------------------------------------------------------------- alerts
async function seedAlerts(uid: string, p: { root: string; us: string }) {
  const id = async (symbol: string) => (await prisma.asset.findFirstOrThrow({ where: { userId: uid, symbol } })).id;
  const now = (symbol: string) => Number(sessionTrade(symbol, 0).price);
  await createAlert(uid, { assetId: await id('005930'), price: String(won(now('005930') * 0.95)), note: '분할 매수 2차' });
  await createAlert(uid, { assetId: await id('TSLA'), price: (now('TSLA') * 0.9).toFixed(2), note: '관심종목 — 이 가격이면 첫 매수' });
  // Well below the price, so the first check fires it into the inbox whatever the time of day
  await createAlert(uid, { assetId: await id('VOO'), price: (now('VOO') * 0.95).toFixed(2), direction: 'ABOVE', note: '전고점 돌파 확인' });
  const children = await prisma.portfolioEdge.findMany({ where: { parentId: p.root }, include: { child: true } });
  const share: Record<string, string> = { '국내 주식': '25', '미국 주식': '45', 코인: '5', '예금 · 현금': '25' };
  await savePortfolioTargets(uid, p.root, { targets: Object.fromEntries(children.map((e) => [`P:${e.childId}`, share[e.child.name] ?? ''])), tolerance: '5', alert: true });
  await savePortfolioTargets(uid, p.us, { targets: { [await id('AAPL')]: '35', [await id('VOO')]: '35', [await id('NVDA')]: '20', CASH: '10' }, tolerance: '3', alert: true });
  await checkPriceAlerts(uid);
  await checkDrift(uid);
}

// ---------------------------------------------------------------- investment notes
async function seedKnowledge(uid: string) {
  for (const k of ['buffett', 'graham', 'lynch', 'bogle', 'dalio']) await addPresetSage(uid, k);
  const graham = await prisma.sage.findFirstOrThrow({ where: { userId: uid, preset: 'graham' } });
  const book = await createBook(uid, '현명한 투자자');
  await saveBook(uid, book, {
    title: '현명한 투자자',
    author: '벤저민 그레이엄',
    publisher: '국일증권경제연구소',
    publishedYear: '1949',
    status: 'DONE',
    rating: '5',
    startedAt: dash(ago(60)),
    finishedAt: dash(ago(30)),
    oneLine: '시장의 기분에 휘둘리지 말고, 안전마진을 두고 산다.',
    content: [
      { type: 'quote', content: '주식은 기업의 일부다. 미스터 마켓의 제안은 받아들일 수도, 무시할 수도 있다.' },
      h2('핵심 아이디어'),
      li('투자와 투기를 구분한다: 철저한 분석, 원금의 안전, 적절한 수익'),
      li('미스터 마켓: 시장 가격은 매일 바뀌는 제안일 뿐, 따를 의무가 없다'),
      li('안전마진: 내재가치보다 충분히 싸게 사서 판단 실수에 대비한다'),
      h2('내 투자에 적용할 점'),
      todo('매수 전에 일지에 내재가치 추정과 안전마진을 적는다', true),
      todo('급락 때 공포가 아니라 가격 대비 가치로 판단한다'),
    ],
  });
  const ref = { type: 'book' as const, id: book };
  await addLink(uid, ref, { type: 'sage', id: graham.id });
  for (const name of ['가치투자', '안전마진']) await addLink(uid, ref, { type: 'topic', id: (await prisma.topic.findFirstOrThrow({ where: { userId: uid, name } })).id });
  const samsung = await prisma.holding.findFirstOrThrow({ where: { asset: { userId: uid, symbol: '005930' } } });
  await createNote(uid, '반도체 업황 바닥 신호. PBR 1배 아래면 분할 매수 검토 #가치투자 #안전마진', `/holdings/${samsung.id}`);
  await createNote(uid, '비중이 커진 종목은 감정이 아니라 목표 비중표로 정리하기 #리스크_관리 #자산배분', '/dashboard');
  await createNote(uid, '린치: 내가 쓰는 제품의 회사부터 보기. 매일 쓰는 앱·결제 서비스 목록 만들어 보기 #성장투자', '/sages');
  // AI advisor: morning briefing on (the capture script triggers it), alerts analyzed by hand.
  // The journal coach answers with a ChatGPT model on a made-up key (fake-claude.cjs answers it).
  await setServiceKey(uid, 'openai', 'sk-docs-demo-openai-not-a-real-key');
  await prisma.aiSettings.create({
    data: { userId: uid, briefing: true, briefingHour: 7, briefingWeekdays: false, monthlyLimit: '20.00', agentModels: { COACH: { provider: 'openai', model: 'gpt-6.1-sol' } } },
  });
  // AI skills: a checklist the user wrote for the manager and research, and (for captures, where
  // the made-up catalog in fake-skills.cjs answers) one imported from the community
  const starter = SKILL_STARTERS[0];
  await prisma.aiSkill.create({ data: { userId: uid, name: starter.name, description: starter.description, instructions: starter.instructions, agents: starter.agents } });
  if (process.env.PPFP_FAKE_SKILLS === '1') {
    const sourceId = 'value-lab/investing-skills/moat-analysis';
    const description = "Judge how durable a company's competitive advantage is. Use when the user asks about a moat, pricing power, or whether a business can defend its returns.";
    await prisma.aiSkill.create({
      data: {
        userId: uid,
        name: 'moat-analysis',
        description,
        instructions: `# Moat Analysis\n\n${description}\n\n## Steps\n\n1. List the sources of advantage.\n2. Check returns on capital over 5-10 years.\n3. Name what could erode it.\n4. Rate the moat none / narrow / wide.`,
        agents: ['RESEARCH'],
        source: 'skills.sh',
        sourceId,
        sourcePath: 'skills/moat-analysis/SKILL.md',
        sourceUrl: `https://github.com/value-lab/investing-skills/blob/HEAD/skills/moat-analysis/SKILL.md`,
        license: 'MIT',
        installs: 8210,
      },
    });
  }
  // Goals, dated from today so the screens stay the same whenever they are taken
  const year = Number(dash(ago(0)).slice(0, 4));
  await prisma.goal.create({ data: { userId: uid, name: '은퇴 자금', target: '1000000000', targetDate: new Date(`${year + 20}-12-31`), monthly: '1500000' } });
  await prisma.goal.create({ data: { userId: uid, name: '주택 마련', target: '300000000', targetDate: new Date(`${year + 4}-06-30`), monthly: '3000000' } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

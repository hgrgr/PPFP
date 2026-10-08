/**
 * Fills an empty database with the fictional demo account used for the user
 * guide's screenshots: a portfolio tree, a year of stock trades, an imported
 * brokerage account, a replayed 업비트 history and a manual deposit.
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
import { saveConnection, sourceKey } from '@/server/services/brokers';
import { syncExchangeHistory } from '@/server/services/exchange-sync';
import { importHoldings } from '@/server/services/imports';
import { runDailyForUser } from '@/server/services/jobs';
import { createPortfolio } from '@/server/services/portfolios';
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

  const token = newToken();
  await prisma.session.create({ data: { id: sha256(token), userId: uid, expiresAt: new Date(Date.now() + D) } });
  const cashLeft = await prisma.cashBalance.findMany({ where: { portfolio: { userId: uid } }, include: { portfolio: { select: { name: true } } } });
  console.error('[seed] cash', cashLeft.map((c) => `${c.portfolio.name} ${c.currency} ${c.amount}`).join(' | '));
  console.log(token);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

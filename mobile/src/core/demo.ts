/**
 * Example data to look around with (and for the documentation screens): four portfolios,
 * stocks, coins, a deposit, an apartment with its mortgage, notes, a journal, a goal. Prices
 * are set by hand so it works offline; 시세 새로고침 replaces them with real ones.
 */
import { db, kstToday, newId, nowIso, setSetting } from './db';
import { recordDay } from './prices';
import { addAlert, addPortfolio, ensureAsset, recordTxn, saveGoal, saveJournal, saveLoan, saveNote, updateAsset } from './store';

const daysAgo = (n: number, time = '10:00') => {
  const d = new Date(Date.now() + 9 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10);
  return `${d}T${time}`;
};

export async function seedDemo() {
  const kr = await addPortfolio('국내 주식', 'FIFO');
  const us = await addPortfolio('미국 주식', 'FIFO');
  const coin = await addPortfolio('코인', 'AVERAGE');
  const home = await addPortfolio('집 · 대출', 'FIFO');
  await setSetting('usdkrw', { rate: '1385', at: nowIso(), source: '예시 값' });
  await setSetting('pricesAt', nowIso());

  const samsung = await ensureAsset({ type: 'KR_STOCK', symbol: '005930', name: '삼성전자', currency: 'KRW' });
  const kodex = await ensureAsset({ type: 'KR_STOCK', symbol: '069500', name: 'KODEX 200', currency: 'KRW' });
  const aapl = await ensureAsset({ type: 'US_STOCK', symbol: 'AAPL', name: '애플', currency: 'USD' });
  const voo = await ensureAsset({ type: 'US_STOCK', symbol: 'VOO', name: 'Vanguard S&P 500', currency: 'USD' });
  const btc = await ensureAsset({ type: 'CRYPTO', symbol: 'BTC', name: '비트코인', currency: 'KRW' });
  const eth = await ensureAsset({ type: 'CRYPTO', symbol: 'ETH', name: '이더리움', currency: 'KRW' });
  const deposit = await ensureAsset({ type: 'CASH', name: '정기예금 (3.2%)', currency: 'KRW', kind: 'TERM_DEPOSIT' });
  const apt = await ensureAsset({ type: 'REAL_ESTATE', name: '래미안 34평형', currency: 'KRW' });
  const loan = await ensureAsset({ type: 'LIABILITY', name: '주택담보대출', currency: 'KRW', kind: 'MORTGAGE' });

  const now = nowIso();
  for (const [a, p] of [[samsung, '78400'], [kodex, '41250'], [aapl, '236.4'], [voo, '598.2'], [btc, '152300000'], [eth, '5820000']] as const) {
    await updateAsset(a.id, { price: p, priceAt: now, priceSource: '예시 값' });
  }

  await recordTxn({ portfolioId: kr.id, type: 'DEPOSIT', localAt: daysAgo(300), amount: '20000000' });
  await recordTxn({ portfolioId: kr.id, type: 'BUY', assetId: samsung.id, localAt: daysAgo(290), qty: '120', price: '61200', fee: '1100' });
  await recordTxn({ portfolioId: kr.id, type: 'BUY', assetId: kodex.id, localAt: daysAgo(200), qty: '150', price: '35800', fee: '800' });
  await recordTxn({ portfolioId: kr.id, type: 'DIVIDEND', assetId: samsung.id, localAt: daysAgo(120), amount: '43320' });
  await recordTxn({ portfolioId: kr.id, type: 'SELL', assetId: samsung.id, localAt: daysAgo(40), qty: '20', price: '74800', fee: '300', tax: '2990' });

  await recordTxn({ portfolioId: us.id, type: 'DEPOSIT', localAt: daysAgo(280), amount: '12000', currency: 'USD', fxRate: '1352' });
  await recordTxn({ portfolioId: us.id, type: 'BUY', assetId: aapl.id, localAt: daysAgo(270), qty: '20', price: '198.5', fee: '1', fxRate: '1352' });
  await recordTxn({ portfolioId: us.id, type: 'BUY', assetId: voo.id, localAt: daysAgo(150), qty: '12', price: '512.3', fee: '1', fxRate: '1371' });
  await recordTxn({ portfolioId: us.id, type: 'DIVIDEND', assetId: voo.id, localAt: daysAgo(30), amount: '19.8', fxRate: '1380' });

  await recordTxn({ portfolioId: coin.id, type: 'BUY', assetId: btc.id, localAt: daysAgo(260), qty: '0.05', price: '98500000', fee: '2462', useCash: false });
  await recordTxn({ portfolioId: coin.id, type: 'BUY', assetId: eth.id, localAt: daysAgo(180), qty: '0.8', price: '4310000', fee: '1724', useCash: false });

  await recordTxn({ portfolioId: home.id, type: 'BUY', assetId: deposit.id, localAt: daysAgo(210), qty: '1', price: '30000000', useCash: false });
  await recordTxn({ portfolioId: home.id, type: 'BUY', assetId: apt.id, localAt: daysAgo(700), qty: '1', price: '1150000000', useCash: false });
  await recordTxn({ portfolioId: home.id, type: 'VALUATION', assetId: apt.id, localAt: daysAgo(10), price: '1320000000' });
  await recordTxn({ portfolioId: home.id, type: 'BUY', assetId: loan.id, localAt: daysAgo(700), qty: '1', price: '480000000', useCash: false });
  await recordTxn({ portfolioId: home.id, type: 'VALUATION', assetId: loan.id, localAt: daysAgo(5), price: '462300000' });
  await saveLoan({ assetId: loan.id, principal: 480_000_000, annualRate: 0.0395, startDate: daysAgo(700).slice(0, 10), months: 360, method: 'AMORTIZING', graceMonths: 0, paymentDay: 25 });

  await saveNote({ body: '#배당 VOO 분기 배당은 3·6·9·12월. 받은 배당은 다시 VOO로.', pinned: true });
  await saveNote({ body: '#리밸런싱 미국 주식 비중이 40%를 넘으면 국내 ETF로 옮긴다.' });
  await saveJournal({ assetId: samsung.id, title: '삼성전자 반도체 회복 베팅', status: 'OPEN', targetPrice: '90000', basePrice: '61200', stopPrice: '55000', dueDate: `${Number(kstToday().slice(0, 4)) + 1}-06-30`, body: '## 왜 사는가\nHBM 공급 확대와 메모리 가격 반등.\n\n## 틀렸다고 볼 신호\n2개 분기 연속 영업이익 감소.' });
  await saveGoal({ name: '은퇴 자금', target: '1500000000', targetDate: `${Number(kstToday().slice(0, 4)) + 18}-12-31`, monthly: '1500000' });
  await addAlert({ assetId: btc.id, direction: 'BELOW', price: '140000000' });
  await addAlert({ assetId: aapl.id, direction: 'ABOVE', price: '250' });

  // A made-up trend for the home chart: the last 90 days drifting up to today's total
  const rows = [];
  let v = 0.93;
  for (let i = 90; i >= 1; i--) {
    v *= 1 + 0.0009 + 0.006 * Math.sin(i * 1.7) * Math.cos(i * 0.37);
    rows.push({ date: daysAgo(i).slice(0, 10), v });
  }
  await recordDay();
  const today = await db.days.get(kstToday());
  if (today) {
    const scale = today.value / rows[rows.length - 1].v;
    await db.days.bulkPut(rows.map((r) => ({ date: r.date, value: Math.round(r.v * scale), invested: today.invested })));
  }
  await db.notices.add({ id: newId(), kind: 'INFO', title: '예시 데이터를 넣었습니다', body: '더보기 › 앱 정보 › 모두 지우기로 지울 수 있습니다.', at: nowIso(), read: false });
}

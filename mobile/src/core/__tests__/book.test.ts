import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Dec } from '@/domain/decimal';
import { mergeByAsset, replayBook } from '../book';
import type { Asset, Portfolio, Txn } from '../types';

const P: Portfolio = { id: 'p1', name: '주식', lotMethod: 'FIFO', archived: false, createdAt: '2026-01-01T00:00:00Z' };
const asset = (id: string, o: Partial<Asset> = {}): Asset => ({ id, type: 'KR_STOCK', symbol: id, name: id, currency: 'KRW', price: null, priceAt: null, priceSource: null, createdAt: '2026-01-01T00:00:00Z', ...o });
let n = 0;
const txn = (o: Partial<Txn>): Txn => ({
  id: `t${++n}`,
  portfolioId: 'p1',
  assetId: null,
  type: 'DEPOSIT',
  tradeAt: '2026-01-02T00:00:00Z',
  qty: null,
  price: null,
  amount: null,
  fee: '0',
  tax: '0',
  currency: 'KRW',
  fxRate: null,
  useCash: true,
  ratio: null,
  lotMethod: null,
  memo: '',
  createdAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`,
  ...o,
});

describe('replayBook', () => {
  it('buys from cash, values at the market price and keeps the deposit as invested', () => {
    const a = asset('005930', { price: '80000' });
    const txns = [txn({ type: 'DEPOSIT', amount: '1000000' }), txn({ type: 'BUY', assetId: a.id, qty: '10', price: '70000', fee: '1000', tradeAt: '2026-01-03T00:00:00Z' })];
    const b = replayBook([P], [a], txns, Dec.of('1400'));
    assert.equal(b.investedKrw.toString(), '1000000');
    assert.equal(b.cashKrw.toString(), '299000');
    assert.equal(b.holdings[0].qty.toString(), '10');
    assert.equal(b.holdings[0].avgCost.toString(), '70100');
    assert.equal(b.holdings[0].valueKrw.toString(), '800000');
    assert.equal(b.holdings[0].pnlKrw.toString(), '99000');
    assert.equal(b.valueKrw.toString(), '1099000');
  });

  it('sells FIFO, realizes the profit and returns proceeds to cash', () => {
    const a = asset('A1');
    const txns = [
      txn({ type: 'BUY', assetId: a.id, qty: '10', price: '100', useCash: false, tradeAt: '2026-01-02T00:00:00Z' }),
      txn({ type: 'BUY', assetId: a.id, qty: '10', price: '200', useCash: false, tradeAt: '2026-01-03T00:00:00Z' }),
      txn({ type: 'SELL', assetId: a.id, qty: '15', price: '300', fee: '15', tradeAt: '2026-01-04T00:00:00Z' }),
    ];
    const b = replayBook([P], [a], txns, Dec.ONE);
    assert.equal(b.realized.length, 1);
    // cost 10*100 + 5*200 = 2000, proceeds 4500 - 15
    assert.equal(b.realized[0].pnl.toString(), '2485');
    assert.equal(b.cashKrw.toString(), '4485');
    assert.equal(b.holdings[0].qty.toString(), '5');
    assert.equal(b.investedKrw.toString(), '3000');
  });

  it('reports a sale larger than the holding instead of failing the whole book', () => {
    const a = asset('A2');
    const b = replayBook([P], [a], [txn({ type: 'BUY', assetId: a.id, qty: '1', price: '10' }), txn({ type: 'SELL', assetId: a.id, qty: '2', price: '10', tradeAt: '2026-01-05T00:00:00Z' })], Dec.ONE);
    assert.equal(b.problems.length, 1);
    assert.match(b.problems[0].message, /보유 수량/);
  });

  it('converts USD holdings at today rate and lots at their own rate', () => {
    const a = asset('AAPL', { type: 'US_STOCK', currency: 'USD', price: '200' });
    const b = replayBook([P], [a], [txn({ type: 'BUY', assetId: a.id, qty: '2', price: '150', currency: 'USD', fxRate: '1300', useCash: false })], Dec.of('1400'));
    assert.equal(b.holdings[0].costKrw.toString(), '390000');
    assert.equal(b.holdings[0].valueKrw.toString(), '560000');
    assert.equal(b.investedKrw.toString(), '390000');
  });

  it('counts a liability against the total and in liabilities', () => {
    const home = asset('home', { type: 'REAL_ESTATE', symbol: null, name: '아파트' });
    const loan = asset('loan', { type: 'LIABILITY', symbol: null, name: '주담대' });
    const txns = [
      txn({ type: 'BUY', assetId: home.id, qty: '1', price: '900000000', useCash: false }),
      txn({ type: 'BUY', assetId: loan.id, qty: '1', price: '300000000', useCash: false }),
      txn({ type: 'VALUATION', assetId: home.id, price: '1000000000', tradeAt: '2026-02-01T00:00:00Z' }),
    ];
    const b = replayBook([P], [home, loan], txns, Dec.ONE);
    assert.equal(b.valueKrw.toString(), '700000000');
    assert.equal(b.liabilitiesKrw.toString(), '300000000');
    assert.equal(b.assetsKrw.toString(), '1000000000');
    assert.equal(b.investedKrw.toString(), '600000000');
  });

  it('applies a split and records dividends as income', () => {
    const a = asset('A3', { price: '50' });
    const txns = [
      txn({ type: 'BUY', assetId: a.id, qty: '10', price: '100', useCash: false }),
      txn({ type: 'SPLIT', assetId: a.id, ratio: '2', tradeAt: '2026-01-05T00:00:00Z' }),
      txn({ type: 'DIVIDEND', assetId: a.id, amount: '300', tradeAt: '2026-01-06T00:00:00Z' }),
    ];
    const b = replayBook([P], [a], txns, Dec.ONE);
    assert.equal(b.holdings[0].qty.toString(), '20');
    assert.equal(b.holdings[0].avgCost.toString(), '50');
    assert.equal(b.income[0].amountKrw.toString(), '300');
    assert.equal(b.cashKrw.toString(), '300');
  });

  it('merges one asset held in two portfolios', () => {
    const P2 = { ...P, id: 'p2', name: '연금' };
    const a = asset('A4', { price: '10' });
    const b = replayBook([P, P2], [a], [txn({ type: 'BUY', assetId: a.id, qty: '1', price: '10', useCash: false }), txn({ portfolioId: 'p2', type: 'BUY', assetId: a.id, qty: '2', price: '10', useCash: false })], Dec.ONE);
    const m = mergeByAsset(b.holdings);
    assert.equal(m.length, 1);
    assert.equal(m[0].qty.toString(), '3');
    assert.deepEqual(m[0].portfolios.sort(), ['p1', 'p2']);
  });
});

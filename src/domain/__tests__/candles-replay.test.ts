import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rollUp, type Candle } from '../candles';
import { coinDelta, krwDelta, openingBalances, sortEvents, type ExchangeEvent } from '../exchange-replay';
import { coinOf, cryptoSymbol, isCryptoSymbol } from '../broker-format';

const bar = (time: string, o: number, h: number, l: number, c: number, v: number): Candle => ({ time, open: String(o), high: String(h), low: String(l), close: String(c), volume: String(v) });

describe('rollUp', () => {
  it('builds 5-minute bars from 1-minute bars on clock boundaries', () => {
    // 09:03..09:07 KST
    const ones = [3, 4, 5, 6, 7].map((m, i) => bar(`2026-10-07T00:0${m}:00.000Z`, 100 + i, 105 + i, 95 + i, 101 + i, 10));
    const fives = rollUp(ones, '5m', 'Asia/Seoul');
    assert.deepEqual(
      fives.map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume]),
      [
        ['2026-10-07T00:00:00.000Z', '100', '106', '95', '102', '20'],
        ['2026-10-07T00:05:00.000Z', '102', '109', '97', '105', '30'],
      ],
    );
  });

  it('builds 4-hour bars from hourly ones and weeks from days', () => {
    const hours = [9, 10, 11, 12, 13, 14].map((h) => bar(`2026-10-07T${String(h - 9).padStart(2, '0')}:00:00.000Z`, h, h + 1, h - 1, h, 1));
    assert.deepEqual(
      rollUp(hours, '240m', 'Asia/Seoul').map((c) => [c.time, c.open, c.close, c.volume]),
      [
        ['2026-10-06T23:00:00.000Z', '9', '11', '3'], // 08:00-12:00 KST bucket holds 09, 10, 11
        ['2026-10-07T03:00:00.000Z', '12', '14', '3'],
      ],
    );
    // Mon 2026-10-05 .. Fri 10-09, then Mon 10-12 (NY dates)
    const days = ['05', '06', '07', '08', '09', '12'].map((d, i) => bar(`2026-10-${d}T04:00:00.000Z`, 10 + i, 20 + i, 5, 11 + i, 100));
    const weeks = rollUp(days, '1w', 'America/New_York');
    assert.deepEqual(weeks.map((w) => [w.open, w.high, w.close, w.volume]), [['10', '24', '15', '500'], ['15', '25', '16', '100']]);
  });

  it('keeps volume unknown when any bar lacks it', () => {
    const [c] = rollUp([bar('2026-10-07T00:00:00Z', 1, 1, 1, 1, 1), { ...bar('2026-10-07T00:01:00Z', 1, 1, 1, 1, 1), volume: null }], '5m', 'Asia/Seoul');
    assert.equal(c.volume, null);
  });
});

describe('crypto symbols', () => {
  it('stores coins as KRW market codes that cannot clash with tickers', () => {
    assert.equal(cryptoSymbol('btc'), 'KRW-BTC');
    assert.equal(coinOf('KRW-BTC'), 'BTC');
    assert.ok(isCryptoSymbol('KRW-BTC'));
    assert.ok(!isCryptoSymbol('BTC'));
    assert.ok(!isCryptoSymbol('005930'));
  });
});

describe('exchange replay', () => {
  const ev = (e: Partial<ExchangeEvent> & Pick<ExchangeEvent, 'kind' | 'at' | 'currency' | 'qty'>): ExchangeEvent => ({ id: e.at + e.kind, price: null, fee: '0', ...e });

  it('orders same-time events: money in, buys, sells, then withdrawals', () => {
    const t = '2026-01-01T00:00:00.000Z';
    const sorted = sortEvents([
      ev({ kind: 'WITHDRAW', at: t, currency: 'KRW', qty: '1' }),
      ev({ kind: 'SELL', at: t, currency: 'BTC', qty: '1', price: '1' }),
      ev({ kind: 'DEPOSIT', at: t, currency: 'KRW', qty: '1' }),
      ev({ kind: 'BUY', at: '2025-12-31T00:00:00.000Z', currency: 'BTC', qty: '1', price: '1' }),
    ]);
    assert.deepEqual(sorted.map((e) => e.kind), ['BUY', 'DEPOSIT', 'SELL', 'WITHDRAW']);
  });

  it('separates won and coin effects of trades, including fees taken in coins', () => {
    const buy = ev({ kind: 'BUY', at: 't', currency: 'BTC', qty: '0.5', price: '100000000', fee: '25000' });
    assert.equal(coinDelta(buy).toString(), '0.5');
    assert.equal(krwDelta(buy).toString(), '-50025000');
    const coinFeeBuy = { ...buy, fee: '0.0005', feeInCoin: true };
    assert.equal(coinDelta(coinFeeBuy).toString(), '0.4995');
    assert.equal(krwDelta(coinFeeBuy).toString(), '-50000000');
    const sell = ev({ kind: 'SELL', at: 't', currency: 'BTC', qty: '0.2', price: '110000000', fee: '11000' });
    assert.equal(coinDelta(sell).toString(), '-0.2');
    assert.equal(krwDelta(sell).toString(), '21989000');
  });

  it('works out the opening balances from today’s balances and the history since', () => {
    const events = [
      ev({ kind: 'DEPOSIT', at: '1', currency: 'KRW', qty: '1000000' }),
      ev({ kind: 'BUY', at: '2', currency: 'BTC', qty: '0.01', price: '50000000', fee: '250' }),
      ev({ kind: 'SELL', at: '3', currency: 'ETH', qty: '1', price: '3000000', fee: '1500' }),
      ev({ kind: 'WITHDRAW', at: '4', currency: 'KRW', qty: '100000', fee: '1000' }),
      ev({ kind: 'DEPOSIT', at: '5', currency: 'XRP', qty: '100', fee: '0' }),
      ev({ kind: 'WITHDRAW', at: '6', currency: 'XRP', qty: '30', fee: '1' }),
    ];
    const open = openingBalances(
      [
        { currency: 'KRW', qty: '3398250', avgPrice: null },
        { currency: 'BTC', qty: '0.03', avgPrice: '48000000' },
        { currency: 'XRP', qty: '69', avgPrice: '800' },
      ],
      events,
    );
    // KRW: 3,398,250 − 1,000,000 + 500,250 − 2,998,500 + 101,000 = 1,000
    assert.equal(open.get('KRW')!.toString(), '1000');
    assert.equal(open.get('BTC')!.toString(), '0.02');
    assert.equal(open.get('ETH')!.toString(), '1'); // sold out during the window, so held before it
    assert.equal(open.get('XRP')!.toString(), '0');
  });
});

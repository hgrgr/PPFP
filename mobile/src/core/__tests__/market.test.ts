import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { kisToken, parseFx, parseKisDomestic, parseKisOverseas, parseUpbitTicker } from '../market';
import { normalizeUrl } from '../server';
import { normalizeSymbol } from '../store';

describe('market parsers', () => {
  it('reads Upbit tickers', () => {
    const q = parseUpbitTicker([{ market: 'KRW-BTC', trade_price: 150000000, prev_closing_price: 148000000 }, { market: 'KRW-X', trade_price: 0 }]);
    assert.deepEqual(q, [{ symbol: 'KRW-BTC', price: '150000000', currency: 'KRW', prevClose: '148000000', source: '업비트' }]);
    assert.deepEqual(parseUpbitTicker({ error: 'x' }), []);
  });
  it('reads KIS domestic and overseas prices', () => {
    assert.equal(parseKisDomestic('005930', { output: { stck_prpr: '81,200', stck_sdpr: '80000' } })?.price, '81200');
    assert.equal(parseKisDomestic('005930', { output: { stck_prpr: '0' } }), null);
    assert.equal(parseKisOverseas('AAPL', { output: { last: '231.50', base: '229' } })?.currency, 'USD');
  });
  it('reads the dollar rate and refuses nonsense', () => {
    assert.equal(parseFx({ rates: { KRW: 1391.2 } }), 1391.2);
    assert.equal(parseFx({ rates: { KRW: 13.9 } }), null);
    assert.equal(parseFx(null), null);
  });
  it('reuses a KIS token until ten minutes before it expires', async () => {
    const cached = { token: 'tok', expiresAt: 1_000_000_000, appKey: 'k' };
    assert.equal(await kisToken({ appKey: 'k', secret: 's' }, cached, 1_000_000_000 - 11 * 60_000), cached);
  });
});

describe('inputs', () => {
  it('normalizes symbols per type', () => {
    assert.equal(normalizeSymbol('KR_STOCK', '5930'), '005930');
    assert.equal(normalizeSymbol('CRYPTO', 'btc'), 'KRW-BTC');
    assert.equal(normalizeSymbol('US_STOCK', 'brk.b'), 'BRK.B');
    assert.throws(() => normalizeSymbol('KR_STOCK', '삼성'));
  });
  it('accepts https and private http server addresses only', () => {
    assert.equal(normalizeUrl('ppfp.tail1234.ts.net/'), 'https://ppfp.tail1234.ts.net');
    assert.equal(normalizeUrl('http://100.101.102.103:3000'), 'http://100.101.102.103:3000');
    assert.equal(normalizeUrl('http://192.168.0.10:3000/'), 'http://192.168.0.10:3000');
    assert.throws(() => normalizeUrl('http://ppfp.example.com'));
    assert.throws(() => normalizeUrl(''));
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { absNum, addDays, cleanSymbol, fromYmd, isKrSymbol, krSymbol, num, usMarketCandidates, usMarketOf, ymd } from '../broker-format';

describe('broker number strings', () => {
  it('strips zero padding, signs and separators', () => {
    assert.equal(num('+000000000070000'), '70000');
    assert.equal(num('-00000000001234'), '-1234');
    assert.equal(num('000000012.5000'), '12.5000');
    assert.equal(num('1,234,567'), '1234567');
    assert.equal(num('.5'), '0.5');
    assert.equal(num(42), '42');
  });

  it('treats blanks and junk as zero', () => {
    assert.equal(num(''), '0');
    assert.equal(num(null), '0');
    assert.equal(num(undefined), '0');
    assert.equal(num('000000000000000'), '0');
    assert.equal(num('-0000'), '0');
    assert.equal(num('N/A'), '0');
  });

  it('absNum drops direction signs on prices', () => {
    assert.equal(absNum('-70000'), '70000');
    assert.equal(absNum('+187.5000'), '187.5000');
  });
});

describe('symbols', () => {
  it('recognises KRX codes, including alphanumeric ones', () => {
    assert.ok(isKrSymbol('005930'));
    assert.ok(isKrSymbol('0126Z0'));
    assert.ok(!isKrSymbol('AAPL'));
    assert.ok(!isKrSymbol('12345'));
  });

  it('strips broker prefixes from KRX codes', () => {
    assert.equal(krSymbol('A005930'), '005930');
    assert.equal(krSymbol(' J005930 '), '005930');
    assert.equal(krSymbol('005930'), '005930');
    assert.equal(krSymbol('AAPL'), null);
  });

  it('cleans tickers', () => {
    assert.equal(cleanSymbol(' brk.b '), 'BRK.B');
    assert.equal(cleanSymbol('삼성전자'), null);
  });
});

describe('US exchange codes', () => {
  it('maps each broker code to one market', () => {
    for (const c of ['NASD', 'NAS', 'ND', 'OQ', 'FN', '82', 'NASDAQ', '나스닥']) assert.equal(usMarketOf(c), 'NASDAQ', c);
    for (const c of ['NYSE', 'NYS', 'NY', 'N', 'FY', '81', '뉴욕']) assert.equal(usMarketOf(c), 'NYSE', c);
    for (const c of ['AMEX', 'AMS', 'NA', 'AX', 'FA', '아멕스']) assert.equal(usMarketOf(c), 'AMEX', c);
    assert.equal(usMarketOf('KOSPI'), null);
    assert.equal(usMarketOf(null), null);
  });

  it('tries the known market first', () => {
    assert.deepEqual(usMarketCandidates('NYS'), ['NYSE', 'NASDAQ', 'AMEX']);
    assert.deepEqual(usMarketCandidates(null), ['NASDAQ', 'NYSE', 'AMEX']);
  });
});

describe('dates', () => {
  it('converts between YYYYMMDD and ISO dates', () => {
    assert.equal(ymd('2026-10-07'), '20261007');
    assert.equal(fromYmd('20261007'), '2026-10-07');
    assert.equal(fromYmd(' 2026100 '), null);
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  });
});

describe('market helpers', () => {
  it('turns percent figures into fractions', async () => {
    const { pctToRate } = await import('../broker-format');
    assert.equal(pctToRate('+1.25'), '0.0125');
    assert.equal(pctToRate('-0.80%'), '-0.008');
    assert.equal(pctToRate('0.00'), '0');
    assert.equal(pctToRate(''), null);
    assert.equal(pctToRate(undefined), null);
  });

  it('applies up/down codes to unsigned figures', async () => {
    const { withSign, prevFromChange } = await import('../broker-format');
    assert.equal(withSign('1.50', '5'), '-1.50');
    assert.equal(withSign('1.50', '4'), '-1.50');
    assert.equal(withSign('-1.50', '2'), '1.50');
    assert.equal(withSign('0', '5'), '0');
    assert.equal(prevFromChange('71200', '-800'), '72000');
    assert.equal(prevFromChange('71200', null), null);
  });

  it('converts exchange-local times to instants across DST', async () => {
    const { zonedIso, zonedDate } = await import('../broker-format');
    assert.equal(zonedIso('20261007', '093000', 'Asia/Seoul'), '2026-10-07T00:30:00.000Z');
    assert.equal(zonedIso('20260115', '0930', 'America/New_York'), '2026-01-15T14:30:00.000Z'); // EST
    assert.equal(zonedIso('20260715', '093000', 'America/New_York'), '2026-07-15T13:30:00.000Z'); // EDT
    assert.equal(zonedIso('2026107', '0930', 'Asia/Seoul'), null);
    assert.equal(zonedDate('2026-07-16T02:00:00Z', 'America/New_York'), '2026-07-15');
    assert.equal(zonedDate('2026-07-16T02:00:00Z', 'Asia/Seoul'), '2026-07-16');
  });
});

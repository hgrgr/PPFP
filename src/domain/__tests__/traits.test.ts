import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assetKind, PRESETS, suggestTraits, targetsValid, traitAllocation, UNASSIGNED } from '../traits';

const a = (type: string, name: string, symbol: string | null = null, currency = 'KRW') => ({ type, name, symbol, currency });

describe('trait allocation', () => {
  const traits = [
    { id: 'up', name: '성장 상승', color: '#1', targetWeight: 0.25 },
    { id: 'dn', name: '물가 하락', color: '#2', targetWeight: 0.25 },
    { id: 'inf', name: '물가 상승', color: '#3', targetWeight: 0.25 },
  ];
  const items = [
    { assetId: 'aapl', name: '애플', value: 600 },
    { assetId: 'gld', name: '금', value: 200 },
    { assetId: 'btc', name: '비트코인', value: 100 },
    { assetId: 'gone', name: '판 종목', value: 0 },
  ];
  const tags = new Map([
    ['aapl', ['up', 'dn']],
    ['gld', ['inf', 'deleted-trait']],
  ]);

  it('splits two-trait assets evenly and puts untagged ones under 미지정', () => {
    const { slices, total } = traitAllocation(traits, items, tags, { value: 100, traitId: null });
    assert.equal(total, 1000);
    const by = Object.fromEntries(slices.map((s) => [s.key, s]));
    assert.equal(by.up.value, 300);
    assert.equal(by.dn.value, 300);
    assert.equal(by.inf.value, 200);
    assert.equal(by[UNASSIGNED].value, 200);
    assert.deepEqual(by[UNASSIGNED].assets.map((x) => x.assetId), ['btc', 'CASH_BAL']);
  });

  it('measures the gap to each target', () => {
    const { slices } = traitAllocation(traits, items, tags);
    const inf = slices.find((s) => s.key === 'inf')!;
    assert.ok(Math.abs(inf.share - 200 / 900) < 1e-9);
    assert.ok(Math.abs(inf.gap! - (0.25 - 200 / 900)) < 1e-9);
  });

  it('counts cash as the chosen trait', () => {
    const { slices } = traitAllocation(traits, [], new Map(), { value: 50, traitId: 'dn' });
    assert.equal(slices.find((s) => s.key === 'dn')!.share, 1);
  });

  it('can measure shares among tagged assets only', () => {
    const { slices, total } = traitAllocation(traits, items, tags, { value: 100, traitId: null }, 'tagged');
    assert.equal(total, 800);
    assert.equal(slices.find((s) => s.key === 'up')!.share, 300 / 800);
    const none = slices.find((s) => s.key === UNASSIGNED)!;
    assert.equal(none.excluded, true);
    assert.equal(none.share, 0);
    assert.equal(none.value, 200);
  });

  it('accepts targets up to 100%', () => {
    assert.ok(targetsValid([0.3, 0.55, 0.075, 0.075]));
    assert.ok(targetsValid([null, 0.5]));
    assert.ok(!targetsValid([0.6, 0.6]));
    assert.ok(!targetsValid([-0.1]));
  });
});

describe('trait suggestions', () => {
  it('reads what an asset is from its type, name and ticker', () => {
    assert.equal(assetKind(a('US_STOCK', 'iShares 20+ Year Treasury Bond ETF', 'TLT', 'USD')), 'bond');
    assert.equal(assetKind(a('KR_STOCK', 'KODEX 골드선물(H)', '132030')), 'gold');
    assert.equal(assetKind(a('KR_STOCK', 'TIGER 미국S&P500', '360750')), 'equity');
    assert.equal(assetKind(a('KR_STOCK', '금호석유', '011780')), 'equity');
    assert.equal(assetKind(a('US_STOCK', 'Schwab U.S. TIPS ETF', 'SCHP', 'USD')), 'linker');
    assert.equal(assetKind(a('ALTERNATIVE', '금 현물')), 'gold');
    assert.equal(assetKind(a('CASH', '정기예금')), 'cash');
  });

  it('maps to Bridgewater environments', () => {
    assert.deepEqual(suggestTraits('allWeather', a('US_STOCK', '애플', 'AAPL', 'USD')), ['성장 상승', '물가 하락']);
    assert.deepEqual(suggestTraits('allWeather', a('BOND', '국고채 30년')), ['성장 하락', '물가 하락']);
    assert.deepEqual(suggestTraits('allWeather', a('CRYPTO', '비트코인', 'KRW-BTC')), []);
  });

  it('suggests asset classes and regions', () => {
    assert.deepEqual(suggestTraits('assetClass', a('CASH', '정기예금')), ['현금성']);
    assert.deepEqual(suggestTraits('region', a('KR_STOCK', 'TIGER 미국나스닥100', '133690')), ['미국']);
    assert.deepEqual(suggestTraits('region', a('KR_STOCK', '삼성전자', '005930')), ['국내']);
    assert.deepEqual(suggestTraits('region', a('US_STOCK', 'Vanguard FTSE Emerging Markets', 'VWO', 'USD')), ['신흥국']);
    assert.deepEqual(suggestTraits('equityStyle', a('US_STOCK', '애플', 'AAPL', 'USD')), []);
  });

  it('only suggests traits that exist in the preset', () => {
    for (const p of PRESETS) {
      const names = new Set(p.traits.map((t) => t.name));
      for (const type of ['KR_STOCK', 'US_STOCK', 'BOND', 'CASH', 'CRYPTO', 'REAL_ESTATE', 'ALTERNATIVE']) {
        for (const n of ['금', '국채', '원유', '리츠', 'S&P500', '물가연동']) for (const t of suggestTraits(p.key, a(type, n))) assert.ok(names.has(t), `${p.key}: ${t}`);
      }
      if (p.cashTrait) assert.ok(names.has(p.cashTrait));
      if (p.example) assert.ok(Object.keys(p.example.targets).every((k) => names.has(k)) && targetsValid(Object.values(p.example.targets)));
    }
  });
});

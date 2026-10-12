import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Dec } from '../decimal';
import { checkShare, overlapInfo, strategySeries, tradeFlow, accountWeights, effectiveShares, shareBreach } from '../strategy-portfolios';

const d = (v: string | number) => Dec.of(v);

describe('checkShare', () => {
  const others = [
    { strategyId: 'a', share: d('0.6'), allowOverlap: false },
    { strategyId: 'o', share: d('1'), allowOverlap: true },
  ];
  it('lets a splitting strategy take only what the other splitting ones left', () => {
    assert.equal(checkShare(others, { id: 'b', allowOverlap: false }, d('0.4')).ok, true);
    const r = checkShare(others, { id: 'b', allowOverlap: false }, d('0.5'));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.room.toString(), '0.4');
      assert.match(r.message, /40%까지/);
    }
  });
  it('does not count its own current share against itself', () => {
    assert.equal(checkShare(others, { id: 'a', allowOverlap: false }, d('1')).ok, true);
  });
  it('lets an overlapping strategy take up to 100% whatever the others took', () => {
    assert.equal(checkShare(others, { id: 'c', allowOverlap: true }, d('1')).ok, true);
    assert.equal(checkShare(others, { id: 'c', allowOverlap: true }, d('1.01')).ok, false);
    assert.equal(checkShare(others, { id: 'c', allowOverlap: true }, d('0')).ok, false);
  });
});

describe('overlapInfo', () => {
  it('names the strategies by share and flags two or more', () => {
    const i = overlapInfo([
      { strategyId: 'g', name: '성장', share: d('0.4'), allowOverlap: false },
      { strategyId: 'b', name: '배당', share: d('0.6'), allowOverlap: false },
    ]);
    assert.equal(i.label, '배당 60% · 성장 40%');
    assert.equal(i.overlap, true);
    assert.equal(i.total.toString(), '1');
    assert.equal(overlapInfo([{ strategyId: 'b', name: '배당', share: d('1'), allowOverlap: false }]).overlap, false);
  });
});

describe('strategySeries', () => {
  const shares = new Map([['h1', d('0.5')]]);
  it('values the shares of the holdings and ignores the rest', () => {
    const s = strategySeries(
      [
        { date: '2026-03-02', holdings: { h1: '1000', h2: '999' } },
        { date: '2026-03-03', holdings: { h1: '1200' } },
      ],
      [],
      shares,
    );
    assert.deepEqual(s.map((p) => [p.date, p.value.toString(), p.flow.toString()]), [
      ['2026-03-02', '500', '0'],
      ['2026-03-03', '600', '0'],
    ]);
  });
  it('counts its share of buys as money in, sales as money out, weekend trades on the next day', () => {
    const buy = { date: '2026-03-07', holdingId: 'h1', type: 'BUY' as const, qty: d(2), price: d(100), fee: d(1), tax: d(0), fxRate: d(1) };
    assert.equal(tradeFlow(buy, d('0.5')).toString(), '100.5');
    const sale = { ...buy, type: 'SELL' as const, fee: d(1), tax: d(1) };
    assert.equal(tradeFlow(sale, d('0.5')).toString(), '-99');
    const s = strategySeries([{ date: '2026-03-06', holdings: { h1: '1000' } }, { date: '2026-03-09', holdings: { h1: '1200' } }], [buy], shares);
    assert.equal(s[1].flow.toString(), '100.5');
    assert.equal(s[0].flow.toString(), '0');
  });
});

describe('strategies that take whole accounts', () => {
  const d = (v: string) => Dec.of(v);
  const edges = [{ parentId: 'us', childId: 'us-growth', allocation: d('0.5') }];
  const holdings = [
    { id: 'aapl', portfolioId: 'us' },
    { id: 'nvda', portfolioId: 'us-growth' },
    { id: 'ss', portfolioId: 'kr' },
  ];

  it('weighs an account, its children by allocation, and adds direct shares', () => {
    const via = accountWeights(new Map([['us', d('1')]]), edges);
    assert.equal(via.get('us')!.toString(), '1');
    assert.equal(via.get('us-growth')!.toString(), '0.5');
    const eff = effectiveShares(new Map([['ss', d('0.3')]]), via, holdings);
    assert.deepEqual([...eff].map(([k, v]) => [k, v.toString()]), [['aapl', '1'], ['nvda', '0.5'], ['ss', '0.3']]);
  });

  it('lets two overlapping strategies take the same account in full, but not two splitting ones', () => {
    const take = (id: string, allowOverlap: boolean) => ({ id, name: id, allowOverlap, shares: effectiveShares(new Map(), accountWeights(new Map([['us', d('1')]]), edges), holdings) });
    assert.equal(shareBreach([take('growth', true), take('allweather', true)], 'allweather', (h) => h), null);
    assert.equal(shareBreach([take('growth', false), take('allweather', true)], 'allweather', (h) => h), null);
    assert.match(shareBreach([take('growth', false), take('allweather', false)], 'allweather', (h) => h) ?? '', /aapl: growth 100%와\(과\) 합쳐 200%/);
  });

  it('stops one strategy from taking more than all of a holding through account and direct shares', () => {
    const via = accountWeights(new Map([['us', d('1')]]), edges);
    const self = { id: 's', name: 's', allowOverlap: true, shares: effectiveShares(new Map([['aapl', d('0.2')]]), via, holdings) };
    assert.match(shareBreach([self], 's', (h) => h) ?? '', /aapl: .*120%/);
  });
});

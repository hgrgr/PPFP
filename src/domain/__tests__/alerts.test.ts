import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { directionFor, driftReport, isCrossed, journalDirections, newlyBreached, targetsOk } from '../alerts';

describe('price alerts', () => {
  it('waits for a rise above the current price and a fall below it', () => {
    assert.equal(directionFor(120, 100), 'ABOVE');
    assert.equal(directionFor(80, 100), 'BELOW');
    assert.equal(directionFor(80, null), 'ABOVE');
  });

  it('fires on reaching the price, not before', () => {
    assert.ok(isCrossed('ABOVE', 120, 120));
    assert.ok(!isCrossed('ABOVE', 120, 119.99));
    assert.ok(isCrossed('BELOW', 80, 79));
    assert.ok(!isCrossed('BELOW', 80, 81));
  });

  it('points a journal stop the other way from its target', () => {
    assert.deepEqual(journalDirections(120, 100), { target: 'ABOVE', stop: 'BELOW' });
    assert.deepEqual(journalDirections(80, 100), { target: 'BELOW', stop: 'ABOVE' });
  });
});

describe('target weight drift', () => {
  const parts = [
    { key: 'kr', label: '국내', value: 500 },
    { key: 'us', label: '미국', value: 300 },
    { key: 'CASH', label: '현금', value: 200 },
  ];

  it('reports shares, gaps and trades against the targets', () => {
    const r = driftReport(parts, { kr: 0.4, us: 0.4, CASH: 0.2 }, 0.05);
    const kr = r.rows.find((x) => x.key === 'kr')!;
    assert.equal(r.total, 1000);
    assert.equal(kr.share, 0.5);
    assert.ok(Math.abs(kr.diff! - 0.1) < 1e-12);
    assert.equal(kr.trade, -100);
    assert.deepEqual(r.breaches.sort(), ['kr', 'us']);
    assert.equal(r.rows.find((x) => x.key === 'CASH')!.breach, false);
  });

  it('counts a target with nothing held, and never breaches a part without a target', () => {
    const r = driftReport(parts, { gold: 0.1, kr: 0.5 }, 0.05);
    const gold = r.rows.find((x) => x.key === 'gold')!;
    assert.equal(gold.share, 0);
    assert.equal(gold.trade, 100);
    assert.deepEqual(r.breaches, ['gold']);
    assert.equal(r.rows.find((x) => x.key === 'us')!.target, null);
  });

  it('stays inside the band at exactly the tolerance', () => {
    assert.deepEqual(driftReport(parts, { kr: 0.45 }, 0.05).breaches, []);
  });

  it('tells each breach once', () => {
    assert.deepEqual(newlyBreached(['kr'], ['kr', 'us']), ['us']);
    assert.deepEqual(newlyBreached(['kr', 'us'], ['kr']), []);
  });

  it('checks targets add up to at most 100%', () => {
    assert.ok(targetsOk([0.4, 0.4, 0.2]));
    assert.ok(!targetsOk([0.6, 0.5]));
  });
});

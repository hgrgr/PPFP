import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bucketOf, taxYear, type OpenRow, type RealizedRow } from '../tax';

const sell = (bucket: RealizedRow['bucket'], pnlKrw: number): RealizedRow => ({ date: '2026-03-01', asset: 'X', bucket, pnlKrw });
const open = (asset: string, unrealizedKrw: number, bucket: OpenRow['bucket'] = 'OVERSEAS'): OpenRow => ({ assetId: asset, asset, symbol: asset, bucket, valueKrw: 10_000_000, unrealizedKrw });

describe('tax buckets', () => {
  it('sorts sales by tax', () => {
    assert.equal(bucketOf('US_STOCK', 'USD'), 'OVERSEAS');
    assert.equal(bucketOf('FUND', 'USD'), 'OVERSEAS');
    assert.equal(bucketOf('FUND', 'KRW'), 'OTHER');
    assert.equal(bucketOf('KR_STOCK', 'KRW'), 'DOMESTIC');
    assert.equal(bucketOf('CRYPTO', 'KRW'), 'CRYPTO');
  });
});

describe('tax year', () => {
  it('nets overseas gains and losses, then deducts 2.5M and applies 22%', () => {
    const t = taxYear(2026, [sell('OVERSEAS', 6_000_000), sell('OVERSEAS', -1_500_000), sell('DOMESTIC', 3_000_000)], [], null);
    assert.equal(t.overseas.netKrw, 4_500_000);
    assert.equal(t.overseas.taxableKrw, 2_000_000);
    assert.equal(t.overseas.taxKrw, 440_000);
    assert.equal(t.domestic.taxKrw, 0);
    assert.equal(t.harvest, null);
  });

  it('owes nothing on a net loss', () => {
    const t = taxYear(2026, [sell('OVERSEAS', 1_000_000), sell('OVERSEAS', -3_000_000)], [], null);
    assert.equal(t.overseas.taxableKrw, 0);
    assert.equal(t.overseas.taxKrw, 0);
  });

  it('taxes crypto only from the year it starts', () => {
    assert.equal(taxYear(2026, [sell('CRYPTO', 5_000_000)], [], null).crypto.taxKrw, 0);
    assert.equal(taxYear(2027, [sell('CRYPTO', 5_000_000)], [], null).crypto.taxKrw, 550_000);
  });

  it('adds up financial income against the 20M line', () => {
    const t = taxYear(2026, [], [{ date: '2026-01-01', asset: 'A', kind: 'DIVIDEND', amountKrw: 15_000_000 }, { date: '2026-01-01', asset: null, kind: 'INTEREST', amountKrw: 6_000_000 }], null);
    assert.equal(t.financial.totalKrw, 21_000_000);
    assert.equal(t.financial.overThreshold, true);
  });

  it('suggests losses that cut this year\'s tax, biggest first, only as far as they help', () => {
    const t = taxYear(2026, [sell('OVERSEAS', 4_500_000)], [], [open('A', -1_500_000), open('B', -3_000_000), open('C', 1_000_000), open('K', -9_000_000, 'DOMESTIC')]);
    assert.deepEqual(
      t.harvest!.losses.map((l) => [l.asset, l.savesKrw]),
      [
        ['B', 440_000],
        ['A', 0],
      ],
    );
    assert.equal(t.harvest!.lossSavingKrw, 440_000);
    assert.equal(t.harvest!.deductionRoomKrw, 0);
    assert.deepEqual(t.harvest!.fill, []);
  });

  it('fills the unused deduction with gains', () => {
    const t = taxYear(2026, [sell('OVERSEAS', 500_000)], [], [open('A', 1_000_000), open('B', 3_000_000)]);
    assert.equal(t.harvest!.deductionRoomKrw, 2_000_000);
    assert.deepEqual(
      t.harvest!.fill.map((f) => [f.asset, f.realizeKrw]),
      [['B', 2_000_000]],
    );
    assert.equal(Math.round(t.harvest!.fill[0].shareOfPosition * 100), 67);
  });

  it('counts a net loss so far as extra room', () => {
    const t = taxYear(2026, [sell('OVERSEAS', -500_000)], [], [open('A', 5_000_000)]);
    assert.equal(t.harvest!.deductionRoomKrw, 3_000_000);
  });
});

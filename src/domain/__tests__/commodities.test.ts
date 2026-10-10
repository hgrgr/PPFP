import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activeContract, COMMODITIES, krwPerGram, parseKisFuture, parseKiwoomGold } from '../commodities';

const def = (id: string) => COMMODITIES.find((c) => c.id === id)!;

describe('commodities', () => {
  it('picks the active futures contract', () => {
    assert.equal(activeContract(def('gold'), '2026-10-10'), 'GCZ26');
    assert.equal(activeContract(def('gold'), '2026-11-10'), 'GCZ26');
    assert.equal(activeContract(def('gold'), '2026-11-26'), 'GCG27');
    assert.equal(activeContract(def('silver'), '2026-12-01'), 'SIH27');
    assert.equal(activeContract(def('wti'), '2026-10-10'), 'CLX26');
    assert.equal(activeContract(def('wti'), '2026-10-20'), 'CLZ26');
    assert.equal(activeContract(def('wti'), '2026-12-20'), 'CLG27');
    assert.equal(activeContract(def('natgas'), '2026-10-23'), 'NGZ26');
    assert.equal(activeContract(def('es'), '2026-12-05'), 'ESZ26');
    assert.equal(activeContract(def('es'), '2026-12-12'), 'ESH27');
    assert.equal(activeContract(def('zn'), '2026-10-10'), 'ZNZ26');
    assert.equal(activeContract(def('soybean'), '2026-10-10'), 'ZSX26');
    assert.equal(activeContract(def('corn'), '2026-10-10'), 'ZCZ26');
  });

  it('reads 키움 금현물: previous close plus the signed change', () => {
    const q = parseKiwoomGold({ pred_pre_sig: '2', pred_pre: '+870', flu_rt: '+0.57', trde_qty: '16326', open_pric: '+152200', high_pric: '+152560', low_pric: '-152200', pred_close_pric: '151680', return_code: 0 })!;
    assert.equal(q.price, '152550');
    assert.equal(q.prevClose, '151680');
    assert.equal(q.low, '152200');
    assert.equal(parseKiwoomGold({ pred_pre: '-1,200', pred_close_pric: '151,680' })!.price, '150480');
    assert.equal(parseKiwoomGold({ return_code: 0 }), null);
  });

  it('reads 한국투자증권 해외선물 현재가', () => {
    const q = parseKisFuture({ last_price: '4012.30', prev_price: '3990.10', open_price: '3995.0', high_price: '4020.0', low_price: '3988.5', vol: '152,331', proc_date: '20261009', proc_time: '235959', expr_date: '20261229', exch_cd: 'CME' })!;
    assert.deepEqual(q, { price: '4012.3', prevClose: '3990.1', open: '3995', high: '4020', low: '3988.5', volume: '152331', expiry: '2026-12-29', asOf: '2026-10-09 23:59:59' });
    assert.equal(parseKisFuture({ last_price: '0' }), null);
    assert.equal(parseKisFuture([{ last_price: '71.2', prev_price: '' }])!.prevClose, null);
  });

  it('converts USD/oz to 원/g', () => {
    assert.equal(Math.round(krwPerGram(4000, 1400)), 180044);
  });
});

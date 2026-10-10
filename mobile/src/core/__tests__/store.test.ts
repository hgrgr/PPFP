import 'fake-indexeddb/auto';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PpfpDb } from '../db';
import { addPortfolio, deleteTxn, ensureAsset, InputError, recordTxn } from '../store';

describe('store', () => {
  it('records trades, refuses an oversized sale and a delete that breaks a later sale', async () => {
    const db = new PpfpDb(`t-${Math.random()}`);
    const p = await addPortfolio('주식', 'FIFO', db);
    await assert.rejects(addPortfolio('주식', 'FIFO', db), InputError);
    const a = await ensureAsset({ type: 'KR_STOCK', symbol: '5930', name: '삼성전자', currency: 'KRW' }, db);
    assert.equal(a.symbol, '005930');
    assert.equal((await ensureAsset({ type: 'KR_STOCK', symbol: '005930', name: '삼성', currency: 'KRW' }, db)).id, a.id);
    const buy = await recordTxn({ portfolioId: p.id, type: 'BUY', assetId: a.id, localAt: '2026-03-02T10:00', qty: '10', price: '70,000' }, db);
    assert.equal(buy.price, '70000');
    await assert.rejects(recordTxn({ portfolioId: p.id, type: 'SELL', assetId: a.id, localAt: '2026-03-03T10:00', qty: '11', price: '80000' }, db), /보유 수량/);
    await recordTxn({ portfolioId: p.id, type: 'SELL', assetId: a.id, localAt: '2026-03-03T10:00', qty: '5', price: '80000' }, db);
    await assert.rejects(deleteTxn(buy.id, db), /뒤의 매도/);
    await assert.rejects(recordTxn({ portfolioId: p.id, type: 'DEPOSIT', localAt: '2026-03-03T10:00', amount: '-5' }, db), /0보다/);
    await assert.rejects(recordTxn({ portfolioId: p.id, type: 'BUY', assetId: (await ensureAsset({ type: 'US_STOCK', symbol: 'AAPL', name: '애플', currency: 'USD' }, db)).id, localAt: '2026-03-03', qty: '1', price: '200' }, db), /환율/);
    db.close();
  });
});

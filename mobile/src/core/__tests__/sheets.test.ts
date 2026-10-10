import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseSheet } from '@/domain/data-format';
import { fromSheets, kstText, toSheets, type LocalData } from '../sheets';
import { rowKey } from '../sync';

const data: LocalData = {
  portfolios: [{ id: 'p1', name: '미국 주식', lotMethod: 'HIFO', archived: false, createdAt: '2026-01-01T00:00:00Z' }],
  assets: [
    { id: 'a1', type: 'US_STOCK', symbol: 'AAPL', name: '애플', currency: 'USD', price: null, priceAt: null, priceSource: null, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'a2', type: 'CASH', symbol: null, name: '정기예금', currency: 'KRW', price: null, priceAt: null, priceSource: null, createdAt: '2026-01-01T00:00:00Z' },
  ],
  txns: [
    { id: 't1', portfolioId: 'p1', assetId: null, type: 'DEPOSIT', tradeAt: '2026-03-02T01:30:00.000Z', qty: null, price: null, amount: '1000', fee: '0', tax: '0', currency: 'USD', fxRate: '1350', useCash: true, ratio: null, lotMethod: null, memo: '', createdAt: '2026-03-02T01:30:00Z' },
    { id: 't2', portfolioId: 'p1', assetId: 'a1', type: 'BUY', tradeAt: '2026-03-02T02:00:00.000Z', qty: '3', price: '180.5', amount: null, fee: '1.2', tax: '0', currency: 'USD', fxRate: '1350', useCash: true, ratio: null, lotMethod: null, memo: '첫 매수', createdAt: '2026-03-02T02:00:00Z' },
    { id: 't3', portfolioId: 'p1', assetId: 'a2', type: 'BUY', tradeAt: '2026-03-03T00:00:00.000Z', qty: '1', price: '5000000', amount: null, fee: '0', tax: '0', currency: 'KRW', fxRate: null, useCash: false, ratio: null, lotMethod: null, memo: '', createdAt: '2026-03-03T00:00:00Z' },
  ],
  notes: [{ id: 'n1', body: '#가치투자 메모', pinned: true, createdAt: '2026-03-02T00:00:00Z' }],
  journals: [{ id: 'j1', assetId: 'a1', title: '애플 매수 계획', status: 'OPEN', targetPrice: '230', basePrice: '180', stopPrice: '150', dueDate: '2026-12-31', body: '서비스 매출', createdAt: '2026-03-02T00:00:00Z' }],
};

describe('sheets', () => {
  it('writes Korean time', () => {
    assert.equal(kstText('2026-03-02T01:30:00.000Z'), '2026-03-02 10:30');
  });

  it('writes rows the server import accepts without errors', () => {
    const s = toSheets(data);
    for (const key of ['portfolios', 'transactions', 'notes', 'journals'] as const) {
      const parsed = parseSheet(key, s[key] ?? []);
      assert.equal(parsed.filter((p) => p.error).length, 0, `${key}: ${parsed.map((p) => p.error).filter(Boolean).join(', ')}`);
      assert.equal(parsed.length, (s[key] ?? []).length);
    }
    const tx = parseSheet('transactions', s.transactions!);
    assert.equal(tx[1].record?.qty, '3');
    assert.equal(tx[2].record?.asset?.type, 'CASH');
    assert.equal(tx[2].record?.useCash, false);
  });

  it('reads its own rows back into a fresh phone', () => {
    const r = fromSheets(toSheets(data), { portfolios: [], assets: [], txns: [], notes: [], journals: [] });
    assert.equal(r.problems.length, 0);
    assert.equal(r.data.portfolios[0].lotMethod, 'HIFO');
    assert.equal(r.data.txns.length, 3);
    assert.equal(r.data.assets.length, 2);
    assert.equal(r.data.txns[1].tradeAt, '2026-03-02T02:00:00.000Z');
    assert.equal(r.data.journals[0].targetPrice, '230');
    assert.equal(r.data.notes[0].pinned, true);
  });

  it('skips trades whose server id the phone already has, and existing notes', () => {
    const sheets = toSheets(data);
    sheets.transactions![0]['거래 ID'] = 'srv1';
    const existing = { ...data, txns: [{ ...data.txns[0], serverId: 'srv1' }] };
    const r = fromSheets(sheets, existing);
    assert.equal(r.skipped >= 1, true);
    assert.equal(r.data.txns.length, 2);
    assert.equal(r.data.notes.length, 0);
    assert.equal(r.data.assets.length, 0);
  });

  it('matches a row to the server export whatever the seconds and number format', () => {
    const mine = toSheets(data).transactions![1];
    const server = { ...mine, 일시: `${mine['일시']}:00`, 수량: '3.00000000', 단가: '180.50' };
    assert.equal(rowKey(server), rowKey(mine));
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { priceStats, textToBlocks, tradeStats, type Bar, type SellRow } from '../ai-analysis';

const bars = (closes: number[]): Bar[] => closes.map((c, i) => ({ t: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), c, h: c + 1, l: c - 1, v: 100 }));

describe('price stats', () => {
  it('measures returns back from the last close', () => {
    const s = priceStats(bars(Array.from({ length: 260 }, (_, i) => 100 + i)))!;
    assert.equal(s.close, 359);
    assert.equal(s.returnPct['1W'], Math.round(((359 - 354) / 354) * 1000) / 10);
    assert.equal(s.returnPct['1Y'], Math.round(((359 - 110) / 110) * 1000) / 10);
    assert.equal(s.high52w, 360);
    assert.equal(s.ma20, (340 + 359) / 2);
    assert.equal(s.avgVolume20d, 100);
  });

  it('leaves out what a short history cannot tell', () => {
    const s = priceStats(bars([10, 11, 12]))!;
    assert.equal(s.returnPct['1M'], null);
    assert.equal(s.ma20, null);
    assert.equal(s.volatility20dAnnualPct, null);
    assert.equal(priceStats([]), null);
  });
});

describe('trade stats', () => {
  const row = (pnl: number, cost: number, days: number, hasJournal = true): SellRow => ({ date: '2026-01-01', asset: 'X', pnlKrw: pnl * 10, cost, pnl, holdingDays: days, hasJournal });

  it('counts wins, payoff and habits', () => {
    const s = tradeStats([row(20, 100, 200), row(10, 100, 100), row(-5, 100, 30, false), row(-15, 100, 10, false)]);
    assert.equal(s.winRatePct, 50);
    assert.equal(s.avgWinPct, 15);
    assert.equal(s.avgLossPct, -10);
    assert.equal(s.profitFactor, 1.5);
    assert.equal(s.realizedKrw, 100);
    assert.equal(s.avgHoldingDaysWins, 150);
    assert.equal(s.avgHoldingDaysLosses, 20);
    assert.equal(s.sellsWithoutJournal, 2);
    assert.deepEqual(s.best.map((b) => b.returnPct), [20, 10]);
    assert.deepEqual(s.worst.map((b) => b.returnPct), [-15, -5]);
  });

  it('has no ratios without trades or losses', () => {
    assert.equal(tradeStats([]).winRatePct, null);
    assert.equal(tradeStats([row(5, 100, 1)]).profitFactor, null);
  });
});

describe('review text to journal blocks', () => {
  it('keeps headings, bullets and numbered steps', () => {
    assert.deepEqual(textToBlocks('AI 복기', '## 잘한 점\n- **분할** 매수\n\n1. 손절가 지키기\n그 밖의 메모'), [
      { type: 'heading', props: { level: 2 }, content: 'AI 복기' },
      { type: 'heading', props: { level: 3 }, content: '잘한 점' },
      { type: 'bulletListItem', content: '분할 매수' },
      { type: 'numberedListItem', content: '손절가 지키기' },
      { type: 'paragraph', content: '그 밖의 메모' },
    ]);
  });
});

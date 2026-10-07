import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHoldingsText, pastedNumber } from '../holdings-paste';

describe('pasted numbers', () => {
  it('drops separators and units', () => {
    assert.equal(pastedNumber('1,234주'), '1234');
    assert.equal(pastedNumber('70,000원'), '70000');
    assert.equal(pastedNumber('$187.50'), '187.5');
    assert.equal(pastedNumber('삼성전자'), null);
    assert.equal(pastedNumber(''), null);
  });
});

describe('parseHoldingsText', () => {
  it('reads a tab-separated table copied from an HTS, in any column order', () => {
    const text = ['종목명\t종목코드\t보유수량(주)\t평가금액\t평균단가(원)', '삼성전자\tA005930\t10\t712,000\t68,500', 'SK하이닉스\t000660\t3\t540,000\t150,000.5'].join('\n');
    const { rows, errors } = parseHoldingsText(text);
    assert.deepEqual(errors, []);
    assert.deepEqual(rows, [
      { symbol: '005930', name: '삼성전자', currency: 'KRW', qty: '10', avgPrice: '68500' },
      { symbol: '000660', name: 'SK하이닉스', currency: 'KRW', qty: '3', avgPrice: '150000.5' },
    ]);
  });

  it('reads quoted CSV with thousands separators and a currency column', () => {
    const text = '﻿종목코드,종목명,잔고수량,매입단가,통화\r\nAAPL,애플,"1,200",187.25,USD\r\n"005930",삼성전자,5,"71,000",KRW\r\n';
    const { rows, errors } = parseHoldingsText(text);
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { symbol: 'AAPL', name: '애플', currency: 'USD', qty: '1200', avgPrice: '187.25' });
    assert.equal(rows[1].currency, 'KRW');
  });

  it('derives the average price from the purchase amount', () => {
    const { rows } = parseHoldingsText('종목코드\t수량\t매입금액\n005930\t4\t280,000');
    assert.equal(rows[0].avgPrice, '70000');
  });

  it('merges a stock that appears twice (cash and margin) at the weighted average', () => {
    const { rows } = parseHoldingsText('종목코드\t수량\t평균단가\n005930\t10\t70000\n005930\t30\t74000');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].qty, '40');
    assert.equal(rows[0].avgPrice, '73000');
  });

  it('works without a header: code, quantity, average price', () => {
    const { rows, errors } = parseHoldingsText('005930 10 70000\nTSLA 2 250.5');
    assert.deepEqual(errors, []);
    assert.deepEqual(
      rows.map((r) => [r.symbol, r.qty, r.avgPrice, r.currency]),
      [
        ['005930', '10', '70000', 'KRW'],
        ['TSLA', '2', '250.5', 'USD'],
      ],
    );
  });

  it('skips total rows and reports rows it cannot read', () => {
    const text = ['종목코드\t종목명\t수량\t평균단가', '005930\t삼성전자\t10\t70000', '\t삼성바이오\t1\t800000', '000660\tSK하이닉스\t0\t1', '합계\t\t11\t'].join('\n');
    const { rows, errors } = parseHoldingsText(text);
    assert.equal(rows.length, 1);
    assert.equal(errors.length, 2);
    assert.match(errors[0], /3행.*종목코드/);
    assert.match(errors[1], /4행.*000660.*수량/);
  });

  it('explains an empty paste', () => {
    assert.deepEqual(parseHoldingsText('  \n ').errors, ['붙여넣은 내용이 없습니다.']);
  });
});

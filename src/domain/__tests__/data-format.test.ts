import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectSheet, headersOf, kstDateTime, num, parseLinks, parseSheet, SAMPLES, SHEET_KEYS, sheetByName, txnType, lotMethod, yn } from '../data-format';
import { parseCsv } from '../csv';

describe('import format', () => {
  it('every sample row is valid', () => {
    for (const k of SHEET_KEYS) {
      const parsed = parseSheet(k, SAMPLES[k]);
      assert.deepEqual(
        parsed.filter((p) => p.error).map((p) => `${k} ${p.line}: ${p.error}`),
        [],
      );
      // Sample columns are real columns
      for (const r of SAMPLES[k]) for (const h of Object.keys(r)) assert.ok(headersOf(k).includes(h), `${k}: ${h}`);
    }
  });

  it('knows a sheet by its name or its header row', () => {
    assert.equal(sheetByName('거래 내역'), 'transactions');
    assert.equal(detectSheet(['일시', '포트폴리오', '유형', '통화', '수량']), 'transactions');
    assert.equal(detectSheet(['제목', '저자', '출판사', '상태']), 'books');
    assert.equal(detectSheet(['이름', '색']), 'topics');
    assert.equal(detectSheet(['a', 'b']), null);
  });

  it('reads cells the way people type them', () => {
    assert.deepEqual(kstDateTime('2026.3.2 9:05', '일시'), { date: '2026-03-02', time: '09:05:00' });
    assert.deepEqual(kstDateTime('2026-02-14', '일시'), { date: '2026-02-14', time: '00:00:00' });
    const [t] = parseSheet('transactions', [{ 일시: '2026-02-14', 포트폴리오: 'A', 유형: '입금', 통화: 'KRW', 금액: '1' }]);
    assert.equal(t.record?.at.toISOString(), '2026-02-13T15:00:00.000Z');
    assert.throws(() => kstDateTime('2026-02-30', '일시'), /없는 날짜/);
    assert.equal(num('₩1,234.50', '금액'), '1234.50');
    assert.equal(num('007', '수량'), '7');
    assert.throws(() => num('abc', '수량'), /숫자/);
    assert.equal(yn('', '보관', true), true);
    assert.equal(yn('n', '보관', true), false);
    assert.equal(txnType('BUY'), 'BUY');
    assert.equal(txnType('평가 갱신'), 'VALUATION');
    assert.equal(txnType('분할'), 'SPLIT');
    assert.equal(lotMethod('FIFO'), 'FIFO');
    assert.equal(lotMethod('선입선출 (FIFO)'), 'FIFO');
    assert.equal(lotMethod('이동평균'), 'AVERAGE');
    assert.deepEqual(parseLinks('키워드: 가치투자; 거장: 워런 버핏\n종목：005930'), [
      { type: 'topic', name: '가치투자' },
      { type: 'sage', name: '워런 버핏' },
      { type: 'asset', name: '005930' },
    ]);
  });

  it('points at the bad cell, with the row number in the file', () => {
    const parsed = parseSheet('transactions', [
      { 일시: '2026-01-02', 포트폴리오: 'A', 유형: '매수', 종목코드: 'AAPL', 통화: 'USD', 수량: '1', 단가: '100' },
      {},
      { 일시: '2026-01-02', 포트폴리오: 'A', 유형: '입금', 통화: 'KRW' },
      { 일시: '2026-01-02', 포트폴리오: 'A', 유형: '매수', '자산 이름': '예금', 통화: 'KRW', 수량: '1', 단가: '1' },
      { 일시: '2026-01-02', 포트폴리오: 'A', 유형: '사기', 통화: 'KRW' },
    ]);
    assert.deepEqual(
      parsed.map((p) => [p.line, p.error ?? 'ok']),
      [
        [2, 'USD 거래는 환율을 채우세요.'],
        [4, '금액을(를) 채우세요.'],
        [5, '종목코드가 없는 수기 자산은 자산 유형을 채우세요.'],
        [6, "유형 '사기'을(를) 알 수 없습니다. 매수, 매도, 입금, 출금, 배당, 이자, 수수료, 세금, 분할·병합, 평가 갱신 중 하나로 쓰세요."],
      ],
    );
  });

  it('reads back what the CSV writer wrote', () => {
    assert.deepEqual(parseCsv('﻿제목,본문\r\n"a, b","줄\n바꿈 ""따옴표"""\r\n'), [
      ['제목', '본문'],
      ['a, b', '줄\n바꿈 "따옴표"'],
    ]);
  });
});

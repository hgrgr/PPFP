import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths,
  balanceSheet,
  depositMaturity,
  dsr,
  groupOf,
  loanSchedule,
  loanStatus,
  monthsBetween,
  paymentsBetween,
  rateOn,
  revolvingInterest,
  weightedRate,
  type LoanTerms,
} from '../net-worth';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const base: LoanTerms = { principal: 120_000_000, startDate: '2026-01-15', maturityDate: '2027-01-15', method: 'AMORTIZING', rates: [{ from: '2026-01-15', rate: 0.06 }] };

describe('loan dates', () => {
  it('clamps the due day to the month end and counts months', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2026-01-15', 13, 31), '2027-02-28');
    assert.equal(addMonths('2026-11-10', 2), '2027-01-10');
    assert.equal(monthsBetween('2026-01-15', '2027-01-15'), 12);
  });

  it('picks the rate in force on a date', () => {
    const rates = [{ from: '2026-07-15', rate: 0.05 }, { from: '2026-01-15', rate: 0.06 }];
    assert.equal(rateOn(rates, '2026-03-01'), 0.06);
    assert.equal(rateOn(rates, '2026-07-15'), 0.05);
    assert.equal(rateOn(rates, '2025-12-01'), 0.06);
  });
});

describe('loan schedule', () => {
  it('원리금균등 pays a level amount and clears the balance', () => {
    const s = loanSchedule(base);
    assert.equal(s.length, 12);
    assert.equal(s[0].payment, 10_327_972);
    assert.equal(s[0].interest, 600_000);
    assert.ok(s.slice(0, 11).every((i) => i.payment === 10_327_972));
    assert.equal(s.at(-1)!.balance, 0);
    assert.equal(sum(s.map((i) => i.principal)), 120_000_000);
    assert.ok(Math.abs(s.at(-1)!.payment - 10_327_972) < 10);
    assert.equal(s.at(-1)!.dueDate, '2027-01-15');
  });

  it('원금균등 repays the same principal with falling interest', () => {
    const s = loanSchedule({ ...base, principal: 12_000_000, method: 'EQUAL_PRINCIPAL' });
    assert.ok(s.every((i) => i.principal === 1_000_000));
    assert.equal(s[0].interest, 60_000);
    assert.equal(s[1].interest, 55_000);
    assert.equal(sum(s.map((i) => i.interest)), 390_000);
  });

  it('만기일시 pays interest only until maturity', () => {
    const s = loanSchedule({ ...base, method: 'BULLET' });
    assert.ok(s.slice(0, 11).every((i) => i.principal === 0 && i.interest === 600_000));
    assert.equal(s.at(-1)!.principal, 120_000_000);
    assert.equal(sum(s.map((i) => i.interest)), 7_200_000);
  });

  it('grace months pay interest only, then amortize over the rest', () => {
    const s = loanSchedule({ ...base, graceMonths: 3 });
    assert.ok(s.slice(0, 3).every((i) => i.grace && i.principal === 0 && i.payment === 600_000));
    assert.ok(!s[3].grace && s[3].principal > 0);
    assert.ok(s[3].payment > 10_327_972);
    assert.equal(s.at(-1)!.balance, 0);
  });

  it('a new rate recomputes the level payment', () => {
    const s = loanSchedule({ ...base, rates: [...base.rates, { from: '2026-07-15', rate: 0.03 }] });
    assert.equal(s[5].rate, 0.06);
    assert.equal(s[6].rate, 0.03);
    assert.ok(s[6].payment < s[5].payment);
    assert.equal(s.at(-1)!.balance, 0);
  });

  it('revolving and custom loans have no schedule; 마통 interest is daily', () => {
    assert.deepEqual(loanSchedule({ ...base, method: 'REVOLVING' }), []);
    assert.deepEqual(loanSchedule({ ...base, method: 'CUSTOM', maturityDate: null }), []);
    assert.equal(revolvingInterest(10_000_000, 0.073, 30), 60_000);
    assert.equal(revolvingInterest(-5, 0.073, 30), 0);
  });
});

describe('loan status', () => {
  it('splits paid and remaining interest at a date', () => {
    const s = loanSchedule({ ...base, principal: 12_000_000, method: 'EQUAL_PRINCIPAL' });
    const st = loanStatus(12_000_000, s, '2026-04-20');
    assert.equal(st.paidCount, 3);
    assert.equal(st.remaining, 9_000_000);
    assert.equal(st.paidInterest, 60_000 + 55_000 + 50_000);
    assert.equal(st.paidInterest + st.remainingInterest, st.totalInterest);
    assert.equal(st.thisMonth?.dueDate, '2026-04-15');
    assert.equal(st.next?.dueDate, '2026-05-15');
    assert.equal(st.progress, 0.25);
    assert.equal(st.payoffDate, '2027-01-15');
    assert.equal(paymentsBetween(s, '2026-04-20', '2026-06-20'), 1_045_000 + 1_040_000);
  });

  it('before the first due date nothing is repaid', () => {
    const st = loanStatus(120_000_000, loanSchedule(base), '2026-01-20');
    assert.equal(st.remaining, 120_000_000);
    assert.equal(st.progress, 0);
    assert.equal(st.thisMonth, null);
  });
});

describe('deposits', () => {
  it('정기예금 simple interest after 15.4% tax', () => {
    const d = depositMaturity({ kind: 'TERM', amount: 10_000_000, rate: 0.036, months: 12 });
    assert.deepEqual(d, { paidIn: 10_000_000, interest: 360_000, tax: 55_440, maturity: 10_304_560 });
  });

  it('정기적금 earns on each payment for the months it stays in', () => {
    const d = depositMaturity({ kind: 'INSTALLMENT', amount: 1_000_000, rate: 0.036, months: 12 });
    assert.equal(d.paidIn, 12_000_000);
    assert.equal(d.interest, 234_000);
    assert.equal(d.maturity, 12_000_000 + 234_000 - 36_036);
    const c = depositMaturity({ kind: 'TERM', amount: 10_000_000, rate: 0.036, months: 12, compounding: 'MONTHLY', taxRate: 0 });
    assert.ok(c.interest > 360_000 && c.tax === 0);
  });
});

describe('balance sheet', () => {
  it('groups by type and kind and nets liabilities', () => {
    const b = balanceSheet([
      { id: 'a', name: '삼성전자', type: 'KR_STOCK', value: 30_000_000 },
      { id: 'b', name: '정기예금', type: 'CASH', kind: 'TERM_DEPOSIT', value: 10_000_000 },
      { id: 'c', name: '전세보증금', type: 'ALTERNATIVE', kind: 'LEASE_DEPOSIT_PAID', value: 300_000_000 },
      { id: 'd', name: '증권 현금', type: 'CASH_BAL', value: 2_000_000 },
      { id: 'e', name: '전세대출', type: 'LIABILITY', kind: 'JEONSE_LOAN', value: -200_000_000 },
      { id: 'f', name: '마통', type: 'LIABILITY', kind: 'OVERDRAFT', value: -12_000_000 },
    ]);
    assert.equal(b.assets, 342_000_000);
    assert.equal(b.liabilities, 212_000_000);
    assert.equal(b.netWorth, 130_000_000);
    assert.equal(b.debtToAssets, 212 / 342);
    assert.equal(b.debtToEquity, 212 / 130);
    assert.deepEqual(b.groups.map((g) => g.key), ['CASH', 'SAVINGS', 'INVEST', 'LEASE_DEPOSIT', 'JEONSE', 'CREDIT']);
    assert.equal(b.groups.find((g) => g.key === 'JEONSE')!.total, 200_000_000);
  });

  it('keeps a liability kind off the asset side and ratios null when undefined', () => {
    assert.equal(groupOf('ALTERNATIVE', 'MORTGAGE'), 'OTHER_ASSET');
    assert.equal(groupOf('LIABILITY', 'VEHICLE'), 'OTHER_DEBT');
    assert.equal(groupOf('LIABILITY', null), 'OTHER_DEBT');
    const b = balanceSheet([{ id: 'x', name: '빚', type: 'LIABILITY', value: -1 }]);
    assert.equal(b.debtToAssets, null);
    assert.equal(b.debtToEquity, null);
    assert.equal(dsr(12_000_000, 0), null);
    assert.equal(dsr(12_000_000, 60_000_000), 0.2);
    assert.equal(weightedRate([{ balance: 100, rate: 0.04 }, { balance: 300, rate: 0.06 }]), 0.055);
  });
});

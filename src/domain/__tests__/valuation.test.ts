import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cagr, dcf, ddm, insiderMonths, median, multiples, parseForm4, reverseDcf, rim, sensitivity, ttm } from '../valuation';

const close = (a: number | null | undefined, b: number, eps = 1e-6) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe('models', () => {
  it('discounts a two-stage cash flow', () => {
    const r = dcf({ fcf: 100, growth: 0, years: 2, terminal: 0, discount: 0.1, netCash: 50, shares: 10 });
    // Flat 100 forever at 10% = 1000
    close(r.enterprise, 1000);
    close(r.perShare, 105);
    assert.equal(r.flows.length, 2);
    close(r.terminalShare, 1000 / 1.21 / 1000);
    assert.equal(dcf({ fcf: 1, growth: 0, years: 1, terminal: 0.1, discount: 0.1, netCash: 0, shares: 1 }).perShare, null);
  });

  it('finds the growth the price implies', () => {
    const base = { fcf: 100, years: 5, terminal: 0.02, discount: 0.09, netCash: 0, shares: 10 };
    const price = dcf({ ...base, growth: 0.12 }).perShare!;
    close(reverseDcf(price, base), 0.12, 1e-6);
    assert.equal(reverseDcf(1e9, base), null);
  });

  it('values dividends and residual income', () => {
    // No first-stage growth: D(1+g)/(r−g)
    close(ddm({ dps: 2, growth: 0.03, years: 0, terminal: 0.03, discount: 0.08 }), (2 * 1.03) / 0.05);
    assert.equal(ddm({ dps: 0, growth: 0, years: 5, terminal: 0.02, discount: 0.08 }), null);
    // ROE equal to the cost of equity: worth book value
    close(rim({ bps: 50, roe: 0.1, payout: 0.3, discount: 0.1, years: 5, persistence: 0.5 })!.perShare, 50);
    assert.ok(rim({ bps: 50, roe: 0.2, payout: 0.3, discount: 0.1, years: 5, persistence: 0.5 })!.perShare > 50);
  });

  it('grids the sensitivity', () => {
    const g = sensitivity({ fcf: 100, growth: 0.05, years: 5, terminal: 0.02, discount: 0.09, netCash: 0, shares: 10 }, [0.08, 0.1], [0.03, 0.06]);
    assert.equal(g.length, 2);
    assert.ok(g[0][1]! > g[0][0]! && g[0][0]! > g[1][0]!);
  });
});

describe('inputs and multiples', () => {
  it('sums four quarters and compounds', () => {
    assert.equal(ttm([1, 2, 3, 4, 5]), 10);
    assert.equal(ttm([1, null, 3, 4]), null);
    close(cagr(121, 100, 2), 0.1);
    assert.equal(cagr(-1, 100, 2), null);
    assert.equal(median([3, null, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
  });

  it('computes multiples', () => {
    const m = multiples({ revenue: 1000, operatingIncome: 200, netIncome: 100, operatingCashFlow: 180, capex: -30, dividends: -40, cash: 100, debt: 300, equity: 500, shares: 10, revenueCagr: 0.1, asOf: '2026-06-30' }, 150);
    assert.equal(m.marketCap, 1500);
    assert.equal(m.pe, 15);
    assert.equal(m.ps, 1.5);
    assert.equal(m.pb, 3);
    assert.equal(m.evEbit, 8.5);
    assert.equal(m.fcfYield, 0.1);
    close(m.dividendYield, 40 / 1500);
    assert.equal(m.roe, 0.2);
    assert.equal(multiples({ revenue: 1, operatingIncome: -1, netIncome: -5, operatingCashFlow: null, capex: null, dividends: null, cash: null, debt: null, equity: 1, shares: 1, revenueCagr: null, asOf: null }, 10).pe, null);
  });
});

describe('Form 4', () => {
  const xml = `<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>Doe Jane &amp; Co</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>1</isOfficer><officerTitle>CFO</officerTitle></reportingOwnerRelationship></reportingOwner>
<nonDerivativeTable>
<nonDerivativeTransaction><transactionDate><value>2026-09-03</value></transactionDate><transactionCoding><transactionCode>S</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>150.5</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts><postTransactionAmounts><sharesOwnedFollowingTransaction><value>9000</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction>
<nonDerivativeTransaction><transactionDate><value>2026-09-20</value></transactionDate><transactionCoding><transactionCode>P</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>200</value></transactionShares><transactionPricePerShare><value>100</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts><postTransactionAmounts><sharesOwnedFollowingTransaction><value>9200</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction>
<nonDerivativeTransaction><transactionDate><value>2026-10-01</value></transactionDate><transactionCoding><transactionCode>A</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>50</value></transactionShares><transactionPricePerShare><value>0</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>
</nonDerivativeTable></ownershipDocument>`;

  it('reads owner, role and transactions', () => {
    const t = parseForm4(xml);
    assert.equal(t.length, 3);
    assert.deepEqual(t[0], { date: '2026-09-03', owner: 'Doe Jane & Co', role: 'CFO · 이사', code: 'S', shares: 1000, price: 150.5, sign: -1, after: 9000 });
    assert.equal(t[2].price, null);
    assert.equal(t[2].after, null);
    assert.deepEqual(insiderMonths(t), [{ month: '2026-09', buy: 20000, sell: -150500 }]);
  });
});

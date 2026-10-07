import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Dec, D } from '../decimal';

describe('Dec', () => {
  it('adds without floating point error', () => {
    assert.equal(D('0.1').add('0.2').toString(), '0.3');
    assert.equal(D(0.1).add(0.2).toString(), '0.3');
  });

  it('parses signs, exponents and integers', () => {
    assert.equal(D('-12.5000').toString(), '-12.5');
    assert.equal(D('1e3').toString(), '1000');
    assert.equal(D('2.5E-3').toString(), '0.0025');
    assert.equal(D(123456789012n).toString(), '123456789012');
    assert.equal(D('.5').toString(), '0.5');
    assert.throws(() => D('abc'));
    assert.throws(() => D(''));
  });

  it('multiplies and divides with rounding', () => {
    assert.equal(D('247.8').mul('1392').toString(), '344937.6');
    assert.equal(D(1).div(3).toFixed(4), '0.3333');
    assert.equal(D(2).div(3).toFixed(4), '0.6667');
    assert.equal(D(-2).div(3).toFixed(4), '-0.6667');
    assert.throws(() => D(1).div(0));
  });

  it('rounds half away from zero', () => {
    assert.equal(D('2.345').round(2).toString(), '2.35');
    assert.equal(D('-2.345').round(2).toString(), '-2.35');
    assert.equal(D('2.344').round(2).toString(), '2.34');
    assert.equal(D('0.004').toFixed(2), '0.00');
    assert.equal(D('-0.004').toFixed(2), '0.00');
  });

  it('handles large KRW amounts exactly', () => {
    const v = D('987654321098.76').mul('1.000001');
    assert.equal(v.toFixed(2), '987655308753.08');
  });

  it('compares and sums', () => {
    assert.ok(D('1.0').eq(1));
    assert.ok(D(2).gt('1.999999'));
    assert.equal(Dec.sum(['1.1', 2, D('3.3')]).toString(), '6.4');
    assert.equal(Dec.maybe(null).toString(), '0');
    assert.equal(Dec.maybe(undefined, Dec.ONE).toString(), '1');
  });
});

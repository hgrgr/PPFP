import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRateLimits, projectMonth, serviceInfo } from '../api-usage';

describe('api usage', () => {
  const at = new Date('2026-10-10T03:00:00Z');

  it('reads Anthropic rate-limit headers', () => {
    const w = parseRateLimits(
      {
        'anthropic-ratelimit-requests-limit': '50',
        'anthropic-ratelimit-requests-remaining': '49',
        'anthropic-ratelimit-requests-reset': '2026-10-10T03:00:30Z',
        'anthropic-ratelimit-output-tokens-limit': '8000',
        'anthropic-ratelimit-output-tokens-remaining': '7000',
      },
      at,
    );
    assert.deepEqual(w, [
      { kind: '요청', limit: 50, remaining: 49, reset: '2026-10-10T03:00:30.000Z' },
      { kind: '출력 토큰', limit: 8000, remaining: 7000, reset: null },
    ]);
  });

  it('reads OpenAI-style and GitHub headers', () => {
    assert.deepEqual(parseRateLimits({ 'x-ratelimit-limit-requests': '500', 'x-ratelimit-remaining-requests': '499', 'x-ratelimit-reset-requests': '1m30s' }, at), [
      { kind: '요청', limit: 500, remaining: 499, reset: '2026-10-10T03:01:30.000Z' },
    ]);
    assert.deepEqual(parseRateLimits({ 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': '1791601200' }, at), [
      { kind: '호출', limit: 60, remaining: 12, reset: new Date(1791601200 * 1000).toISOString() },
    ]);
    assert.deepEqual(parseRateLimits({ 'retry-after': '3' }, at), []);
  });

  it('projects the month from the days so far (KST)', () => {
    // 10 Oct 12:00 KST: 9.5 days of 31 have passed
    assert.equal(Math.round(projectMonth(9.5, new Date('2026-10-10T03:00:00Z')) * 100) / 100, 31);
    assert.ok(Number.isFinite(projectMonth(1, new Date('2026-09-30T15:00:00Z'))));
  });

  it('describes each service', () => {
    assert.equal(serviceInfo('anthropic').group, 'ai');
    assert.equal(serviceInfo('broker:KIS').name, '한국투자증권');
    assert.equal(serviceInfo('github').group, 'data');
  });
});

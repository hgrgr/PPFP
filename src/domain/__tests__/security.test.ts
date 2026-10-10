import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { deviceLabel, FREE_FAILURES, sameDevice, signupAllowed, signupModeOf, Throttle, waitAfter, waitLabel } from '../security';
import { agoLabel, backupState, parseBackupRecord } from '../backup';

describe('sign-up', () => {
  it('reads SIGNUP_MODE, invitations by default', () => {
    assert.equal(signupModeOf(undefined), 'invite');
    assert.equal(signupModeOf(' OPEN '), 'open');
    assert.equal(signupModeOf('closed'), 'closed');
    assert.equal(signupModeOf('anything'), 'invite');
  });
  it('always lets the first account in', () => {
    assert.deepEqual(signupAllowed('closed', 0, false), { ok: true });
    assert.deepEqual(signupAllowed('invite', 0, false), { ok: true });
  });
  it('then follows the mode', () => {
    assert.equal(signupAllowed('open', 3, false).ok, true);
    assert.equal(signupAllowed('invite', 3, true).ok, true);
    assert.equal(signupAllowed('invite', 3, false).ok, false);
    assert.equal(signupAllowed('closed', 3, true).ok, false);
  });
});

describe('failed sign-ins', () => {
  it('waits nothing for the first failures, then 30 s doubling up to 15 min', () => {
    assert.equal(waitAfter(FREE_FAILURES - 1), 0);
    assert.equal(waitAfter(FREE_FAILURES), 30_000);
    assert.equal(waitAfter(FREE_FAILURES + 1), 60_000);
    assert.equal(waitAfter(FREE_FAILURES + 2), 120_000);
    assert.equal(waitAfter(FREE_FAILURES + 20), 15 * 60_000);
  });
  it('counts per key and makes the key wait after the fifth failure', () => {
    const t = new Throttle();
    const now = 1_000_000;
    for (let i = 0; i < 4; i++) t.fail('email:a', now);
    assert.equal(t.wait('email:a', now), 0);
    t.fail('email:a', now);
    assert.equal(t.wait('email:a', now), 30_000);
    assert.equal(t.wait('email:a', now + 10_000), 20_000);
    assert.equal(t.wait('email:a', now + 30_000), 0);
    assert.equal(t.wait('email:b', now), 0);
  });
  it('forgets a key after a day without failures, and on reset', () => {
    const t = new Throttle();
    for (let i = 0; i < 6; i++) t.fail('k', 0);
    assert.ok(t.wait('k', 1000) > 0);
    assert.equal(t.wait('k', 25 * 3_600_000), 0);
    t.fail('k', 25 * 3_600_000);
    assert.equal(t.failures('k'), 1);
    t.reset('k');
    assert.equal(t.failures('k'), 0);
  });
  it('says how long to wait in words', () => {
    assert.equal(waitLabel(29_100), '30초');
    assert.equal(waitLabel(61_000), '2분');
  });
});

describe('devices', () => {
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const android = 'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36';
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
  it('names the browser and the system', () => {
    assert.equal(deviceLabel(mac), 'Chrome · macOS');
    assert.equal(deviceLabel(android), '삼성 인터넷 · Android');
    assert.equal(deviceLabel(iphone), 'Safari · iOS');
    assert.equal(deviceLabel(mac.replace('Chrome/140.0.0.0 Safari/537.36', 'Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0')), 'Edge · macOS');
    assert.equal(deviceLabel('PPFP Android (Pixel 9)'), 'PPFP 앱 · Android');
    assert.equal(deviceLabel(null), '알 수 없는 기기');
    assert.equal(deviceLabel('???'), '알 수 없는 기기');
  });
  it('treats the same browser and system as the same device, never two unknowns', () => {
    assert.equal(sameDevice(mac, mac.replace('140.0.0.0', '141.0.0.0')), true);
    assert.equal(sameDevice(mac, android), false);
    assert.equal(sameDevice(null, null), false);
    assert.equal(sameDevice('???', '???'), false);
  });
});

describe('backup status', () => {
  const at = '2026-10-10T03:00:00Z';
  const t = Date.parse(at);
  const rec = (o: object) => JSON.stringify({ at, ok: true, file: 'ppfp-20261010-030000.dump', bytes: 1024, tables: 44, kept: 3, keep: 14, intervalHours: 24, ...o });
  it('is none without a record or with a broken one', () => {
    assert.deepEqual(backupState(null, t), { state: 'none' });
    assert.deepEqual(backupState('not json', t), { state: 'none' });
    assert.equal(parseBackupRecord(JSON.stringify({ at: 'yesterday', ok: true })), null);
  });
  it('is ok within two intervals, stale after', () => {
    assert.equal(backupState(rec({}), t + 30 * 3_600_000).state, 'ok');
    assert.equal(backupState(rec({}), t + 49 * 3_600_000).state, 'stale');
    assert.equal(backupState(rec({ intervalHours: 6 }), t + 13 * 3_600_000).state, 'stale');
  });
  it('reports a failed run', () => {
    const s = backupState(JSON.stringify({ at, ok: false, error: 'pg_dump failed' }), t + 3_600_000);
    assert.equal(s.state, 'failed');
  });
  it('says how long ago', () => {
    assert.equal(agoLabel(0.2), '12분 전');
    assert.equal(agoLabel(5), '5시간 전');
    assert.equal(agoLabel(72), '3일 전');
  });
});

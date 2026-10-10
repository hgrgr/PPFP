import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { base32Decode, base32Encode, newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUri, stepAt, totpCode, verifyTotp } from '../totp';

// RFC 6238 appendix B: SHA-1 secret "12345678901234567890"
const RFC_SECRET = Buffer.from('12345678901234567890');
const RFC_B32 = base32Encode(RFC_SECRET);

describe('base32', () => {
  it('round-trips and matches the RFC 4648 example', () => {
    assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
    assert.equal(base32Decode('MZXW 6YTB OI').toString(), 'foobar');
    assert.equal(base32Decode('mzxw6ytboi======').toString(), 'foobar');
    const s = newTotpSecret();
    assert.match(s, /^[A-Z2-7]{32}$/);
    assert.equal(base32Encode(base32Decode(s)), s);
  });
  it('refuses letters outside the alphabet', () => {
    assert.throws(() => base32Decode('ABC1'));
  });
});

describe('totp', () => {
  it('matches the RFC 6238 test vectors (8 digits)', () => {
    assert.equal(totpCode(RFC_SECRET, stepAt(59_000), 8), '94287082');
    assert.equal(totpCode(RFC_SECRET, stepAt(1_111_111_109_000), 8), '07081804');
    assert.equal(totpCode(RFC_SECRET, stepAt(1_234_567_890_000), 8), '89005924');
    assert.equal(totpCode(RFC_SECRET, stepAt(20_000_000_000_000), 8), '65353130');
  });
  it('accepts the current code and one step either side, nothing further', () => {
    const now = 1_111_111_109_000;
    const step = stepAt(now);
    assert.equal(verifyTotp(RFC_B32, totpCode(RFC_SECRET, step), now), step);
    assert.equal(verifyTotp(RFC_B32, totpCode(RFC_SECRET, step - 1), now), step - 1);
    assert.equal(verifyTotp(RFC_B32, totpCode(RFC_SECRET, step + 1), now), step + 1);
    assert.equal(verifyTotp(RFC_B32, totpCode(RFC_SECRET, step - 2), now), null);
    assert.equal(verifyTotp(RFC_B32, totpCode(RFC_SECRET, step + 2), now), null);
  });
  it('refuses a code already used (its step at or before the last one)', () => {
    const now = 1_234_567_890_000;
    const step = stepAt(now);
    const code = totpCode(RFC_SECRET, step);
    assert.equal(verifyTotp(RFC_B32, code, now, step), null);
    assert.equal(verifyTotp(RFC_B32, code, now, step - 1), step);
  });
  it('ignores spaces and refuses anything but six digits', () => {
    const now = 59_000;
    const code = totpCode(RFC_SECRET, stepAt(now));
    assert.equal(verifyTotp(RFC_B32, `${code.slice(0, 3)} ${code.slice(3)}`, now), stepAt(now));
    assert.equal(verifyTotp(RFC_B32, '12345', now), null);
    assert.equal(verifyTotp(RFC_B32, 'abcdef', now), null);
  });
  it('builds the otpauth link authenticator apps read', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'me@example.com');
    assert.ok(uri.startsWith('otpauth://totp/PPFP%3Ame%40example.com?'));
    const q = new URL(uri).searchParams;
    assert.equal(q.get('secret'), 'JBSWY3DPEHPK3PXP');
    assert.equal(q.get('issuer'), 'PPFP');
    assert.equal(q.get('digits'), '6');
    assert.equal(q.get('period'), '30');
  });
});

describe('recovery codes', () => {
  it('makes ten distinct readable codes', () => {
    const codes = newRecoveryCodes();
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    for (const c of codes) assert.match(c, /^[a-z2-9]{4}-[a-z2-9]{4}$/);
  });
  it('compares typed codes without case, spaces or dashes', () => {
    assert.equal(normalizeRecoveryCode(' K7QD-2mxa '), 'k7qd2mxa');
    assert.equal(normalizeRecoveryCode('k7qd 2mxa'), 'k7qd2mxa');
  });
});

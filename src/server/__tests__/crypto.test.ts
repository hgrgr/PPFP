import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, hashPassword, mask, sha256, verifyPassword } from '../crypto';

describe('server crypto', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips an encrypted secret and rejects tampering', () => {
    const blob = encryptSecret('toss-secret-값', key);
    assert.notEqual(blob.includes('toss-secret'), true);
    assert.equal(decryptSecret(blob, key), 'toss-secret-값');
    const parts = blob.split('.');
    const flipped = parts[3][0] === 'A' ? 'B' : 'A';
    parts[3] = flipped + parts[3].slice(1);
    assert.throws(() => decryptSecret(parts.join('.'), key));
    assert.throws(() => decryptSecret(blob, randomBytes(32).toString('base64')));
  });

  it('refuses a malformed key', () => {
    assert.throws(() => encryptSecret('x', 'short'));
  });

  it('hashes and verifies passwords', async () => {
    const h = await hashPassword('correct horse');
    assert.ok(h.startsWith('scrypt$'));
    assert.equal(await verifyPassword('correct horse', h), true);
    assert.equal(await verifyPassword('wrong', h), false);
    assert.equal(await verifyPassword('x', 'garbage'), false);
  });

  it('hashes tokens and masks ids', () => {
    assert.equal(sha256('a').length, 64);
    assert.equal(mask('abcdef123456'), '••••••••3456');
    assert.equal(mask('abc'), '••••');
  });
});

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { BackupError, openBackup, sealBackup } from '../backup';

describe('backup file', () => {
  const payload = { tables: { notes: [{ id: 'n1', body: '비밀 메모' }] } };

  it('opens with the right passphrase and hides the content', async () => {
    const f = await sealBackup(payload, 'correct horse battery', { iterations: 100_000 });
    const text = JSON.stringify(f);
    assert.equal(text.includes('비밀 메모'), false);
    const r = await openBackup(text, 'correct horse battery');
    assert.deepEqual(r.payload, payload);
  });

  it('refuses a wrong passphrase, an edited header and a short passphrase', async () => {
    const f = await sealBackup(payload, 'correct horse battery', { iterations: 100_000 });
    await assert.rejects(openBackup(JSON.stringify(f), 'wrong horse battery'), BackupError);
    await assert.rejects(openBackup(JSON.stringify({ ...f, createdAt: '2020-01-01T00:00:00Z' }), 'correct horse battery'), BackupError);
    await assert.rejects(sealBackup(payload, 'short'), BackupError);
    await assert.rejects(openBackup('{"format":"other"}', 'correct horse battery'), /PPFP/);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openVault, sealVault, VaultError } from '../key-vault';

const pass = '마당에 핀 개나리 2026';
const N = 1 << 14; // fast for tests; files use 2^17

describe('key vault', () => {
  it('round-trips a payload and keeps the keys out of the file', async () => {
    const f = await sealVault({ services: [{ service: 'kakao', key: 'abcdef0123456789' }] }, pass, { N });
    const text = JSON.stringify(f);
    assert.equal(text.includes('abcdef0123456789'), false);
    assert.equal(f.format, 'ppfp-keys');
    assert.deepEqual(await openVault(text, pass), { services: [{ service: 'kakao', key: 'abcdef0123456789' }] });
    // A new salt and IV every time
    assert.notEqual((await sealVault({}, pass, { N })).data, (await sealVault({}, pass, { N })).data);
  });

  it('rejects a wrong passphrase, a changed header and a non-backup file', async () => {
    const text = JSON.stringify(await sealVault({ a: 1 }, pass, { N }));
    await assert.rejects(openVault(text, pass + '!'), (e: unknown) => e instanceof VaultError && /암호가 틀렸/.test(e.message));
    const f = JSON.parse(text);
    await assert.rejects(openVault(JSON.stringify({ ...f, kdf: { ...f.kdf, r: 9 } }), pass), VaultError);
    await assert.rejects(openVault(JSON.stringify({ ...f, kdf: { ...f.kdf, N: 1 << 24 } }), pass), /암호화 설정/);
    await assert.rejects(openVault('{"hello":1}', pass), /백업 파일이 아닙니다/);
    await assert.rejects(openVault('not json', pass), /백업 파일이 아닙니다/);
  });

  it('asks for a long enough passphrase', async () => {
    await assert.rejects(sealVault({}, 'short', { N }), /12자 이상/);
  });
});

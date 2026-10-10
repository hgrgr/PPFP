/**
 * Back up or restore one account's API keys from the command line, against the database in
 * DATABASE_URL (local dev, the demo DB, a fresh DB after a reset). Same file format as
 * 연동 · 설정 › API 키 백업 · 복원.
 *
 *   npm run keys -- restore ppfp-keys.json --email me@example.com [--verify] [--overwrite]
 *   npm run keys -- export ppfp-keys.json --email me@example.com
 *
 * The backup passphrase comes from PPFP_KEYS_PASSPHRASE, or is asked for without echo.
 * Export skips the login-password check of the web page: whoever can run this already
 * holds the database and APP_ENCRYPTION_KEY.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { prisma } from '@/server/db';
import { sealVault } from '@/server/key-vault';
import { keyPayload, restoreKeys } from '@/server/services/key-backup';

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
    out._writeToOutput = (s: string) => {
      if (s.includes(prompt)) out.output.write(s);
    };
    rl.question(prompt, (v) => {
      rl.close();
      process.stdout.write('\n');
      resolve(v);
    });
  });
}

async function main() {
  const [cmd, file, ...rest] = process.argv.slice(2);
  const flag = (n: string) => rest.includes(`--${n}`);
  const email = rest[rest.indexOf('--email') + 1];
  if (!['export', 'restore'].includes(cmd) || !file || !rest.includes('--email') || !email) {
    console.error('usage: npm run keys -- restore|export <file> --email <email> [--verify] [--overwrite]');
    process.exit(2);
  }
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw new Error(`no user ${email} in this database`);
  const passphrase = process.env.PPFP_KEYS_PASSPHRASE || (await askHidden('백업 암호: '));

  if (cmd === 'restore') {
    const lines = await restoreKeys(user.id, readFileSync(file, 'utf8'), passphrase, { verify: flag('verify'), overwrite: flag('overwrite') });
    for (const l of lines) console.log(`${l.result.padEnd(8)} ${l.what}${l.note ? ` · ${l.note}` : ''}`);
  } else {
    const payload = await keyPayload(user.id);
    writeFileSync(file, JSON.stringify(await sealVault(payload, passphrase), null, 2), { mode: 0o600 });
    console.log(`wrote ${file}: ${payload.brokers.length} connections, ${payload.services.length} service keys`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

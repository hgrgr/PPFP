import { revalidatePath } from 'next/cache';
import { appImport } from '@/server/services/mobile';
import { preflight, withUser } from '../cors';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** { sheets: { transactions: [...], ... }, commit } → the import report; without commit nothing is written. */
export function POST(req: Request) {
  return withUser(req, async ({ user }) => {
    const body = await req.json().catch(() => null);
    const commit = (body as { commit?: unknown } | null)?.commit === true;
    const report = await appImport(user.id, body, commit);
    if (commit) revalidatePath('/', 'layout');
    return { report };
  });
}

export const OPTIONS = preflight;

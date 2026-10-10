import { revalidatePath } from 'next/cache';
import { SHEET_KEYS, type SheetKey } from '@/domain/data-format';
import { currentUser } from '@/server/auth';
import { importData, readUpload } from '@/server/services/data-io';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Import a file (multipart: file, optional kind for a CSV, commit=1 to write). Without commit it
 * only checks the file and reports what would happen.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: '다시 로그인하세요.' }, { status: 401 });
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) throw new UserError('가져올 파일을 고르세요.');
    const kind = String(form.get('kind') ?? '');
    const forced = (SHEET_KEYS as readonly string[]).includes(kind) ? (kind as SheetKey) : null;
    const commit = form.get('commit') === '1';
    const report = await importData(user.id, await readUpload(file, forced), commit);
    if (commit) revalidatePath('/', 'layout');
    return Response.json({ report });
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    console.error('[import]', e);
    return Response.json({ error: '파일을 가져오지 못했습니다.' }, { status: 500 });
  }
}

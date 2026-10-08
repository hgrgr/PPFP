import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { IMAGE_MAX_BYTES, saveImage } from '@/server/services/journal';
import { UserError } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

/** Upload one image (multipart field "file"). Returns the address the editor stores. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (Number(req.headers.get('content-length') ?? 0) > IMAGE_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: '이미지는 5MB까지 올릴 수 있습니다.' }, { status: 413 });
  const file = (await req.formData()).get('file');
  if (!(file instanceof Blob)) return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
  try {
    const id = await saveImage(user.id, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ url: `/api/journal/images/${id}` });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

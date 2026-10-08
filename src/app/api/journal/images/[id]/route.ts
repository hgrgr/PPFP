import { currentUser } from '@/server/auth';
import { getImage } from '@/server/services/journal';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response('unauthorized', { status: 401 });
  const img = await getImage(user.id, (await params).id);
  if (!img) return new Response('not found', { status: 404 });
  return new Response(new Uint8Array(img.data), {
    headers: {
      'content-type': img.mime,
      'content-length': String(img.size),
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}

import { isProvider } from '@/domain/ai-providers';
import { currentUser } from '@/server/auth';
import { apiErrorMessage } from '@/server/services/ai/agent';
import { listModels } from '@/server/services/ai/providers';

export const dynamic = 'force-dynamic';

/** Models the user's key for one AI company can use, for the model picker in 연동 · 설정. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const provider = new URL(req.url).searchParams.get('provider');
  if (!isProvider(provider)) return Response.json({ error: 'bad request' }, { status: 400 });
  try {
    return Response.json({ models: await listModels(user.id, provider) });
  } catch (e) {
    return Response.json({ error: apiErrorMessage(e) }, { status: 200 });
  }
}

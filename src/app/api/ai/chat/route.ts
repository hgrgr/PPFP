import { z } from 'zod';
import { currentUser } from '@/server/auth';
import { apiErrorMessage, runTurn, type ChatEvent } from '@/server/services/ai/agent';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  conversationId: z.string().optional(),
  agent: z.enum(['MANAGER', 'RESEARCH', 'COACH', 'SAGE']).optional(),
  sageId: z.string().nullable().optional(),
  text: z.string(),
  path: z.string().max(500).nullable().optional(),
});

/** One chat turn, streamed as newline-delimited JSON events (see ChatEvent). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 });
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ChatEvent) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + '\n'));
        } catch {
          // the client went away; the request signal aborts the turn
        }
      };
      try {
        await runTurn(user.id, parsed.data, emit, req.signal);
      } catch (e) {
        if (!req.signal.aborted) emit({ t: 'error', message: apiErrorMessage(e) });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}

/**
 * AI company keys, and the advisor's step on OpenAI-compatible Chat Completions (ChatGPT,
 * Gemini, Grok, DeepSeek). Claude runs on the Anthropic SDK in agent.ts.
 */
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { randomBytes } from 'node:crypto';
import { chatModelIds, emptyState, finish, foldChunk, toOpenAiMessages, toOpenAiTools, type Finished, type OaiChunk, type StoredMessage } from '@/domain/ai-openai';
import { PROVIDER_ORDER, PROVIDERS, type ProviderId } from '@/domain/ai-providers';
import { prisma } from '../../db';
import { UserError } from '../portfolios';
import { serviceKey } from '../api-keys';
import { noteCall, outcomeOf } from '../api-usage';

/** An error answer from an OpenAI-compatible endpoint. */
export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function providerKey(userId: string, provider: ProviderId) {
  return serviceKey(userId, provider, PROVIDERS[provider].env);
}

/** Which AI companies have a key: the user's own, the server's, or none. */
export async function providerKeys(userId: string): Promise<Record<ProviderId, { source: 'user' | 'server' | null; hint: string | null }>> {
  const rows = await prisma.apiKey.findMany({ where: { userId, service: { in: PROVIDER_ORDER } }, select: { service: true, hint: true } });
  const hints = new Map(rows.map((r) => [r.service, r.hint]));
  return Object.fromEntries(
    PROVIDER_ORDER.map((p) => [p, hints.has(p) ? { source: 'user' as const, hint: hints.get(p)! } : process.env[PROVIDERS[p].env]?.trim() ? { source: 'server' as const, hint: null } : { source: null, hint: null }]),
  ) as Record<ProviderId, { source: 'user' | 'server' | null; hint: string | null }>;
}

async function requireKey(userId: string, provider: ProviderId): Promise<string> {
  const k = await providerKey(userId, provider);
  if (!k) throw new UserError(`${PROVIDERS[provider].name} API 키가 없습니다. 연동 · 설정에서 넣으세요.`);
  return k.key;
}

export async function anthropicClient(userId: string): Promise<Anthropic> {
  return new Anthropic({ apiKey: await requireKey(userId, 'anthropic') });
}

async function errorMessage(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  try {
    const j = JSON.parse(body);
    const e = Array.isArray(j) ? j[0]?.error : j.error;
    return String(e?.message ?? e ?? body).slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

/**
 * One request of the agent loop on a Chat Completions endpoint, streamed. `onText` gets
 * answer text as it arrives and `onTool` the name of each tool call as it starts.
 */
export async function compatStep(
  userId: string,
  opts: { provider: ProviderId; model: string; system: string; tools: { name: string; description?: string; input_schema: unknown }[]; messages: StoredMessage[]; signal?: AbortSignal },
  onText: (d: string) => void,
  onTool: (name: string) => void,
): Promise<Finished> {
  const { provider } = opts;
  const key = await requireKey(userId, provider);
  const res = await fetch(`${PROVIDERS[provider].baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({
      model: opts.model,
      messages: toOpenAiMessages(opts.system, opts.messages),
      ...(opts.tools.length ? { tools: toOpenAiTools(opts.tools, provider) } : {}),
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal: opts.signal,
    cache: 'no-store',
  });
  noteCall(userId, provider, outcomeOf(res.status), res.headers);
  if (!res.ok || !res.body) throw new ProviderError(provider, res.status, await errorMessage(res));
  const state = emptyState();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const line = (l: string) => {
    if (!l.startsWith('data:')) return;
    const data = l.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let chunk: OaiChunk & { error?: { message?: string } };
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    if (chunk.error) throw new ProviderError(provider, 500, String(chunk.error.message ?? 'stream error'));
    const shown = foldChunk(state, chunk);
    if (shown.toolStarted) onTool(shown.toolStarted);
    if (shown.text) onText(shown.text);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      line(buf.slice(0, nl).replace(/\r$/, ''));
      buf = buf.slice(nl + 1);
    }
  }
  if (buf) line(buf);
  return finish(state, provider, () => `call_${randomBytes(9).toString('base64url')}`);
}

/** Models the user's key can use, for the model picker. */
export async function listModels(userId: string, provider: ProviderId): Promise<string[]> {
  const key = await requireKey(userId, provider);
  if (provider === 'anthropic') {
    const ids: string[] = [];
    for await (const m of new Anthropic({ apiKey: key }).models.list()) ids.push(m.id);
    return ids.sort();
  }
  const res = await fetch(`${PROVIDERS[provider].baseUrl}/models`, { headers: { authorization: `Bearer ${key}` }, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new ProviderError(provider, res.status, await errorMessage(res));
  return chatModelIds(await res.json());
}

/**
 * The advisor on OpenAI-compatible Chat Completions (ChatGPT, Gemini, Grok, DeepSeek).
 * Conversations are stored in the Messages API shape the chat view reads (text, tool_use,
 * tool_result blocks); each assistant message also keeps the provider's own message
 * (`openai_message`) so it goes back exactly as received, with any provider extras such
 * as Gemini's thought signatures. Pure; the service does the HTTP.
 */
import type { ProviderId } from './ai-providers';
import type { UsageLike } from './ai';

export interface StoredMessage {
  role: string;
  content: unknown;
}

type Block = { type: string; [k: string]: unknown };

export interface OaiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  [extra: string]: unknown;
}

export type OaiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OaiToolCall[]; [extra: string]: unknown }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OaiTool {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

const blocksOf = (content: unknown): Block[] => (typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? (content as Block[]) : []);

/** Stored conversation -> Chat Completions messages. */
export function toOpenAiMessages(system: string, stored: StoredMessage[]): OaiMessage[] {
  const out: OaiMessage[] = [{ role: 'system', content: system }];
  for (const m of stored) {
    const blocks = blocksOf(m.content);
    if (m.role === 'user') {
      const texts = blocks.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string);
      if (texts.length) out.push({ role: 'user', content: texts.join('\n\n') });
      for (const b of blocks) {
        if (b.type !== 'tool_result') continue;
        const c = b.content;
        const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: { text?: string }) => x.text ?? '').join('') : '';
        out.push({ role: 'tool', tool_call_id: String(b.tool_use_id), content: b.is_error ? `ERROR: ${text}` : text });
      }
      continue;
    }
    const native = blocks.find((b) => b.type === 'openai_message');
    if (native) {
      out.push(native.message as OaiMessage);
      continue;
    }
    // A message that never went through this adapter: rebuild it from the blocks
    const text = blocks.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('');
    const calls = blocks
      .filter((b) => b.type === 'tool_use')
      .map((b): OaiToolCall => ({ id: String(b.id), type: 'function', function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) } }));
    out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
  }
  return out;
}

/** JSON Schema keywords some providers reject; dropping them only loosens validation. */
function cleanSchema(schema: unknown, provider: ProviderId): unknown {
  if (Array.isArray(schema)) return schema.map((s) => cleanSchema(s, provider));
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === '$schema') continue;
    if (provider === 'gemini' && k === 'additionalProperties') continue;
    out[k] = cleanSchema(v, provider);
  }
  return out;
}

export function toOpenAiTools(defs: { name: string; description?: string; input_schema: unknown }[], provider: ProviderId): OaiTool[] {
  return defs.map((d) => ({ type: 'function', function: { name: d.name, description: d.description ?? '', parameters: cleanSchema(d.input_schema, provider) } }));
}

// ---------------------------------------------------------------- streaming

/** One streamed chunk (`data:` line) of a Chat Completions response. */
export interface OaiChunk {
  model?: string;
  choices?: {
    delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: ({ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } } & Record<string, unknown>)[] };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null } | null;
}

export interface StreamState {
  model: string | null;
  text: string;
  reasoning: string;
  calls: { id: string; name: string; args: string; extra: Record<string, unknown> }[];
  finish: string | null;
  usage: OaiChunk['usage'] | null;
}

export const emptyState = (): StreamState => ({ model: null, text: '', reasoning: '', calls: [], finish: null, usage: null });

/** Folds a chunk into the state; returns what to show (new text, a tool that started). */
export function foldChunk(s: StreamState, chunk: OaiChunk): { text?: string; toolStarted?: string } {
  if (chunk.model) s.model = chunk.model;
  if (chunk.usage) s.usage = chunk.usage;
  const shown: { text?: string; toolStarted?: string } = {};
  for (const c of chunk.choices ?? []) {
    if (c.finish_reason) s.finish = c.finish_reason;
    const d = c.delta;
    if (!d) continue;
    if (d.content) {
      s.text += d.content;
      shown.text = (shown.text ?? '') + d.content;
    }
    if (d.reasoning_content) s.reasoning += d.reasoning_content;
    for (const t of d.tool_calls ?? []) {
      const i = t.index ?? s.calls.length;
      if (!s.calls[i]) {
        s.calls[i] = { id: '', name: '', args: '', extra: {} };
      }
      const call = s.calls[i];
      if (t.id) call.id = t.id;
      if (t.function?.name) {
        if (!call.name) shown.toolStarted = t.function.name;
        call.name += t.function.name;
      }
      if (t.function?.arguments) call.args += t.function.arguments;
      // Provider extras on a call (Gemini's thought signature) must go back unchanged
      for (const [k, v] of Object.entries(t)) if (!['index', 'id', 'type', 'function'].includes(k)) call.extra[k] = v;
    }
  }
  return shown;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';

export interface Finished {
  /** What is stored: Messages-API-shaped blocks plus the provider's own message */
  content: Block[];
  toolUses: { id: string; name: string; input: unknown }[];
  stop: StopReason;
  usage: UsageLike;
  model: string | null;
}

/** The completed response. `newId` names a tool call the provider sent without an id. */
export function finish(s: StreamState, provider: ProviderId, newId: () => string): Finished {
  const calls = s.calls.filter(Boolean).filter((c) => c.name);
  for (const c of calls) if (!c.id) c.id = newId();
  const toolUses = calls.map((c) => {
    let input: unknown = c.args;
    try {
      input = c.args.trim() ? JSON.parse(c.args) : {};
    } catch {
      // left as the raw text: the tool reports it as invalid input
    }
    return { id: c.id, name: c.name, input };
  });
  const native: Record<string, unknown> = { role: 'assistant', content: s.text || null };
  if (calls.length) native.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' }, ...c.extra }));
  // DeepSeek's thinking mode needs its reasoning back while a tool loop runs
  if (provider === 'deepseek' && s.reasoning) native.reasoning_content = s.reasoning;
  const content: Block[] = [...(s.text ? [{ type: 'text', text: s.text }] : []), ...toolUses.map((t) => ({ type: 'tool_use', ...t })), { type: 'openai_message', message: native }];
  const stop: StopReason = toolUses.length ? 'tool_use' : s.finish === 'length' ? 'max_tokens' : s.finish === 'content_filter' ? 'refusal' : 'end_turn';
  const cached = s.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const usage: UsageLike = { input_tokens: Math.max(0, (s.usage?.prompt_tokens ?? 0) - cached), cache_read_input_tokens: cached, output_tokens: s.usage?.completion_tokens ?? 0 };
  return { content, toolUses, stop: s.finish === 'length' && toolUses.length ? 'max_tokens' : stop, usage, model: s.model };
}

/** Model ids from a /models listing, without embedding, image, audio and other non-chat models. */
export function chatModelIds(body: unknown): string[] {
  const data = (body as { data?: unknown; models?: unknown })?.data ?? (body as { models?: unknown })?.models;
  if (!Array.isArray(data)) return [];
  const ids = data.map((m: { id?: unknown; name?: unknown }) => String(m.id ?? m.name ?? '').replace(/^models\//, '')).filter(Boolean);
  const skip = /embed|tts|whisper|dall-e|image|imagen|veo|audio|moderation|transcribe|realtime|sora|babbage|davinci|aqa|banana/i;
  return [...new Set(ids.filter((id) => !skip.test(id)))].sort();
}

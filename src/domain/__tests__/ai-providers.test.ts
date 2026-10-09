import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chatModelIds, emptyState, finish, foldChunk, toOpenAiMessages, toOpenAiTools } from '../ai-openai';
import { choiceLabel, claudeHasDynamicWebTools, claudeHasFallbacks, isModelId, modelFor, readAgentModels, type ProviderId } from '../ai-providers';

describe('ai providers', () => {
  const keys = (...ps: ProviderId[]) => (p: ProviderId) => ps.includes(p);

  it('uses the pick when its company has a key, else Claude, else any company with a key', () => {
    const picks = { RESEARCH: { provider: 'openai' as const, model: 'gpt-6-astra' } };
    assert.deepEqual(modelFor('RESEARCH', picks, keys('anthropic', 'openai')), { provider: 'openai', model: 'gpt-6-astra' });
    assert.deepEqual(modelFor('RESEARCH', picks, keys('anthropic')), { provider: 'anthropic', model: 'claude-opus-5-5' });
    assert.deepEqual(modelFor('MANAGER', picks, keys('gemini')), { provider: 'gemini', model: 'gemini-3.1-pro-preview' });
    assert.equal(modelFor('MANAGER', picks, keys()), null);
  });

  it('reads stored picks defensively', () => {
    assert.deepEqual(readAgentModels({ MANAGER: { provider: 'xai', model: 'grok-4.7' }, COACH: { provider: 'nope', model: 'x' }, SAGE: { provider: 'openai', model: 'bad model!' } }), { MANAGER: { provider: 'xai', model: 'grok-4.7' } });
    assert.deepEqual(readAgentModels(null), {});
    assert.equal(isModelId('models/gemini-3.8-flash'), true);
    assert.equal(isModelId(''), false);
  });

  it('labels and Claude feature checks', () => {
    assert.equal(choiceLabel({ provider: 'anthropic', model: 'claude-opus-5-5' }), 'Claude (Anthropic) · Claude Opus 5.5');
    assert.equal(choiceLabel({ provider: 'openai', model: 'gpt-x' }), 'ChatGPT (OpenAI) · gpt-x');
    assert.equal(claudeHasDynamicWebTools('claude-sonnet-5-5'), true);
    assert.equal(claudeHasDynamicWebTools('claude-haiku-5-5'), false);
    assert.equal(claudeHasFallbacks('claude-fable-5-1'), true);
    assert.equal(claudeHasFallbacks('claude-haiku-5-5'), false);
  });
});

describe('chat completions adapter', () => {
  it('turns a stored conversation into Chat Completions messages', () => {
    const native = { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_quote', arguments: '{"symbols":["AAPL"]}' }, extra_content: { google: { thought_signature: 's' } } }] };
    const out = toOpenAiMessages('SYS', [
      { role: 'user', content: [{ type: 'text', text: '<page-context>\n오늘\n</page-context>' }, { type: 'text', text: '애플 어때?' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'get_quote', input: {} }, { type: 'openai_message', message: native }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"price":1}' }, { type: 'tool_result', tool_use_id: 'c2', content: 'nope', is_error: true }] },
      { role: 'assistant', content: [{ type: 'text', text: '좋아요' }, { type: 'tool_use', id: 'c3', name: 'x', input: { a: 1 } }] },
    ]);
    assert.deepEqual(out[0], { role: 'system', content: 'SYS' });
    assert.deepEqual(out[1], { role: 'user', content: '<page-context>\n오늘\n</page-context>\n\n애플 어때?' });
    assert.deepEqual(out[2], native);
    assert.deepEqual(out[3], { role: 'tool', tool_call_id: 'c1', content: '{"price":1}' });
    assert.deepEqual(out[4], { role: 'tool', tool_call_id: 'c2', content: 'ERROR: nope' });
    assert.deepEqual(out[5], { role: 'assistant', content: '좋아요', tool_calls: [{ id: 'c3', type: 'function', function: { name: 'x', arguments: '{"a":1}' } }] });
  });

  it('drops schema keywords providers reject', () => {
    const schema = { $schema: 'x', type: 'object', additionalProperties: false, properties: { a: { type: 'object', additionalProperties: false } } };
    const [o] = toOpenAiTools([{ name: 't', description: 'd', input_schema: schema }], 'openai');
    assert.deepEqual(o.function.parameters, { type: 'object', additionalProperties: false, properties: { a: { type: 'object', additionalProperties: false } } });
    const [g] = toOpenAiTools([{ name: 't', input_schema: schema }], 'gemini');
    assert.deepEqual(g.function.parameters, { type: 'object', properties: { a: { type: 'object' } } });
  });

  it('assembles a streamed answer with tool calls and keeps provider extras', () => {
    const s = emptyState();
    assert.deepEqual(foldChunk(s, { model: 'gemini-3.8-flash', choices: [{ delta: { content: '확인할게요' } }] }), { text: '확인할게요' });
    assert.deepEqual(foldChunk(s, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_quote', arguments: '{"sym' }, extra_content: { google: { thought_signature: 'sig' } } }] } }] }), { toolStarted: 'get_quote' });
    foldChunk(s, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'bols":["AAPL"]}' } }, { index: 1, function: { name: 'list_portfolios', arguments: '' } }] }, finish_reason: 'tool_calls' }] });
    foldChunk(s, { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 } } });
    const f = finish(s, 'gemini', () => 'gen1');
    assert.equal(f.stop, 'tool_use');
    assert.deepEqual(f.toolUses, [
      { id: 'call_1', name: 'get_quote', input: { symbols: ['AAPL'] } },
      { id: 'gen1', name: 'list_portfolios', input: {} },
    ]);
    assert.deepEqual(f.usage, { input_tokens: 200, cache_read_input_tokens: 800, output_tokens: 50 });
    const native = f.content.at(-1) as { type: string; message: { tool_calls: Record<string, unknown>[] } };
    assert.equal(native.type, 'openai_message');
    assert.deepEqual(native.message.tool_calls[0].extra_content, { google: { thought_signature: 'sig' } });
    assert.equal(native.message.tool_calls[1].id, 'gen1');
    assert.equal(f.model, 'gemini-3.8-flash');
  });

  it('maps finish reasons and keeps bad tool JSON for the tool to reject', () => {
    const s = emptyState();
    foldChunk(s, { choices: [{ delta: { content: '...' }, finish_reason: 'length' }] });
    assert.equal(finish(s, 'openai', () => 'x').stop, 'max_tokens');
    const r = emptyState();
    foldChunk(r, { choices: [{ delta: { reasoning_content: '생각', tool_calls: [{ index: 0, id: 'a', function: { name: 't', arguments: '{bad' } }] } }] });
    const f = finish(r, 'deepseek', () => 'x');
    assert.equal(f.toolUses[0].input, '{bad');
    const reasoning = (x: { content: unknown[] }) => (x.content.at(-1) as { message: { reasoning_content?: string } }).message.reasoning_content;
    assert.equal(reasoning(f), '생각');
    assert.equal(reasoning(finish(r, 'openai', () => 'x')), undefined);
  });

  it('lists chat models only', () => {
    assert.deepEqual(chatModelIds({ data: [{ id: 'gpt-6-astra' }, { id: 'text-embedding-3-large' }, { id: 'models/gemini-3.8-flash' }, { id: 'gpt-6-astra' }] }), ['gemini-3.8-flash', 'gpt-6-astra']);
  });
});

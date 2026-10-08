import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { conversationTitle, costUsd, monthStartKst, toChat, userContent } from '../ai';

describe('ai cost', () => {
  it('prices tokens, cache and web searches', () => {
    const c = costUsd(
      { input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000, server_tool_use: { web_search_requests: 3 } },
      'claude-opus-5-5',
    );
    assert.equal(c.toFixed(4), (4 + 2 + 0.2 + 0.03).toFixed(4));
  });

  it('prices a fallback model at its own rate, unknown models at the default', () => {
    assert.equal(costUsd({ output_tokens: 1_000_000 }, 'claude-opus-4-8'), 25);
    assert.equal(costUsd({ output_tokens: 1_000_000 }, 'something-else'), 20);
  });

  it('starts the month in Korean time', () => {
    // 2026-10-31 16:00 UTC is already 11월 1일 in Korea
    assert.equal(monthStartKst(new Date('2026-10-31T16:00:00Z')).toISOString(), '2026-10-31T15:00:00.000Z');
    assert.equal(monthStartKst(new Date('2026-10-08T03:00:00Z')).toISOString(), '2026-09-30T15:00:00.000Z');
  });
});

describe('ai chat view', () => {
  it('hides the page context and folds one agent run into one turn', () => {
    const turns = toChat([
      { role: 'user', content: userContent('내 포트폴리오 점검해 줘', '종목 화면: 삼성전자') },
      { role: 'assistant', content: [{ type: 'text', text: '확인해 볼게요.' }, { type: 'tool_use', id: 't1', name: 'get_portfolio_overview', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] },
      {
        role: 'assistant',
        content: [
          { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: '삼성전자 실적' } },
          { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
          { type: 'text', text: '실적은 ', citations: null },
          { type: 'text', text: '좋았습니다.', citations: [{ type: 'web_search_result_location', url: 'https://ex.com/a', title: '기사' }] },
          { type: 'tool_use', id: 't2', name: 'propose_note', input: { body: 'x' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] },
      { role: 'assistant', content: [{ type: 'text', text: '메모를 제안했어요.' }] },
      { role: 'user', content: '고마워' },
    ]);
    assert.equal(turns.length, 3);
    assert.deepEqual(turns[0], { role: 'user', text: '내 포트폴리오 점검해 줘' });
    const a = turns[1];
    assert.ok(a.role === 'assistant');
    assert.deepEqual(
      a.parts.map((p) => p.kind),
      ['text', 'tool', 'search', 'text', 'action', 'text'],
    );
    assert.deepEqual(a.parts[3], { kind: 'text', text: '실적은 좋았습니다.' });
    assert.deepEqual(a.parts[2], { kind: 'search', query: '삼성전자 실적' });
    assert.deepEqual(a.parts[4], { kind: 'action', toolUseId: 't2' });
    assert.deepEqual(a.sources, [{ url: 'https://ex.com/a', title: '기사' }]);
    assert.deepEqual(turns[2], { role: 'user', text: '고마워' });
  });

  it('titles a conversation from the first line', () => {
    assert.equal(conversationTitle('  목표 비중 점검\n자세히'), '목표 비중 점검');
    assert.equal(conversationTitle('가'.repeat(50)).length, 40);
  });
});

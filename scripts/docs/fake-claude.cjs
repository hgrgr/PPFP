/**
 * Fake Anthropic Messages API for documentation screenshots (loaded by fake-market.cjs).
 *
 * Answers streamed POST https://api.anthropic.com/v1/messages with a short scripted run of
 * the advisor agent: it calls the app's read tools, does one (fake) web search, writes an
 * analysis built from the numbers the tools returned, and proposes one change. Nothing
 * here is model output or real news; the articles and URLs are made up.
 */
'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const id = (p) => `${p}_demo${String(++seq).padStart(6, '0')}`;

/** A scripted assistant message -> SSE events, the way the API streams them. */
function events(model, blocks, stop, usage) {
  const out = [];
  const ev = (type, data) => out.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { id: id('msg'), type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: usage.cached } } });
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      ev('content_block_start', { index, content_block: { type: 'text', text: '', ...(b.citations ? { citations: [] } : {}) } });
      for (const c of b.citations ?? []) ev('content_block_delta', { index, delta: { type: 'citations_delta', citation: c } });
      for (const piece of b.text.match(/[\s\S]{1,24}/g) ?? []) ev('content_block_delta', { index, delta: { type: 'text_delta', text: piece } });
    } else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
      ev('content_block_start', { index, content_block: { type: b.type, id: b.id, name: b.name, input: {} } });
      ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    } else {
      ev('content_block_start', { index, content_block: b });
    }
    ev('content_block_stop', { index });
  });
  ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output, ...(usage.searches ? { server_tool_use: { web_search_requests: usage.searches } } : {}) } });
  ev('message_stop', {});
  return out;
}

const text = (t, citations) => ({ type: 'text', text: t, ...(citations ? { citations } : {}) });
const call = (name, input) => ({ type: 'tool_use', id: id('toolu'), name, input });
const won = (v) => `₩${Math.round(v / 10_000).toLocaleString('ko-KR')}만`;
const p1 = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}%`);

function toolResults(messages) {
  const byId = new Map();
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_use') byId.set(b.id, b.name);
  }
  const out = {};
  for (const m of messages) {
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== 'tool_result') continue;
      try {
        out[byId.get(b.tool_use_id)] = JSON.parse(typeof b.content === 'string' ? b.content : b.content?.[0]?.text ?? 'null');
      } catch {}
    }
  }
  return out;
}

function lastTurn(messages) {
  let i = messages.length - 1;
  while (i > 0 && !(messages[i].role === 'user' && Array.isArray(messages[i].content) && messages[i].content.some((b) => b.type === 'text' && !b.text.startsWith('<page-context>')))) i--;
  return messages.slice(i);
}

const ARTICLE = {
  url: 'https://news.example.com/semiconductor-2026q3',
  title: '[가상 기사] 메모리 업황 회복, 3분기 반도체 실적 개선 전망',
};

function stockScript(turn, results, name, symbol) {
  const done = turn.filter((m) => m.role === 'assistant').length;
  if (done === 0) {
    return { blocks: [text(`${name}의 보유 기록과 지금 시세를 확인할게요.`), call('get_holding', { asset: symbol }), call('get_quote', { symbols: [symbol] })], stop: 'tool_use', usage: { input: 9900, cached: 0, output: 120 } };
  }
  if (done === 1) {
    const h = results.get_holding ?? { holdings: [], journals: [], traits: [], linkedSages: [] };
    const q = (results.get_quote ?? [])[0]?.quote;
    const price = q ? Number(q.price) : null;
    const lots = h.holdings.flatMap((x) => x.lots);
    const qty = lots.reduce((s2, l) => s2 + Number(l.qty), 0);
    const cost = lots.reduce((s2, l) => s2 + Number(l.qty) * Number(l.unitCost), 0);
    const avg = qty ? cost / qty : null;
    const j = h.journals.find((x) => x.status === 'OPEN');
    const fmt = (v) => (v === null ? '—' : `₩${Math.round(v).toLocaleString('ko-KR')}`);
    const search = { type: 'server_tool_use', id: id('srvtoolu'), name: 'web_search', input: { query: `${name} 실적 전망` } };
    const result = { type: 'web_search_tool_result', tool_use_id: search.id, content: [{ type: 'web_search_result', url: ARTICLE.url, title: ARTICLE.title, encrypted_content: 'demo', page_age: '2026-10-06' }] };
    const cite = { type: 'web_search_result_location', url: ARTICLE.url, title: ARTICLE.title, cited_text: '메모리 가격 반등으로 3분기 실적 개선이 예상된다', encrypted_index: 'demo' };
    const lines = [
      `## ${name} 점검`,
      `| 항목 | 값 |`,
      `| --- | ---: |`,
      `| 보유 | ${qty.toLocaleString('ko-KR')}주 · 평균 ${fmt(avg)} |`,
      `| 현재가 | ${fmt(price)}${price && avg ? ` (${price >= avg ? '+' : ''}${(((price - avg) / avg) * 100).toFixed(1)}%)` : ''} |`,
      j ? `| 일지 목표가 | ${fmt(Number(j.targetPrice))} · 남은 거리 ${price ? `${(((Number(j.targetPrice) - price) / price) * 100).toFixed(1)}%` : '—'} |` : `| 일지 | 아직 없음 |`,
      ``,
      `- **성질**: ${h.traits.join(', ') || '지정 안 됨'}.`,
      `- **연결된 투자 철학**: ${h.linkedSages.map((x) => `${x.name}(${x.via})`).join(', ') || '없음'}. 가치주로 분류해 두셨으니 가격이 가치보다 충분히 싼지가 판단 기준입니다.`,
    ].join('\n');
    return {
      blocks: [
        search,
        result,
        text(lines + '\n\n업황은 '),
        text('메모리 가격 반등으로 3분기 실적 개선이 예상된다는 전망이 있습니다', [cite]),
        text('. 목표가까지는 여유가 있지만 이미 기대가 반영됐을 수 있어, 더 산다면 가격이 내려올 때 나눠 사는 편이 안전합니다. 아래 가격 알림을 제안합니다.'),
        call('propose_price_alert', { asset: symbol, price: 80000, direction: 'BELOW', note: '분할 매수 검토' }),
      ],
      stop: 'tool_use',
      usage: { input: 2100, cached: 9900, output: 560, searches: 1 },
    };
  }
  return { blocks: [text('확인 카드의 **실행**을 누르면 알림이 만들어집니다.')], stop: 'end_turn', usage: { input: 500, cached: 12000, output: 30 } };
}

function managerScript(turn, results) {
  const asked = turn[0].content.filter((b) => b.type === 'text').at(-1).text;
  const done = turn.filter((m) => m.role === 'assistant').length;
  const ctx = turn[0].content.find((b) => b.type === 'text' && b.text.startsWith('<page-context>'))?.text ?? '';
  const stock = ctx.match(/종목 화면: (.+?)\((\w+)\)/);
  if (stock) return stockScript(turn, results, stock[1], stock[2]);
  if (done === 0) {
    return { blocks: [text('포트폴리오 평가와 목표 비중을 함께 확인해 볼게요.'), call('get_portfolio_overview', {}), call('get_target_drift', {})], stop: 'tool_use', usage: { input: 9800, cached: 0, output: 160 } };
  }
  if (done === 1) {
    const o = results.get_portfolio_overview ?? { holdings: [], totalKrw: 0, period: {} };
    const d = (results.get_target_drift?.portfolios ?? [])[0];
    const top = o.holdings.slice(0, 5);
    const out = d ? d.rows.filter((r) => r.outOfBand) : [];
    const search = { type: 'server_tool_use', id: id('srvtoolu'), name: 'web_search', input: { query: '반도체 3분기 실적 전망 2026' } };
    const result = { type: 'web_search_tool_result', tool_use_id: search.id, content: [{ type: 'web_search_result', url: ARTICLE.url, title: ARTICLE.title, encrypted_content: 'demo', page_age: '2026-10-06' }] };
    const cite = { type: 'web_search_result_location', url: ARTICLE.url, title: ARTICLE.title, cited_text: '메모리 가격 반등으로 3분기 실적 개선이 예상된다', encrypted_index: 'demo' };
    const lines = [
      `## 요약`,
      `순자산은 **${won(o.totalKrw)}**, 최근 1년 시간가중수익률은 **${p1(o.period.twrPct)}**(최대 낙폭 ${p1(o.period.maxDrawdownPct)})입니다. 가장 먼저 볼 점 세 가지입니다.`,
      ``,
      `| 종목 | 비중 | 평가손익 |`,
      `| --- | ---: | ---: |`,
      ...top.map((h) => `| ${h.name} | ${p1(h.weightPct)} | ${h.returnPct === null ? '—' : `${h.returnPct > 0 ? '+' : ''}${h.returnPct.toFixed(1)}%`} |`),
      ``,
      `1. **집중** — 상위 ${top.length}종목이 ${p1(top.reduce((s, h) => s + (h.weightPct ?? 0), 0))}를 차지합니다. ${top[0] ? `${top[0].name} 한 종목이 ${p1(top[0].weightPct)}입니다.` : ''}`,
      d
        ? `2. **목표 비중 이탈** — '${d.portfolio}'에서 ${out.length ? out.map((r) => `${r.label} ${p1(r.sharePct)}(목표 ${p1(r.targetPct)})`).join(', ') : '허용 오차를 벗어난 항목은 없습니다'}${out.length ? `. 목표대로 맞추려면 ${out.map((r) => `${r.label} ${r.tradeKrw > 0 ? '매수' : '매도'} ${won(Math.abs(r.tradeKrw))}`).join(', ')}입니다.` : '.'}`
        : `2. **목표 비중** — 아직 목표를 정한 포트폴리오가 없습니다. 포트폴리오 화면에서 목표를 정하면 이탈을 알려 드립니다.`,
      `3. **반도체 비중** — 반도체 종목의 다음 실적 발표 전에 근거를 다시 확인해 두세요.`,
    ].join('\n');
    return {
      blocks: [
        search,
        result,
        text(lines + '\n\n최근 기사로는 '),
        text('메모리 가격 반등으로 3분기 실적 개선이 예상된다는 전망이 있습니다', [cite]),
        text('. 다만 기대가 이미 주가에 반영됐을 수 있어, 추가 매수는 분할로 하는 편이 안전합니다.\n\n아래처럼 하락 시 분할 매수를 검토할 가격 알림을 제안합니다. 최종 판단은 직접 해 주세요.'),
        call('propose_price_alert', { asset: '005930', price: 80000, direction: 'BELOW', note: '분할 매수 검토' }),
      ],
      stop: 'tool_use',
      usage: { input: 2400, cached: 9800, output: 820, searches: 1 },
    };
  }
  return { blocks: [text(`확인 카드의 **실행**을 누르면 알림이 만들어집니다. ${asked.length > 0 ? '더 궁금한 종목이 있으면 이어서 물어보세요.' : ''}`)], stop: 'end_turn', usage: { input: 600, cached: 12200, output: 60 } };
}

function sageScript(turn, results, first) {
  const done = turn.filter((m) => m.role === 'assistant').length;
  const ctx = first.content.find((b) => b.type === 'text' && b.text.startsWith('<page-context>'))?.text ?? '';
  let sage = { name: '거장', fittingAssets: [], traits: [], keywords: [] };
  try {
    sage = JSON.parse(ctx.slice(ctx.indexOf('{'), ctx.lastIndexOf('}') + 1));
  } catch {}
  if (done === 0) {
    return { blocks: [text(`${sage.name}의 관점으로 보려면 보유 종목과 자산 성질을 먼저 확인할게요.`), call('get_portfolio_overview', {}), call('get_trait_allocation', {})], stop: 'tool_use', usage: { input: 10400, cached: 0, output: 140 } };
  }
  if (done === 1) {
    const o = results.get_portfolio_overview ?? { holdings: [] };
    const fit = new Set(sage.fittingAssets.map((a) => a.name));
    const rows = o.holdings.slice(0, 6).map((h) => `| ${h.name} | ${p1(h.weightPct)} | ${fit.has(h.name) ? '맞음' : '판단 보류'} |`);
    const lines = [
      `${sage.name}의 관점에서 보면, 핵심은 **${sage.keywords.slice(0, 2).join('·') || '철학'}**입니다. 투자 노트에 정리한 자산 성질(${sage.traits.join(', ') || '없음'})로 지정한 종목을 기준으로 내 포트폴리오를 나눠 봤습니다.`,
      ``,
      `| 종목 | 비중 | 이 철학과 |`,
      `| --- | ---: | --- |`,
      ...rows,
      ``,
      `- **잘 맞는 종목**: ${[...fit].join(', ') || '아직 없습니다. 자산 성질에서 종목의 성질을 지정해 보세요'}.`,
      `- **하지 않을 행동**: 이해하지 못하는 자산을 유행 때문에 늘리는 것, 가격이 올랐다는 이유만으로 사는 것.`,
      `- **점검 질문**: 지금 가격이 내가 추정한 가치보다 충분히 싼가? 10년 뒤에도 이 회사를 갖고 싶은가?`,
      ``,
      `이 점검 내용을 투자 노트에 메모로 남겨 두길 제안합니다.`,
    ].join('\n');
    return { blocks: [text(lines), call('propose_note', { body: `${sage.name} 관점 점검: 맞는 종목 ${[...fit].join(', ') || '없음'}. 매수 전 가치 대비 가격을 일지에 적기 #${(sage.keywords[0] ?? '투자원칙').replace(/ /g, '_')}`, assets: [] })], stop: 'tool_use', usage: { input: 3100, cached: 10400, output: 640 } };
  }
  return { blocks: [text('확인 카드에서 **실행**을 누르면 메모가 투자 노트에 저장됩니다.')], stop: 'end_turn', usage: { input: 500, cached: 13500, output: 40 } };
}

async function messages(init) {
  const body = JSON.parse(String(init?.body ?? '{}'));
  const system = Array.isArray(body.system) ? body.system.map((b) => b.text).join('') : String(body.system ?? '');
  const turn = lastTurn(body.messages);
  const results = toolResults(turn);
  const script = system.includes('렌즈') ? sageScript(turn, results, body.messages[0]) : managerScript(turn, results);
  const chunks = events(body.model, script.blocks, script.stop, script.usage);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      for (const ch of chunks) {
        c.enqueue(enc.encode(ch));
        await sleep(12);
      }
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'request-id': id('req') } });
}

const prevFetch = globalThis.fetch;
globalThis.fetch = async function claudeDemoFetch(input, init) {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return prevFetch(input, init);
  }
  if (url.hostname !== 'api.anthropic.com') return prevFetch(input, init);
  if (url.pathname === '/v1/messages' && init?.method === 'POST') return messages(init);
  return new Response(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: `데모 서버에 없는 요청: ${url.pathname}` } }), { status: 404, headers: { 'content-type': 'application/json' } });
};

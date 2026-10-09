/**
 * Fake Anthropic Messages API for documentation screenshots (loaded by fake-market.cjs), and
 * fake Chat Completions endpoints for the other AI companies (OpenAI, Gemini, xAI, DeepSeek).
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

function briefingScript(turn, results) {
  const done = turn.filter((x) => x.role === 'assistant').length;
  if (done === 0) {
    return { blocks: [text('지난 1주 포트폴리오와 목표 비중, 진행 중인 일지를 확인하고 이번 주 일정을 찾아볼게요.'), call('get_portfolio_overview', { period: '1M' }), call('get_target_drift', {}), call('get_journals', { status: 'OPEN' })], stop: 'tool_use', usage: { input: 10100, cached: 0, output: 150 } };
  }
  if (done === 1) {
    const o = results.get_portfolio_overview ?? { holdings: [], period: {} };
    const d = (results.get_target_drift?.portfolios ?? [])[0];
    const out = d ? d.rows.filter((r) => r.outOfBand) : [];
    const js = (results.get_journals ?? []).filter((j) => j.progressPct !== null).sort((a, b) => (b.progressPct ?? 0) - (a.progressPct ?? 0));
    const s1 = { type: 'server_tool_use', id: id('srvtoolu'), name: 'web_search', input: { query: '이번 주 실적 발표 일정 애플 엔비디아 삼성전자' } };
    const art = { url: 'https://news.example.com/earnings-week', title: '[가상 기사] 이번 주 실적 발표 일정 정리' };
    const res = { type: 'web_search_tool_result', tool_use_id: s1.id, content: [{ type: 'web_search_result', url: art.url, title: art.title, encrypted_content: 'demo', page_age: '2026-10-07' }] };
    const cite = { type: 'web_search_result_location', url: art.url, title: art.title, cited_text: '이번 주 실적 발표', encrypted_index: 'demo' };
    const top = o.holdings.slice(0, 3);
    const lines = [
      `## 오늘의 요약`,
      `순자산 **${won(o.totalKrw)}**, 최근 1개월 ${p1(o.period.twrPct)}. ${top.map((h) => `${h.name} ${h.returnPct === null ? '' : `${h.returnPct > 0 ? '+' : ''}${h.returnPct.toFixed(1)}%`}`).join(', ')}.`,
      ``,
      `## 살펴볼 곳`,
      `- **목표 비중**: ${out.length ? out.map((r) => `${r.label} ${p1(r.sharePct)}(목표 ${p1(r.targetPct)})`).join(', ') : '모두 허용 오차 안입니다'}.`,
      `- **일지 목표가**: ${js.slice(0, 2).map((j) => `${j.asset} ${j.progressPct.toFixed(0)}% 진행`).join(', ') || '가까운 일지가 없습니다'}.`,
      `- **이번 주 일정**: `,
    ].join('\n');
    return {
      blocks: [
        s1,
        res,
        text(lines),
        text('보유 종목 중 두 곳의 실적 발표가 이번 주에 있습니다', [cite]),
        text(`.\n\n## 오늘 할 일\n1. ${out[0] ? `${out[0].label} 비중 조정 계획 세우기` : '목표 비중 확인'}\n2. 실적 발표 전 해당 종목 일지의 근거 다시 읽기\n3. 새 거래가 있으면 일지 남기기`),
      ],
      stop: 'end_turn',
      usage: { input: 2600, cached: 10100, output: 520, searches: 1 },
    };
  }
  return { blocks: [text('좋은 하루 보내세요.')], stop: 'end_turn', usage: { input: 300, cached: 12000, output: 10 } };
}

function alertScript(turn, results, asked) {
  const done = turn.filter((x) => x.role === 'assistant').length;
  const name = (asked.match(/"(.+?)"/)?.[1] ?? '').split(' ')[0];
  if (done === 0) {
    return { blocks: [text(`${name} 알림을 확인할게요.`), call('get_holding', { asset: name })], stop: 'tool_use', usage: { input: 9700, cached: 0, output: 90 } };
  }
  const h = results.get_holding ?? { journals: [], linkedSages: [] };
  const j = (h.journals ?? [])[0];
  return {
    blocks: [
      text(
        [
          `## ${name} 알림 분석`,
          `- 가격이 정한 값에 닿았습니다. 일지${j ? ` '${j.title}'의 목표가 ${j.targetPrice}` : ''} 기준으로 보면 계획한 구간입니다.`,
          `- 큰 뉴스는 없고 업종 전체가 함께 움직였습니다.`,
          `- **검토할 것**: 계획대로 분할 매수할지, 근거가 바뀌었는지 일지를 다시 읽어 보세요.`,
        ].join('\n'),
      ),
    ],
    stop: 'end_turn',
    usage: { input: 1800, cached: 9700, output: 260 },
  };
}

function managerScript(turn, results) {
  {
    const first = turn[0].content.filter((b) => b.type === 'text').at(-1).text;
    if (first.startsWith('오늘 아침 브리핑')) return briefingScript(turn, results);
    if (first.startsWith('알림이 왔어')) return alertScript(turn, results, first);
  }
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

const fmtNum = (v, cur) => (v === null || v === undefined ? '—' : cur === 'USD' ? `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `₩${Math.round(v).toLocaleString('ko-KR')}`);
const sign = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

function researchScript(turn, results) {
  const asked = turn[0].content.filter((b) => b.type === 'text').at(-1).text;
  const m = asked.match(/^(.+?)\(([A-Z0-9.-]+)\)/);
  const name = m ? m[1] : '엔비디아';
  const symbol = m ? m[2] : 'NVDA';
  const done = turn.filter((x) => x.role === 'assistant').length;
  if (done === 0) {
    return { blocks: [text(`${name}의 시세와 주가 흐름, 내 보유 기록을 먼저 확인하고 최근 실적 자료를 찾아볼게요.`), call('get_quote', { symbols: [symbol] }), call('get_price_history', { symbol }), call('get_holding', { asset: symbol })], stop: 'tool_use', usage: { input: 10800, cached: 0, output: 180 } };
  }
  if (done === 1) {
    const q = (results.get_quote ?? [])[0] ?? {};
    const cur = q.currency ?? 'USD';
    const ph = results.get_price_history ?? { returnPct: {} };
    const h = results.get_holding && !results.get_holding.error ? results.get_holding : null;
    const lots = h ? h.holdings.flatMap((x) => x.lots) : [];
    const qty = lots.reduce((s2, l) => s2 + Number(l.qty), 0);
    const art1 = { url: 'https://ir.example.com/q3-results', title: '[가상 자료] 3분기 실적 발표: 데이터센터 매출 사상 최대' };
    const art2 = { url: 'https://news.example.com/ai-capex-2027', title: '[가상 기사] 빅테크 내년 AI 설비 투자 계획 상향' };
    const s1 = { type: 'server_tool_use', id: id('srvtoolu'), name: 'web_search', input: { query: `${name} 3분기 실적 가이던스` } };
    const s2 = { type: 'server_tool_use', id: id('srvtoolu'), name: 'web_search', input: { query: 'AI 데이터센터 설비 투자 2027 전망' } };
    const r = (srv, art) => ({ type: 'web_search_tool_result', tool_use_id: srv.id, content: [{ type: 'web_search_result', url: art.url, title: art.title, encrypted_content: 'demo', page_age: '2026-10-02' }] });
    const cite = (art, t) => ({ type: 'web_search_result_location', url: art.url, title: art.title, cited_text: t, encrypted_index: 'demo' });
    const target = q.quote ? Math.round(Number(q.quote.price) * 1.18 * 100) / 100 : 220;
    const stop = q.quote ? Math.round(Number(q.quote.price) * 0.88 * 100) / 100 : 160;
    const head = [
      `## 한 줄 결론`,
      `성장은 이어지고 있지만 기대도 높습니다. 지금 가격에서는 **분할로 비중을 유지**하고, 실적 발표 전후 변동성에 대비하는 편이 낫습니다.`,
      ``,
      `## 주가 흐름`,
      `| 기간 | 수익률 |`,
      `| --- | ---: |`,
      ...['1M', '3M', '6M', '1Y'].map((k) => `| ${k} | ${sign(ph.returnPct[k])} |`),
      ``,
      `현재가 ${fmtNum(ph.close, cur)}는 52주 고가보다 ${sign(ph.fromHighPct)}, 20일 변동성은 연 ${ph.volatility20dAnnualPct ?? '—'}%입니다.`,
      ``,
      `## 최근 실적`,
    ].join('\n');
    return {
      blocks: [
        s1,
        r(s1, art1),
        s2,
        r(s2, art2),
        text(head + '\n'),
        text('데이터센터 매출이 사상 최대를 기록했고 다음 분기 가이던스도 시장 예상을 웃돌았습니다', [cite(art1, '데이터센터 매출 사상 최대')]),
        text('. 수요 쪽에서는 '),
        text('주요 클라우드 기업들이 내년 AI 설비 투자 계획을 올렸습니다', [cite(art2, '내년 AI 설비 투자 계획 상향')]),
        text(
          [
            '.',
            '',
            '## 리스크',
            '- 높은 밸류에이션: 성장 둔화 신호에 주가가 크게 흔들릴 수 있습니다.',
            '- 고객 집중: 소수 클라우드 기업의 투자 계획에 실적이 좌우됩니다.',
            '- 수출 규제와 공급망 이슈.',
            '',
            '## 내 포트폴리오에서',
            h ? `${qty.toLocaleString('ko-KR')}주를 보유 중이고, 자산 성질은 ${h.traits.slice(-2).join(', ')}입니다. 위성 비중 한도 안에서 관리하세요.` : '아직 보유하지 않은 종목입니다.',
            '',
            '검토용 매수 계획 일지 초안을 제안합니다.',
          ].join('\n'),
        ),
        call('propose_journal_draft', { symbol, title: `${name} 추가 매수 검토`, targetPrice: target, stopPrice: stop, basePrice: q.quote ? Number(q.quote.price) : undefined, body: '## 매수 근거\n- 데이터센터 수요 확대와 가이던스 상향\n## 시나리오\n- 실적 발표 후 조정 시 2회에 나눠 매수\n## 손절 조건\n- 가이던스 하향 또는 손절가 이탈' }),
      ],
      stop: 'tool_use',
      usage: { input: 5200, cached: 10800, output: 1100, searches: 2 },
    };
  }
  return { blocks: [text('확인 카드에서 **실행**을 누르면 매매일지 초안이 만들어집니다. 속성(진입 방식, 투자 기간 등)은 직접 채워 주세요.')], stop: 'end_turn', usage: { input: 600, cached: 16000, output: 50 } };
}

function coachScript(turn, results) {
  const ctx = turn[0].content.find((b) => b.type === 'text' && b.text.startsWith('<page-context>'))?.text ?? '';
  const jt = ctx.match(/매매일지 화면: '(.+?)'/);
  const done = turn.filter((x) => x.role === 'assistant').length;
  if (done === 0) {
    return {
      blocks: [text(jt ? `'${jt[1]}' 일지와 실제 매매 기록을 함께 볼게요.` : '실현된 매매와 진행 중인 일지를 함께 볼게요.'), call('get_trade_review', {}), jt ? call('get_journal', { journal: jt[1] }) : call('get_journals', { status: 'OPEN' })],
      stop: 'tool_use',
      usage: { input: 10200, cached: 0, output: 130 },
    };
  }
  if (done === 1) {
    const t = results.get_trade_review ?? {};
    const j = results.get_journal;
    const rows = [
      `| 지표 | 값 |`,
      `| --- | ---: |`,
      `| 실현 매도 | ${t.sells ?? 0}건 (이익 ${t.wins ?? 0} · 손실 ${t.losses ?? 0}) |`,
      `| 승률 | ${t.winRatePct ?? '—'}% |`,
      `| 평균 수익 / 손실 | ${sign(t.avgWinPct)} / ${sign(t.avgLossPct)} |`,
      `| 평균 보유 (이익 / 손실) | ${t.avgHoldingDaysWins ?? '—'}일 / ${t.avgHoldingDaysLosses ?? '—'}일 |`,
      `| 일지 없이 한 매도 | ${t.sellsWithoutJournal ?? 0}건 |`,
    ];
    const lines = [
      '## 매매 성적',
      ...rows,
      '',
      j
        ? `## '${j.title}' 복기\n목표 예상 가격 ${fmtNum(j.targetPrice, j.currency)} 대비 지금 ${fmtNum(j.currentPrice, j.currency)}이고, 연결된 거래는 ${j.transactions.length}건입니다. 일지에 적은 매도 사유와 실제 매도 시점이 맞았습니다.`
        : '## 진행 중인 일지\n목표가에 가까워진 일지부터 근거를 다시 확인하세요.',
      '',
      '## 다음에 바꿀 점',
      '1. 매도할 때도 일지를 남겨 계획과 비교하세요.',
      '2. 손실 매매의 보유 기간이 길어지지 않도록 손절가를 일지에 미리 적어 두세요.',
    ].join('\n');
    const blocks = [text(lines)];
    if (j) {
      blocks.push(text('\n\n이 복기를 일지 끝에 덧붙이자고 제안합니다.'));
      blocks.push(call('propose_journal_review', { journal: j.title, review: '## 잘한 점\n- 목표 비중을 넘은 만큼만 계획대로 나눠 팔았다\n## 아쉬운 점\n- 매도 후 남은 수량의 새 목표가를 정하지 않았다\n## 다음에\n- 남은 수량의 목표가와 손절가를 다시 적는다' }));
    }
    return { blocks, stop: j ? 'tool_use' : 'end_turn', usage: { input: 2600, cached: 10200, output: 640 } };
  }
  return { blocks: [text('확인 카드에서 **실행**을 누르면 일지 끝에 복기가 덧붙습니다.')], stop: 'end_turn', usage: { input: 500, cached: 13000, output: 40 } };
}

/** Every result of one tool in this turn, in call order (search_books runs several times). */
function allResults(turn, name) {
  const ids = turn.flatMap((m) => (m.role === 'assistant' && Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_use' && b.name === name).map((b) => b.id) : []));
  const out = [];
  for (const m of turn) {
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== 'tool_result' || !ids.includes(b.tool_use_id)) continue;
      try {
        out.push(JSON.parse(typeof b.content === 'string' ? b.content : b.content?.[0]?.text ?? 'null'));
      } catch {}
    }
  }
  return out;
}

const PICKS = [
  { query: '전설로 떠나는 월가의 영웅', why: (t) => `린치를 투자 거장으로 정리해 두셨지만 원전은 아직 독서 노트에 없습니다. 생활 속에서 종목을 찾고 기업을 6가지 유형으로 나누는 법이 성장주 판단의 기준이 됩니다${t.sells ? '' : ''}.`, level: '쉬움 · 먼저' },
  { query: '투자에 대한 생각', why: (t) => `리스크와 시장 사이클을 다룹니다. 손실 매매의 평균 보유가 ${t.avgHoldingDaysLosses ?? '—'}일로 길어, 언제 생각을 바꿀지 정하는 데 도움이 됩니다.`, level: '보통 · 두 번째' },
  { query: '돈의 심리학', why: () => '숫자보다 행동을 다룹니다. 급락 때 판단을 지키려는 메모와 이어지고, 『현명한 투자자』의 미스터 마켓을 다른 각도에서 봅니다.', level: '쉬움 · 언제든' },
];

function librarianScript(turn) {
  const done = turn.filter((x) => x.role === 'assistant').length;
  if (done === 0) {
    return {
      blocks: [text('읽은 책과 투자 노트, 매매 습관을 먼저 볼게요.'), call('get_reading_history', {}), call('get_investment_notes', {}), call('get_trade_review', {})],
      stop: 'tool_use',
      usage: { input: 10400, cached: 0, output: 140 },
    };
  }
  if (done === 1) {
    return { blocks: [text('후보 책이 실제로 있는지 찾아볼게요.'), ...PICKS.map((p) => call('search_books', { query: p.query }))], stop: 'tool_use', usage: { input: 2600, cached: 10400, output: 90 } };
  }
  if (done === 2) {
    const read = allResults(turn, 'get_reading_history')[0] ?? { books: [], counts: {}, topKeywords: [] };
    const t = allResults(turn, 'get_trade_review')[0] ?? {};
    const found = allResults(turn, 'search_books');
    const picks = PICKS.map((p, i) => ({ ...p, hit: found[i]?.hits?.find((h) => !h.alreadyInNotes) })).filter((p) => p.hit);
    const done2 = read.books.filter((b) => b.status === 'DONE').map((b) => `『${b.title}』${b.rating ? `(★${b.rating})` : ''}`);
    const lines = [
      `## 지금 독서 기록`,
      `읽은 책 ${read.counts.DONE ?? 0}권 ${done2.join(', ')}, 많이 이어 둔 키워드는 ${read.topKeywords.join(', ') || '아직 없음'}입니다. 가치투자의 기초는 잡혀 있어, 다음은 **종목 찾기**와 **리스크·심리**를 넓히는 책을 권합니다.`,
      ``,
      `## 추천`,
      `| 순서 | 책 | 출판사 · 연도 | 난이도 |`,
      `| --- | --- | --- | --- |`,
      ...picks.map((p, i) => `| ${i + 1} | 『${p.hit.title}』 ${p.hit.authors.join(', ')} | ${p.hit.publisher ?? '—'} · ${p.hit.year ?? '—'} | ${p.level} |`),
      ``,
      ...picks.map((p, i) => `${i + 1}. **『${p.hit.title}』** — ${p.why(t)}`),
      ``,
      `먼저 읽을 한 권을 읽을 책 목록에 넣어 둘게요.`,
    ].join('\n');
    const first = picks[0];
    return {
      blocks: [
        text(lines),
        ...(first ? [call('propose_book', { title: first.hit.title, author: first.hit.authors.join(', '), publisher: first.hit.publisher ?? undefined, year: first.hit.year ?? undefined, reason: '린치의 원전. 생활 속에서 종목을 찾고 기업 유형을 나누는 법을 익힌다.', keywords: ['성장투자'] })] : []),
      ],
      stop: first ? 'tool_use' : 'end_turn',
      usage: { input: 1900, cached: 13000, output: 620 },
    };
  }
  return { blocks: [text('확인 카드의 **실행**을 누르면 독서 노트의 읽을 책에 추가됩니다. 다른 두 권도 원하시면 말씀해 주세요.')], stop: 'end_turn', usage: { input: 400, cached: 15000, output: 40 } };
}

/** The scripted next step for a conversation (Messages API shape), picked by the agent's system prompt. */
function scriptFor(system, msgs) {
  const turn = lastTurn(msgs);
  const results = toolResults(turn);
  return system.includes('리서치 애널리스트')
    ? researchScript(turn, results)
    : system.includes('매매일지 코치')
      ? coachScript(turn, results)
      : system.includes('독서 큐레이터')
        ? librarianScript(turn)
        : system.includes('렌즈')
          ? sageScript(turn, results, msgs[0])
          : managerScript(turn, results);
}

async function messages(init) {
  const body = JSON.parse(String(init?.body ?? '{}'));
  const system = Array.isArray(body.system) ? body.system.map((b) => b.text).join('') : String(body.system ?? '');
  const script = scriptFor(system, body.messages);
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

// ---------------------------------------------------------------- other companies
// ChatGPT, Gemini, Grok and DeepSeek speak Chat Completions: the same scripts answer, turned
// into that shape (without the web search, which those models don't get in the app).

const COMPAT = {
  'api.openai.com': { prefix: '/v1', models: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna', 'text-embedding-3-large'] },
  'generativelanguage.googleapis.com': { prefix: '/v1beta/openai', models: ['models/gemini-3.1-pro-preview', 'models/gemini-3.8-flash', 'models/gemini-3.5-flash-lite'], signatures: true },
  'api.x.ai': { prefix: '/v1', models: ['grok-4.7', 'grok-4.6'] },
  'api.deepseek.com': { prefix: '/v1', models: ['deepseek-v4-pro', 'deepseek-v4-flash'] },
};

/** Chat Completions messages -> Messages API shape, so the scripts can read them. */
function fromCompat(msgs) {
  const out = [];
  for (const m of msgs) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      const t = String(m.content ?? '');
      const cut = t.indexOf('</page-context>');
      out.push({ role: 'user', content: cut >= 0 ? [{ type: 'text', text: t.slice(0, cut + 15) }, { type: 'text', text: t.slice(cut + 15).trim() }] : [{ type: 'text', text: t }] });
    } else if (m.role === 'assistant') {
      const blocks = m.content ? [{ type: 'text', text: m.content }] : [];
      for (const c of m.tool_calls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments || '{}') });
      out.push({ role: 'assistant', content: blocks });
    } else if (m.role === 'tool') {
      const last = out.at(-1);
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content };
      if (last?.role === 'user' && last.content.every((b) => b.type === 'tool_result')) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    }
  }
  return out;
}

function compatError(status, message) {
  return new Response(JSON.stringify({ error: { message, type: 'invalid_request_error' } }), { status, headers: { 'content-type': 'application/json' } });
}

async function completions(host, init) {
  const cfg = COMPAT[host];
  const body = JSON.parse(String(init?.body ?? '{}'));
  if (!cfg.models.some((m) => m.replace(/^models\//, '') === body.model)) return compatError(404, `The model \`${body.model}\` does not exist (demo server)`);
  // Gemini rejects a replayed function call without the thought signature it sent
  if (cfg.signatures && body.messages.some((m) => (m.tool_calls ?? []).some((c) => !c.extra_content?.google?.thought_signature))) {
    return compatError(400, 'Function call is missing a thought_signature (demo server)');
  }
  const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
  const script = scriptFor(system, fromCompat(body.messages));
  const blocks = script.blocks.filter((b) => b.type === 'text' || b.type === 'tool_use');
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const calls = blocks.filter((b) => b.type === 'tool_use');
  const out = [];
  const chunk = (delta, finish = null, usage) => out.push(`data: ${JSON.stringify({ id: id('chatcmpl'), object: 'chat.completion.chunk', model: body.model, choices: delta ? [{ index: 0, delta, finish_reason: finish }] : [], ...(usage ? { usage } : {}) })}\n\n`);
  chunk({ role: 'assistant', content: '' });
  for (const piece of text.match(/[\s\S]{1,24}/g) ?? []) chunk({ content: piece });
  calls.forEach((c, index) => {
    chunk({ tool_calls: [{ index, id: id('call'), type: 'function', function: { name: c.name, arguments: '' }, ...(cfg.signatures ? { extra_content: { google: { thought_signature: `demo-sig-${index}` } } } : {}) }] });
    chunk({ tool_calls: [{ index, function: { arguments: JSON.stringify(c.input) } }] });
  });
  chunk({}, calls.length ? 'tool_calls' : 'stop');
  const u = script.usage;
  chunk(null, null, { prompt_tokens: u.input + u.cached, completion_tokens: u.output, total_tokens: u.input + u.cached + u.output, prompt_tokens_details: { cached_tokens: u.cached } });
  out.push('data: [DONE]\n\n');
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      for (const ch of out) {
        c.enqueue(enc.encode(ch));
        await sleep(12);
      }
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
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
  const compat = COMPAT[url.hostname];
  if (compat) {
    if (url.pathname === `${compat.prefix}/chat/completions` && init?.method === 'POST') return completions(url.hostname, init);
    if (url.pathname === `${compat.prefix}/models`) return new Response(JSON.stringify({ object: 'list', data: compat.models.map((m) => ({ id: m, object: 'model' })) }), { status: 200, headers: { 'content-type': 'application/json' } });
    return compatError(404, `데모 서버에 없는 요청: ${url.pathname}`);
  }
  if (url.hostname !== 'api.anthropic.com') return prevFetch(input, init);
  if (url.pathname === '/v1/models') {
    const data = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map((m) => ({ type: 'model', id: m, display_name: m, created_at: '2026-01-01T00:00:00Z' }));
    return new Response(JSON.stringify({ data, has_more: false, first_id: data[0].id, last_id: data.at(-1).id }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.pathname === '/v1/messages' && init?.method === 'POST') return messages(init);
  return new Response(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: `데모 서버에 없는 요청: ${url.pathname}` } }), { status: 404, headers: { 'content-type': 'application/json' } });
};

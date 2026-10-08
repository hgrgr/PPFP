/**
 * AI advisor: agents, pricing and turning stored Messages API history into what the
 * chat shows. No I/O here; the agent loop lives in server/services/ai.
 */

export const AI_MODEL = 'claude-opus-5-5';

export type AgentKind = 'MANAGER' | 'RESEARCH' | 'COACH' | 'SAGE';

/** Order in pickers */
export const AGENT_ORDER: AgentKind[] = ['MANAGER', 'RESEARCH', 'COACH', 'SAGE'];

export const AGENTS: Record<AgentKind, { name: string; description: string; starters: string[] }> = {
  MANAGER: {
    name: '포트폴리오 매니저',
    description: '보유 종목·목표 비중·자산 성질·매매일지를 보고 점검과 리밸런싱을 제안합니다. 필요하면 웹에서 최신 소식을 찾아봅니다.',
    starters: [
      '오늘 아침 브리핑을 해 줘',
      '내 포트폴리오를 점검해 줘. 지금 가장 신경 써야 할 점 3가지는?',
      '목표 비중에서 벗어난 곳이 있으면 어떻게 맞추면 좋을지 알려 줘',
      '매매일지의 목표가와 지금 가격을 비교해서 다시 볼 종목을 골라 줘',
      '내 보유 종목 중 최근 실적이나 뉴스로 확인할 만한 것을 찾아 줘',
    ],
  },
  RESEARCH: {
    name: '리서치 애널리스트',
    description: '종목·업종을 웹에서 깊이 조사해 사업, 최근 실적, 밸류에이션, 주가 흐름, 리스크와 촉매를 출처와 함께 리포트로 정리합니다. 매수 계획 일지 초안도 써 줍니다.',
    starters: [
      '내 보유 종목 중 비중이 가장 큰 종목을 깊이 리서치해 줘',
      '관심종목 중 지금 살펴볼 만한 종목을 골라 리서치해 줘',
      '반도체 업황을 정리하고 내 포트폴리오에 미치는 영향을 알려 줘',
    ],
  },
  COACH: {
    name: '매매일지 코치',
    description: '매매일지와 실제 매매 기록을 함께 보고 복기합니다. 근거가 지켜졌는지, 반복되는 습관과 편향을 짚고, 복기 내용을 일지에 덧붙이자고 제안합니다.',
    starters: [
      '최근 1년 매매를 복기해서 내 습관의 강점과 약점을 알려 줘',
      '진행 중인 일지 중 근거를 다시 점검해야 할 것을 골라 줘',
      '일지 없이 한 매매를 찾아서 무엇을 기록해 둘지 알려 줘',
    ],
  },
  SAGE: {
    name: '투자 거장 관점',
    description: '투자 노트에 정리한 거장의 철학으로 내 포트폴리오와 종목을 봅니다. 그 철학에 맞는 종목과 어긋나는 종목을 짚어 줍니다.',
    starters: ['이 철학으로 보면 내 포트폴리오는 어떤가요?', '내 종목 중 이 철학에 가장 잘 맞는 것과 안 맞는 것은?', '이 철학대로라면 지금 무엇을 하지 말아야 할까요?'],
  },
};

/** What the chat shows while a tool runs */
export const TOOL_LABEL: Record<string, string> = {
  list_portfolios: '포트폴리오 목록 확인',
  get_portfolio_overview: '포트폴리오 평가·수익률 확인',
  get_target_drift: '목표 비중 비교',
  get_trait_allocation: '자산 성질별 비중 확인',
  get_holding: '종목 기록 확인',
  get_transactions: '거래 내역 확인',
  get_quote: '시세 확인',
  get_journals: '매매일지 확인',
  get_investment_notes: '투자 노트 확인',
  get_sage_profile: '투자 거장 정리 확인',
  get_price_history: '주가 흐름 확인',
  get_tax_summary: '세금 예상 확인',
  get_dividends: '배당 확인',
  get_performance: '성과·기여도 확인',
  get_journal: '매매일지 읽기',
  get_trade_review: '실현 매매 통계 확인',
  propose_journal_review: '일지 복기 제안',
  propose_journal_draft: '일지 초안 제안',
  propose_note: '메모 제안',
  propose_price_alert: '가격 알림 제안',
  propose_target_weights: '목표 비중 제안',
  web_search: '웹 검색',
  web_fetch: '웹 페이지 읽기',
};

export const isProposal = (toolName: string) => toolName.startsWith('propose_');

// ---------------------------------------------------------------- cost

/** USD per million tokens. Cache writes are the 5-minute kind. */
const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
};
/** USD per web search */
const WEB_SEARCH = 0.01;

export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

/** Estimated cost of one response. Unknown models are priced as the default model. */
export function costUsd(usage: UsageLike, model: string): number {
  const p = PRICES[model] ?? PRICES[AI_MODEL];
  const m = (n: number | null | undefined, per: number) => ((n ?? 0) * per) / 1_000_000;
  return (
    m(usage.input_tokens, p.input) +
    m(usage.output_tokens, p.output) +
    m(usage.cache_creation_input_tokens, p.cacheWrite) +
    m(usage.cache_read_input_tokens, p.cacheRead) +
    (usage.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH
  );
}

/** First day of the current month in Korea, as a UTC instant. */
export function monthStartKst(now = new Date()): Date {
  const k = new Date(now.getTime() + 9 * 3_600_000);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - 9 * 3_600_000);
}

// ---------------------------------------------------------------- history -> chat

const CONTEXT_OPEN = '<page-context>';

/** A user turn: what is on screen (if anything), then what the user typed. */
export function userContent(text: string, context: string | null): { type: 'text'; text: string }[] {
  return [...(context ? [{ type: 'text' as const, text: `${CONTEXT_OPEN}\n${context}\n</page-context>` }] : []), { type: 'text' as const, text }];
}

export function conversationTitle(text: string): string {
  const line = text.trim().split('\n')[0].replace(/\s+/g, ' ');
  return line.length > 40 ? `${line.slice(0, 39)}…` : line || '새 대화';
}

export interface Source {
  url: string;
  title: string;
}

export type ChatPart =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; label: string }
  | { kind: 'search'; query: string }
  | { kind: 'action'; toolUseId: string };

export type ChatTurn = { role: 'user'; text: string } | { role: 'assistant'; parts: ChatPart[]; sources: Source[] };

interface Block {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
  citations?: { type?: string; url?: string; title?: string | null }[] | null;
}

/**
 * Turns stored messages into chat turns. Tool results and the assistant messages of one
 * agent run fold into a single assistant turn; the page context the app added is hidden.
 */
export function toChat(messages: { role: string; content: unknown }[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let cur: Extract<ChatTurn, { role: 'assistant' }> | null = null;
  const assistant = () => {
    if (!cur) {
      cur = { role: 'assistant', parts: [], sources: [] };
      turns.push(cur);
    }
    return cur;
  };
  for (const m of messages) {
    const blocks: Block[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? (m.content as Block[]) : [];
    if (m.role === 'user') {
      const typed = blocks.filter((b) => b.type === 'text' && !b.text?.startsWith(CONTEXT_OPEN));
      if (!typed.length) continue; // tool results only: same agent run
      cur = null;
      turns.push({ role: 'user', text: typed.map((b) => b.text).join('\n') });
      continue;
    }
    const a = assistant();
    for (const b of blocks) {
      if (b.type === 'text' && b.text) {
        const last = a.parts.at(-1);
        // Cited answers arrive as many small text blocks: join them back up
        if (last?.kind === 'text') last.text += b.text;
        else a.parts.push({ kind: 'text', text: b.text });
        for (const c of b.citations ?? []) {
          if (c.url && !a.sources.some((s) => s.url === c.url)) a.sources.push({ url: c.url, title: c.title || c.url });
        }
      } else if (b.type === 'tool_use' && b.name && b.id) {
        a.parts.push(isProposal(b.name) ? { kind: 'action', toolUseId: b.id } : { kind: 'tool', name: b.name, label: TOOL_LABEL[b.name] ?? b.name });
      } else if (b.type === 'server_tool_use' && b.name === 'web_search') {
        const q = (b.input as { query?: unknown } | undefined)?.query;
        a.parts.push({ kind: 'search', query: typeof q === 'string' ? q : '' });
      } else if (b.type === 'server_tool_use' && b.name) {
        a.parts.push({ kind: 'tool', name: b.name, label: TOOL_LABEL[b.name] ?? b.name });
      }
    }
  }
  return turns;
}

// ---------------------------------------------------------------- briefing and alerts

export const BRIEFING_PROMPT =
  '오늘 아침 브리핑을 해 줘. 최근 1주 포트폴리오 변화와 그 이유, 목표 비중에서 벗어난 곳, 목표가·손절가나 가격 알림에 가까워진 종목, 내 주요 보유 종목의 최근 뉴스와 이번 주 일정(실적 발표 등)을 짧게 정리하고, 오늘 할 일을 3가지 이내로 알려 줘.';

/** The question the advisor gets when it looks into an alert by itself. */
export function alertPrompt(n: { title: string; body: string }): string {
  return `알림이 왔어: "${n.title}" — ${n.body.replace(/\s+/g, ' ').trim()}\n왜 이런 일이 생겼는지(최근 뉴스 포함), 내 포트폴리오와 매매일지에 비춰 지금 무엇을 검토해야 하는지 짧게 정리해 줘. 필요하면 제안 카드를 만들어 줘.`;
}

/** Which agent looks into an alert: the journal coach for journal target/stop alerts. */
export const alertAgent = (url: string | null): AgentKind => (url?.startsWith('/journal/') ? 'COACH' : 'MANAGER');

/** Is a briefing due now? Times are in Korea; one briefing per day at or after the chosen hour. */
export function briefingDue(now: Date, s: { briefing: boolean; briefingHour: number; briefingWeekdays: boolean; briefingLastDate: string | null }): string | null {
  if (!s.briefing) return null;
  const k = new Date(now.getTime() + 9 * 3_600_000);
  const date = k.toISOString().slice(0, 10);
  const weekday = k.getUTCDay();
  if (s.briefingWeekdays && (weekday === 0 || weekday === 6)) return null;
  if (k.getUTCHours() < s.briefingHour || s.briefingLastDate === date) return null;
  return date;
}

/** First lines of an answer as plain text, for a notification or push. */
export function plainSummary(markdown: string, max = 280): string {
  const text = markdown
    .split('\n')
    .map((l) => l.replace(/^#{1,6}\s+/, '').replace(/^\s*[-*]\s+/, '· ').replace(/\*\*(.+?)\*\*/g, '$1').trim())
    .filter((l) => l && !/^\|?\s*-{3}/.test(l) && !l.startsWith('|'))
    .join('\n');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

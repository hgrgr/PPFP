/**
 * AI advisor: agents, pricing and turning stored Messages API history into what the
 * chat shows. No I/O here; the agent loop lives in server/services/ai.
 */

export const AI_MODEL = 'claude-opus-5-5';

export type AgentKind = 'MANAGER' | 'SAGE';

export const AGENTS: Record<AgentKind, { name: string; description: string; starters: string[] }> = {
  MANAGER: {
    name: '포트폴리오 매니저',
    description: '보유 종목·목표 비중·자산 성질·매매일지를 보고 점검과 리밸런싱을 제안합니다. 필요하면 웹에서 최신 소식을 찾아봅니다.',
    starters: [
      '내 포트폴리오를 점검해 줘. 지금 가장 신경 써야 할 점 3가지는?',
      '목표 비중에서 벗어난 곳이 있으면 어떻게 맞추면 좋을지 알려 줘',
      '매매일지의 목표가와 지금 가격을 비교해서 다시 볼 종목을 골라 줘',
      '내 보유 종목 중 최근 실적이나 뉴스로 확인할 만한 것을 찾아 줘',
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

/**
 * The AI advisor on the phone: Claude with the user's own API key, called straight from the
 * app (no server). It sees a short summary of the book; the conversation stays on the phone.
 * The server's advisor (agents, tools, web search, morning briefing) is there once a server
 * is linked.
 */
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/domain/ai';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export class AiError extends Error {}

const SYSTEM = `당신은 PPFP 앱 안의 투자 도우미입니다. 사용자의 실제 보유 자산 요약을 보고 한국어로 답합니다.
- 숫자는 요약에 있는 값만 쓰고, 모르는 값은 모른다고 말합니다.
- 매수·매도를 대신 결정하지 않고, 판단에 필요한 관점과 확인할 점을 정리합니다.
- 세금·법률은 일반적인 안내로만 말하고 확인이 필요하다고 덧붙입니다.
- 짧은 단락과 목록으로, 휴대폰 화면에서 읽기 쉽게 씁니다.`;

/** One reply. `book` is a plain-text summary of holdings and totals. */
export async function askAdvisor(apiKey: string, book: string, history: ChatTurn[], question: string): Promise<string> {
  if (!apiKey) throw new AiError('더보기 › 시세 연결에서 Anthropic API 키를 넣으세요.');
  // The key is the user's own and stays on their phone, so calling from the app is intended
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 120_000 });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.text })),
    { role: 'user', content: question },
  ];
  try {
    const res = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      // On a policy decline the API retries on a fallback model in the same call
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM }, { type: 'text', text: `사용자의 자산 요약 (앱이 지금 계산한 값):\n${book}` }],
      messages,
    });
    if (res.stop_reason === 'refusal') throw new AiError('이 질문에는 답하지 않았습니다. 질문을 바꿔 보세요.');
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!text) throw new AiError('빈 답이 왔습니다. 다시 시도하세요.');
    return res.stop_reason === 'max_tokens' ? `${text}\n\n(답이 길어 중간에 끊겼습니다.)` : text;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('API 키가 맞지 않습니다. 시세 연결에서 다시 넣으세요.');
    if (e instanceof Anthropic.RateLimitError) throw new AiError('요청이 많아 잠시 막혔습니다. 조금 뒤에 다시 물어보세요.');
    if (e instanceof Anthropic.BadRequestError) throw new AiError(`요청이 거절됐습니다: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new AiError(`AI 서버 오류 (${e.status ?? '연결'}). 잠시 뒤 다시 시도하세요.`);
    throw new AiError('AI에 연결하지 못했습니다. 인터넷 연결을 확인하세요.');
  }
}

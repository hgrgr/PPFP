/**
 * Advisor work nobody is watching: the morning briefing and looking into alerts as they
 * arrive. Each runs as an ordinary conversation (so the user can open and continue it)
 * and is linked from a notification. Runs one at a time per server process.
 */
import 'server-only';
import { alertAgent, alertPrompt, BRIEFING_PROMPT, briefingDue, plainSummary } from '@/domain/ai';
import { prisma } from '../../db';
import { notify } from '../notify';
import { conversationView } from './actions';
import { apiErrorMessage, runTurn, type TurnInput } from './agent';

const g = globalThis as unknown as { ppfpAiQueue?: Promise<unknown> };

/** Run jobs one after another so background answers never pile up on the API. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = (g.ppfpAiQueue ?? Promise.resolve()).then(job, job);
  g.ppfpAiQueue = next.catch(() => {});
  return next;
}

/** One full turn without a listener. Returns the conversation and its last answer as plain text. */
async function runQuiet(userId: string, input: TurnInput): Promise<{ conversationId: string; summary: string }> {
  let conversationId = '';
  let error: string | null = null;
  await runTurn(userId, input, (e) => {
    if (e.t === 'start') conversationId = e.conversationId;
    if (e.t === 'error') error = e.message;
  });
  if (!conversationId) throw new Error(error ?? '대화를 시작하지 못했습니다.');
  const view = await conversationView(userId, conversationId);
  const last = view?.turns.at(-1);
  const texts = last?.role === 'assistant' ? last.parts.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text) : [];
  // The answer usually opens with "확인해 볼게요" before the tools: summarize the longest part
  const answer = texts.sort((a, b) => b.length - a.length)[0] ?? '';
  if (!answer) throw new Error(error ?? '답을 받지 못했습니다.');
  return { conversationId, summary: plainSummary(answer) };
}

const dateLabel = (ymd: string) => `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일`;

/** Send today's briefing to everyone whose time has come. Safe to call often. */
export async function checkBriefings(now = new Date()): Promise<number> {
  const due = (await prisma.aiSettings.findMany({ where: { briefing: true } })).map((s) => ({ s, date: briefingDue(now, s) })).filter((x) => x.date);
  let sent = 0;
  for (const { s, date } of due) {
    // Claim the day first, so a slow run or a second process never sends two
    const claimed = await prisma.aiSettings.updateMany({ where: { userId: s.userId, OR: [{ briefingLastDate: null }, { briefingLastDate: { not: date } }] }, data: { briefingLastDate: date } });
    if (!claimed.count) continue;
    await enqueue(async () => {
      try {
        const r = await runQuiet(s.userId, { agent: 'MANAGER', text: BRIEFING_PROMPT, path: '/dashboard' });
        const title = `아침 브리핑 · ${dateLabel(date!)}`;
        await prisma.aiConversation.update({ where: { id: r.conversationId }, data: { title } });
        const n = await notify(s.userId, { kind: 'BRIEFING', title, body: r.summary, url: `/ai?c=${r.conversationId}` });
        await prisma.notification.update({ where: { id: n.id }, data: { aiConversationId: r.conversationId } });
        sent++;
      } catch (e) {
        console.error('[ai] briefing failed', s.userId, e instanceof Error ? e.message : e);
        await notify(s.userId, { kind: 'BRIEFING', title: '아침 브리핑을 만들지 못했습니다', body: apiErrorMessage(e), url: '/settings#ai' });
      }
    });
  }
  return sent;
}

/** Have the advisor look into an alert that just arrived, and link its answer from the alert. */
export function analyzeAlert(userId: string, notificationId: string) {
  void enqueue(async () => {
    const n = await prisma.notification.findFirst({ where: { id: notificationId, userId } });
    if (!n || n.aiConversationId) return;
    try {
      const r = await runQuiet(userId, { agent: alertAgent(n.url), text: alertPrompt(n), path: n.url });
      await prisma.aiConversation.update({ where: { id: r.conversationId }, data: { title: `알림 분석 · ${n.title}`.slice(0, 60) } });
      await prisma.notification.update({ where: { id: n.id }, data: { aiConversationId: r.conversationId } });
    } catch (e) {
      console.error('[ai] alert analysis failed', notificationId, e instanceof Error ? e.message : e);
    }
  });
}

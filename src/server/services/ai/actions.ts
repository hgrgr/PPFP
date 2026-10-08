/** Running what an agent proposed, settings, and the chat view of a conversation. */
import 'server-only';
import { toChat } from '@/domain/ai';
import { encryptSecret, mask } from '../../crypto';
import { prisma } from '../../db';
import { createAlert, savePortfolioTargets } from '../alerts';
import { addLink, createNote } from '../knowledge';
import { UserError } from '../portfolios';

export interface ActionView {
  id: string;
  toolUseId: string;
  kind: string;
  summary: string;
  status: string;
  result: string | null;
  href: string | null;
}

function hrefOf(kind: string, payload: Record<string, unknown>, resultId: string | null): string | null {
  if (kind === 'note' && resultId) return `/notes?open=${resultId}`;
  if (kind === 'price_alert') return '/alerts';
  if (kind === 'target_weights' && typeof payload.portfolioId === 'string') return `/portfolios/${payload.portfolioId}#targets`;
  return null;
}

export async function conversationView(userId: string, id: string) {
  const c = await prisma.aiConversation.findFirst({ where: { id, userId }, include: { messages: { orderBy: { seq: 'asc' }, select: { role: true, content: true, costUsd: true } }, actions: true } });
  if (!c) return null;
  const sage = c.sageId ? await prisma.sage.findFirst({ where: { id: c.sageId, userId }, select: { id: true, name: true } }) : null;
  return {
    id: c.id,
    agent: c.agent,
    sage,
    title: c.title,
    turns: toChat(c.messages),
    costUsd: c.messages.reduce((s, m) => s + Number(m.costUsd), 0),
    actions: c.actions.map(
      (a): ActionView => ({ id: a.id, toolUseId: a.toolUseId, kind: a.kind, summary: a.summary, status: a.status, result: a.result, href: hrefOf(a.kind, a.payload as Record<string, unknown>, a.status === 'DONE' ? a.result : null) }),
    ),
  };
}

export type ConversationView = NonNullable<Awaited<ReturnType<typeof conversationView>>>;

export async function listConversations(userId: string) {
  return prisma.aiConversation.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 50, select: { id: true, title: true, agent: true, sageId: true, updatedAt: true } });
}

export async function deleteConversation(userId: string, id: string) {
  const r = await prisma.aiConversation.deleteMany({ where: { id, userId } });
  if (!r.count) throw new UserError('대화를 찾을 수 없습니다.');
}

/** Run a proposal. Returns what to show; failures are recorded on the action. */
export async function executeAction(userId: string, id: string): Promise<string> {
  const a = await prisma.aiAction.findFirst({ where: { id, userId } });
  if (!a) throw new UserError('제안을 찾을 수 없습니다.');
  if (a.status !== 'PENDING') throw new UserError('이미 처리한 제안입니다.');
  const p = a.payload as Record<string, unknown>;
  try {
    let result: string;
    if (a.kind === 'note') {
      const noteId = await createNote(userId, String(p.body), `/ai?c=${a.conversationId}`);
      for (const assetId of (p.assetIds as string[] | undefined) ?? []) await addLink(userId, { type: 'note', id: noteId }, { type: 'asset', id: assetId });
      result = noteId;
    } else if (a.kind === 'price_alert') {
      await createAlert(userId, { assetId: String(p.assetId), price: String(p.price), direction: String(p.direction ?? ''), note: String(p.note ?? '') });
      result = '알림을 만들었습니다';
    } else if (a.kind === 'target_weights') {
      await savePortfolioTargets(userId, String(p.portfolioId), { targets: p.targets as Record<string, string>, tolerance: String(p.tolerance), alert: !!p.alert });
      result = '목표 비중을 저장했습니다';
    } else throw new UserError('알 수 없는 제안입니다.');
    await prisma.aiAction.update({ where: { id }, data: { status: 'DONE', result } });
    return a.kind === 'note' ? '메모를 저장했습니다' : result;
  } catch (e) {
    const msg = e instanceof UserError ? e.message : '실행하지 못했습니다.';
    if (!(e instanceof UserError)) console.error('[ai] action failed', e);
    await prisma.aiAction.update({ where: { id }, data: { status: 'FAILED', result: msg } });
    throw new UserError(msg);
  }
}

export async function dismissAction(userId: string, id: string) {
  const r = await prisma.aiAction.updateMany({ where: { id, userId, status: 'PENDING' }, data: { status: 'DISMISSED' } });
  if (!r.count) throw new UserError('이미 처리한 제안입니다.');
}

export async function saveAiSettings(userId: string, input: { apiKey?: string; clearKey?: boolean; monthlyLimit: string; webSearch: boolean }) {
  const key = input.apiKey?.trim();
  if (key && !/^sk-ant-[\w-]{20,}$/.test(key)) throw new UserError('Anthropic API 키는 sk-ant- 로 시작합니다.');
  const limitText = input.monthlyLimit.trim().replace(/^\$/, '');
  const limit = limitText === '' ? null : Number(limitText);
  if (limit !== null && (!Number.isFinite(limit) || limit < 0 || limit > 10_000)) throw new UserError('월 한도는 0~10,000 달러 사이로 입력하세요. 비우면 한도가 없습니다.');
  const keyData = key ? { apiKeyEnc: encryptSecret(key), apiKeyHint: mask(key) } : input.clearKey ? { apiKeyEnc: null, apiKeyHint: null } : {};
  const data = { monthlyLimit: limit === null ? null : limit.toFixed(2), webSearch: input.webSearch, ...keyData };
  await prisma.aiSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

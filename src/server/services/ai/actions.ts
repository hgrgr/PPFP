/** Running what an agent proposed, settings, and the chat view of a conversation. */
import 'server-only';
import { AGENT_ORDER, AGENTS, toChat, type AgentKind } from '@/domain/ai';
import { choiceLabel, isModelId, isProvider, PROVIDER_ORDER, PROVIDERS, type ProviderId } from '@/domain/ai-providers';
import { textToBlocks } from '@/domain/ai-analysis';
import { BUILTIN_FORMATS } from '@/domain/journal';
import { kstDate, prisma } from '../../db';
import { ensureListedAsset } from '../assets';
import { appendToJournal, saveJournal } from '../journal';
import { createAlert, savePortfolioTargets } from '../alerts';
import { addLink, createBook, createNote } from '../knowledge';
import { UserError } from '../portfolios';
import { clearServiceKey, setServiceKey } from '../api-keys';
import { conversationModel } from './agent';

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
  if (kind === 'journal_review' && typeof payload.entryId === 'string') return `/journal/${payload.entryId}`;
  if (kind === 'journal_draft' && resultId) return `/journal/${resultId}`;
  if (kind === 'book' && resultId) return `/books/${resultId}`;
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
    modelLabel: choiceLabel(conversationModel(c)),
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
    } else if (a.kind === 'journal_review') {
      await appendToJournal(userId, String(p.entryId), textToBlocks(`AI 복기 · ${kstDate()}`, String(p.review)), !!p.close);
      result = '일지에 복기를 덧붙였습니다';
    } else if (a.kind === 'journal_draft') {
      const asset = await ensureListedAsset(userId, String(p.symbol));
      const num = (v: unknown) => (typeof v === 'number' ? String(v) : '');
      result = await saveJournal(userId, {
        assetId: asset.id,
        title: String(p.title),
        targetPrice: num(p.targetPrice),
        basePrice: num(p.basePrice),
        stopPrice: num(p.stopPrice),
        targetDate: typeof p.targetDate === 'string' ? p.targetDate : undefined,
        // The 매수 계획 format's properties, left for the user to fill
        template: 'builtin:buy',
        fields: BUILTIN_FORMATS.find((f) => f.id === 'builtin:buy')?.fields ?? [],
        values: {},
        content: textToBlocks('AI 초안', String(p.body)).slice(1),
        txnIds: [],
      });
    } else if (a.kind === 'book') {
      const title = String(p.title);
      if (await prisma.book.findFirst({ where: { userId, title: title.trim() } })) throw new UserError(`『${title}』은(는) 이미 독서 노트에 있습니다.`);
      const id = await createBook(userId, title, { author: typeof p.author === 'string' ? p.author : null, publisher: typeof p.publisher === 'string' ? p.publisher : null, year: typeof p.year === 'number' ? p.year : null });
      await prisma.book.update({ where: { id }, data: { status: 'WANT', oneLine: String(p.reason ?? '').slice(0, 300) || null } });
      for (const name of Array.isArray(p.keywords) ? (p.keywords as unknown[]) : []) {
        const t = typeof name === 'string' ? await prisma.topic.findUnique({ where: { userId_name: { userId, name: name.replace(/^#/, '').trim() } } }) : null;
        if (t) await addLink(userId, { type: 'book', id }, { type: 'topic', id: t.id });
      }
      result = id;
    } else throw new UserError('알 수 없는 제안입니다.');
    await prisma.aiAction.update({ where: { id }, data: { status: 'DONE', result } });
    return a.kind === 'note' ? '메모를 저장했습니다' : a.kind === 'journal_draft' ? '일지 초안을 만들었습니다' : a.kind === 'book' ? '읽을 책에 추가했습니다' : result;
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

export async function saveAiSettings(
  userId: string,
  input: {
    keys?: Partial<Record<ProviderId, { key?: string; clear?: boolean }>>;
    picks?: Partial<Record<AgentKind, { provider: string; model: string }>>;
    monthlyLimit: string;
    webSearch: boolean;
    briefing?: boolean;
    briefingHour?: string;
    briefingWeekdays?: boolean;
    alertAnalysis?: boolean;
  },
) {
  const keys: [ProviderId, string][] = [];
  for (const p of PROVIDER_ORDER) {
    const key = input.keys?.[p]?.key?.trim();
    if (!key) continue;
    if (!PROVIDERS[p].keyPattern.test(key)) throw new UserError(`${PROVIDERS[p].name} API 키 형식이 아닙니다. 예: ${PROVIDERS[p].keyPlaceholder}`);
    keys.push([p, key]);
  }
  const agentModels: Record<string, { provider: ProviderId; model: string }> = {};
  for (const agent of AGENT_ORDER) {
    const pick = input.picks?.[agent];
    if (!pick || !isProvider(pick.provider)) continue;
    const model = pick.model.trim() || PROVIDERS[pick.provider].models[0].id;
    if (!isModelId(model)) throw new UserError(`${AGENTS[agent].name}의 모델 이름을 확인하세요.`);
    agentModels[agent] = { provider: pick.provider, model };
  }
  const limitText = input.monthlyLimit.trim().replace(/^\$/, '');
  const limit = limitText === '' ? null : Number(limitText);
  if (limit !== null && (!Number.isFinite(limit) || limit < 0 || limit > 10_000)) throw new UserError('월 한도는 0~10,000 달러 사이로 입력하세요. 비우면 한도가 없습니다.');
  const hour = Number(input.briefingHour ?? 8);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new UserError('브리핑 시각을 고르세요.');
  for (const [p, key] of keys) await setServiceKey(userId, p, key);
  for (const p of PROVIDER_ORDER) if (input.keys?.[p]?.clear && !keys.some(([q]) => q === p)) await clearServiceKey(userId, p);
  const data = {
    ...(input.picks ? { agentModels } : {}),
    monthlyLimit: limit === null ? null : limit.toFixed(2),
    webSearch: input.webSearch,
    briefing: !!input.briefing,
    briefingHour: hour,
    briefingWeekdays: !!input.briefingWeekdays,
    alertAnalysis: !!input.alertAnalysis,
  };
  await prisma.aiSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

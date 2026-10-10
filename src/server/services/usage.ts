/**
 * The usage page: what the AI advisor cost this month (from the token counts of each answer)
 * and how much of each outside service the app used, with the limits services report.
 */
import { AGENTS, type AgentKind, monthStartKst, priceOf } from '@/domain/ai';
import { PROVIDERS, isProvider, type ProviderId } from '@/domain/ai-providers';
import { parseRateLimits, projectMonth, serviceInfo, type RateWindow, type ServiceInfo } from '@/domain/api-usage';
import { dbDate, dec, kstDate, prisma } from '../db';
import { fxQuote } from '../market';
import { aiStatus } from './ai/agent';

export interface ModelUsage {
  provider: string;
  model: string;
  answers: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  searches: number;
  cost: number;
  price: { input: number; output: number; known: boolean };
}

export interface ServiceUsage extends ServiceInfo {
  service: string;
  /** Counted for the whole server, not one user (broker market data, shared catalogs) */
  shared: boolean;
  today: { calls: number; errors: number; limited: number };
  month: { calls: number; errors: number; limited: number };
  lastAt: string | null;
  windows: RateWindow[];
  windowsAt: string | null;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export async function usageReport(userId: string) {
  const now = new Date();
  const monthStart = monthStartKst(now);
  const prevStart = monthStartKst(new Date(monthStart.getTime() - 86_400_000));
  const since30 = new Date(now.getTime() - 29 * 86_400_000);
  const from = since30 < monthStart ? since30 : monthStart;
  const [status, fx, messages, prev, usageRows, limitRows] = await Promise.all([
    aiStatus(userId),
    fxQuote(userId, 'USD'),
    prisma.aiMessage.findMany({
      where: { userId, createdAt: { gte: from }, role: 'assistant' },
      select: { createdAt: true, model: true, usage: true, costUsd: true, conversation: { select: { id: true, title: true, agent: true, provider: true } } },
    }),
    prisma.aiMessage.aggregate({ where: { userId, createdAt: { gte: prevStart, lt: monthStart } }, _sum: { costUsd: true } }),
    prisma.apiUsage.findMany({ where: { userId: { in: [userId, ''] }, day: { gte: dbDate(kstDate(monthStart)) } } }),
    prisma.apiLimit.findMany({ where: { userId: { in: [userId, ''] } } }),
  ]);

  // ── AI, this month
  const models = new Map<string, ModelUsage>();
  const agents = new Map<string, number>();
  const convs = new Map<string, { id: string; title: string; agent: string; cost: number; answers: number }>();
  const daily = new Map<string, number>();
  for (let t = since30.getTime(); t <= now.getTime(); t += 86_400_000) daily.set(kstDate(new Date(t)), 0);
  for (const m of messages) {
    const cost = dec(m.costUsd).toNumber();
    const day = kstDate(m.createdAt);
    if (daily.has(day)) daily.set(day, (daily.get(day) ?? 0) + cost);
    if (m.createdAt < monthStart) continue;
    const provider = isProvider(m.conversation.provider) ? m.conversation.provider : 'anthropic';
    const model = m.model ?? '알 수 없음';
    const key = `${provider}:${model}`;
    const u = (m.usage ?? {}) as Record<string, unknown>;
    const p = priceOf(model);
    const row = models.get(key) ?? { provider, model, answers: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0, cost: 0, price: { input: p.input, output: p.output, known: p.known } };
    row.answers += 1;
    row.input += n(u.input_tokens);
    row.output += n(u.output_tokens);
    row.cacheRead += n(u.cache_read_input_tokens);
    row.cacheWrite += n(u.cache_creation_input_tokens);
    row.searches += n((u.server_tool_use as Record<string, unknown> | undefined)?.web_search_requests);
    row.cost += cost;
    models.set(key, row);
    agents.set(m.conversation.agent, (agents.get(m.conversation.agent) ?? 0) + cost);
    const c = convs.get(m.conversation.id) ?? { id: m.conversation.id, title: m.conversation.title, agent: m.conversation.agent, cost: 0, answers: 0 };
    c.cost += cost;
    c.answers += 1;
    convs.set(c.id, c);
  }
  const spent = status.spent;

  // ── outside services
  const today = dbDate(kstDate(now)).getTime();
  const services = new Map<string, ServiceUsage>();
  const blank = () => ({ calls: 0, errors: 0, limited: 0 });
  const get = (service: string, shared: boolean) => {
    let s = services.get(service);
    if (!s) {
      s = { service, shared, ...serviceInfo(service), today: blank(), month: blank(), lastAt: null, windows: [], windowsAt: null };
      services.set(service, s);
    }
    return s;
  };
  for (const r of usageRows) {
    const s = get(r.service, r.userId === '');
    for (const bucket of r.day.getTime() === today ? [s.today, s.month] : [s.month]) {
      bucket.calls += r.calls;
      bucket.errors += r.errors;
      bucket.limited += r.limited;
    }
    if (!s.lastAt || r.lastAt.toISOString() > s.lastAt) s.lastAt = r.lastAt.toISOString();
  }
  for (const l of limitRows) {
    const s = get(l.service, l.userId === '');
    s.windows = parseRateLimits((l.headers ?? {}) as Record<string, string>, l.at);
    s.windowsAt = l.at.toISOString();
  }
  // Every AI company with a key shows up, even before its first call
  for (const id of Object.keys(PROVIDERS) as ProviderId[]) if (status.keys[id].source) get(id, false);
  const order = { ai: 0, data: 1, broker: 2 };

  return {
    ai: {
      configured: status.configured,
      spent,
      limit: status.monthlyLimit,
      projected: projectMonth(spent, now),
      lastMonth: dec(prev._sum.costUsd).toNumber(),
      models: [...models.values()].sort((a, b) => b.cost - a.cost),
      agents: [...agents.entries()].map(([agent, cost]) => ({ agent, name: AGENTS[agent as AgentKind]?.name ?? agent, cost })).sort((a, b) => b.cost - a.cost),
      conversations: [...convs.values()].sort((a, b) => b.cost - a.cost).slice(0, 8),
      daily: [...daily.entries()].map(([date, cost]) => ({ date, cost })),
      webSearch: status.webSearch,
    },
    services: [...services.values()].sort((a, b) => order[a.group] - order[b.group] || b.month.calls - a.month.calls),
    fx: { rate: fx.rate.toNumber(), label: fx.label },
  };
}

export type UsageReport = Awaited<ReturnType<typeof usageReport>>;

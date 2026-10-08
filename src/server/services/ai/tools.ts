/**
 * What the advisor agents can do: read the user's portfolio, journals and investment
 * notes through the app's own services (so every number is the app's number), and
 * propose changes. A proposal only records an AiAction; the user runs it from the chat.
 */
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { priceStats, tradeStats } from '@/domain/ai-analysis';
import type { Dec } from '@/domain/decimal';
import { kstDate, prisma } from '../../db';
import { currentState, dashboard } from '../analytics';
import { listAlerts, portfolioTargets } from '../alerts';
import { getJournal, listJournals } from '../journal';
import { relatedView, topicsOverview } from '../knowledge';
import { liveCandles, stockDetail } from '../market-board';
import { UserError, userGraph } from '../portfolios';
import { assetTraitMap, traitOverview } from '../traits';

export interface ToolContext {
  userId: string;
  conversationId: string;
  toolUseId: string;
}

interface Tool<S extends z.ZodType> {
  def: Anthropic.Beta.BetaTool;
  schema: S;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}

const tool = <S extends z.ZodType>(name: string, description: string, schema: S, run: Tool<S>['run']): Tool<S> => ({
  def: {
    name,
    description,
    input_schema: z.toJSONSchema(schema, { target: 'draft-7' }) as Anthropic.Beta.BetaTool['input_schema'],
    // Inputs stream as generated; they are validated against `schema` before running
    eager_input_streaming: true,
  },
  schema,
  run,
});

const won = (v: Dec | number) => Math.round(typeof v === 'number' ? v : v.toNumber());
const pct = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 1000) / 10);
const decPct = (v: Dec | null | undefined) => (v ? pct(v.toNumber()) : null);

async function findPortfolio(userId: string, ref: string | undefined) {
  if (!ref) return null;
  const p = await prisma.portfolio.findFirst({ where: { userId, OR: [{ id: ref }, { name: ref }] } });
  if (!p) throw new UserError(`포트폴리오 '${ref}'를 찾지 못했습니다. list_portfolios로 이름을 확인하세요.`);
  return p;
}

async function findAsset(userId: string, ref: string) {
  const q = ref.trim();
  const a =
    (await prisma.asset.findFirst({ where: { userId, OR: [{ symbol: q.toUpperCase() }, { symbol: q }, { id: q }, { name: q }] } })) ??
    (await prisma.asset.findFirst({ where: { userId, name: { contains: q, mode: 'insensitive' } } }));
  if (!a) throw new UserError(`'${ref}' 종목을 내 자산에서 찾지 못했습니다. 보유하지 않은 종목은 get_quote로 시세만 볼 수 있습니다.`);
  return a;
}

/** Plain text of a BlockNote document (sage and book bodies). */
function blocksText(content: unknown, max = 4000): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.text === 'string') out.push(o.text);
      walk(o.content);
      walk(o.children);
      if (o.type === 'paragraph' || o.type === 'heading' || o.type === 'bulletListItem' || o.type === 'numberedListItem' || o.type === 'checkListItem' || o.type === 'quote') out.push('\n');
    }
  };
  walk(content);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

// ---------------------------------------------------------------- read

const listPortfolios = tool('list_portfolios', '포트폴리오 이름·구조(상위/하위와 배분 비율)와 각 포트폴리오의 직접 보유 평가액을 봅니다. 다른 도구에 넘길 포트폴리오 이름을 확인할 때 씁니다.', z.object({}), async (_, { userId }) => {
  const [graph, state] = await Promise.all([userGraph(userId), currentState(userId)]);
  const names = new Map(graph.portfolios.map((p) => [p.id, p.name]));
  return {
    portfolios: graph.portfolios.map((p) => ({
      name: p.name,
      directValueKrw: won(state.direct.get(p.id) ?? 0),
      children: graph.edges.filter((e) => e.parentId === p.id).map((e) => ({ name: names.get(e.childId), allocation: decPct(e.allocation) })),
    })),
  };
});

const overview = tool(
  'get_portfolio_overview',
  '순자산 전체 또는 한 포트폴리오의 평가액, 원가, 미실현 손익, 기간 수익률(TWR)과 최대 낙폭, 실현 손익, 배당·이자, 종목별 비중, 자산 유형·통화별 배분을 봅니다. 금액은 원화입니다.',
  z.object({
    portfolio: z.string().optional().describe('포트폴리오 이름. 비우면 순자산 전체'),
    period: z.enum(['1M', '3M', '6M', 'YTD', '1Y', '3Y', 'ALL']).optional().describe('수익률 기간, 기본 1Y'),
  }),
  async ({ portfolio, period }, { userId }) => {
    const p = await findPortfolio(userId, portfolio);
    const d = await dashboard(userId, p?.id ?? null, { period: period ?? '1Y' });
    const s = d.summary;
    return {
      scope: d.scope.name,
      asOf: d.today,
      totalKrw: won(d.total),
      costKrw: won(d.costBase),
      unrealizedKrw: won(d.unrealized),
      period: { from: d.range.start, to: d.range.end, twrPct: s ? decPct(s.twr) : null, maxDrawdownPct: s ? decPct(s.maxDrawdown) : null, pnlKrw: s ? won(s.pnl) : null, realizedKrw: won(d.realized), incomeKrw: won(d.income) },
      holdings: d.holdings.slice(0, 40).map((h) => ({
        name: h.name,
        symbol: h.symbol,
        type: h.type,
        portfolio: h.portfolioName,
        weightPct: pct(h.weight),
        valueKrw: won(h.value),
        unrealizedKrw: won(h.unrealized),
        returnPct: h.costBase.isPos() ? decPct(h.unrealized.div(h.costBase)) : null,
        price: h.price?.toString() ?? null,
        currency: h.currency,
        stalePrice: h.stale,
      })),
      byType: d.allocation.byType.map((x) => ({ label: x.label, sharePct: pct(x.share) })),
      byCurrency: d.allocation.byCurrency.map((x) => ({ label: x.label, sharePct: pct(x.share) })),
      subPortfolios: d.children.map((c) => ({ name: c.name, valueKrw: won(c.value), sharePct: pct(c.share), twrPct: decPct(c.twr) })),
      usdkrw: d.usdkrw.toNumber(),
    };
  },
);

const drift = tool(
  'get_target_drift',
  '포트폴리오별 목표 비중과 지금 비중, 차이(%p), 허용 오차를 벗어났는지, 목표대로 맞추려면 사거나 팔 금액을 봅니다. 포트폴리오를 비우면 목표를 정한 모든 포트폴리오를 봅니다.',
  z.object({ portfolio: z.string().optional().describe('포트폴리오 이름') }),
  async ({ portfolio }, { userId }) => {
    const p = await findPortfolio(userId, portfolio);
    const [state, graph] = await Promise.all([currentState(userId), userGraph(userId)]);
    const list = p ? [p] : await prisma.portfolio.findMany({ where: { userId, targets: { some: {} } } });
    const out = [];
    for (const x of list) {
      const t = await portfolioTargets(userId, x.id, state, graph);
      out.push({
        portfolio: x.name,
        portfolioId: x.id,
        tolerancePctPoint: pct(t.tolerance),
        alertOn: t.alert,
        totalKrw: won(t.report.total),
        rows: t.report.rows.map((r) => ({ key: r.key, label: r.label, sharePct: pct(r.share), targetPct: pct(r.target), diffPctPoint: pct(r.diff), outOfBand: r.breach, tradeKrw: r.trade === null ? null : won(r.trade) })),
      });
    }
    return out.length ? { portfolios: out } : { portfolios: [], note: '목표 비중을 정한 포트폴리오가 없습니다. 각 행의 key가 propose_target_weights에 넘길 항목 키입니다.' };
  },
);

const traits = tool(
  'get_trait_allocation',
  '자산 성질 분류(올웨더 경제 국면, 자산군, 주식 스타일 등)별로 지금 비중과 목표 비중, 차이와 그 성질에 속한 종목을 봅니다.',
  z.object({ group: z.string().optional().describe('분류 이름. 비우면 모두') }),
  async ({ group }, { userId }) => {
    const o = await traitOverview(userId);
    const groups = o.groups.filter((g) => !group || g.name.includes(group));
    return {
      groups: groups.map((g) => ({
        name: g.name,
        base: g.base === 'tagged' ? '지정한 종목끼리의 비중' : '전체 자산 대비 비중',
        slices: g.slices.map((s) => ({ trait: s.label, sharePct: pct(s.share), targetPct: pct(s.target), gapPctPoint: pct(s.gap), excluded: !!s.excluded, assets: s.assets.slice(0, 8).map((a) => a.name) })),
      })),
      untaggedHeld: o.assets.filter((a) => a.held && !a.traitIds.length).map((a) => a.name),
    };
  },
);

const holding = tool(
  'get_holding',
  '내 종목 하나의 Lot(취득일·수량·단가), 최근 거래, 매매일지, 가격 알림, 자산 성질, 연결된 투자 거장·책·메모를 봅니다.',
  z.object({ asset: z.string().describe('종목 코드나 이름, 예: 005930, AAPL, 삼성전자') }),
  async ({ asset }, { userId }) => {
    const a = await findAsset(userId, asset);
    const [holdings, txns, journals, alerts, tags, related] = await Promise.all([
      prisma.holding.findMany({ where: { assetId: a.id }, include: { portfolio: { select: { name: true } }, lots: { where: { qtyRemaining: { gt: 0 } }, orderBy: { acquiredAt: 'asc' } } } }),
      prisma.transaction.findMany({ where: { holding: { assetId: a.id } }, orderBy: { tradeAt: 'desc' }, take: 15 }),
      listJournals(userId, { assetId: a.id }),
      listAlerts(userId),
      assetTraitMap(userId),
      relatedView(userId, { type: 'asset', id: a.id }),
    ]);
    const traitIds = new Set(tags.get(a.id) ?? []);
    const traitNames = traitIds.size ? (await prisma.trait.findMany({ where: { id: { in: [...traitIds] } }, include: { group: { select: { name: true } } } })).map((t) => `${t.group.name}: ${t.name}`) : [];
    return {
      name: a.name,
      symbol: a.symbol,
      type: a.type,
      currency: a.currency,
      traits: traitNames,
      holdings: holdings.map((h) => ({
        portfolio: h.portfolio.name,
        lots: h.lots.map((l) => ({ acquired: kstDate(l.acquiredAt), qty: l.qtyRemaining.toString(), unitCost: l.unitCost.toString(), fxRate: l.fxRate.toString() })),
      })),
      recentTransactions: txns.map((t) => ({ date: kstDate(t.tradeAt), type: t.type, qty: t.qty?.toString() ?? null, price: t.price?.toString() ?? null, memo: t.memo })),
      journals: journals.slice(0, 10).map((j) => ({ title: j.title, date: j.entryDate, status: j.status, targetPrice: j.targetPrice, stopPrice: j.stopPrice, currentPrice: j.currentPrice, reached: j.progress.reached, summary: j.excerpt })),
      priceAlerts: alerts.filter((x) => x.assetId === a.id).map((x) => ({ price: x.price, direction: x.direction, active: x.active, source: x.source, note: x.note })),
      linkedSages: related.sage.map((s) => ({ name: s.label, via: s.direct ? '직접 연결' : s.via.join(', ') })),
      linkedBooks: related.book.map((b) => b.label),
      linkedNotes: related.note.map((n) => n.label),
    };
  },
);

const transactions = tool(
  'get_transactions',
  '거래 내역(매수·매도·입출금·배당 등)을 날짜 역순으로 봅니다.',
  z.object({
    asset: z.string().optional().describe('종목 코드나 이름'),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('시작일 YYYY-MM-DD'),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('종료일 YYYY-MM-DD'),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  async ({ asset, from, to, limit }, { userId }) => {
    const a = asset ? await findAsset(userId, asset) : null;
    const rows = await prisma.transaction.findMany({
      where: {
        portfolio: { userId },
        ...(a ? { holding: { assetId: a.id } } : {}),
        tradeAt: from || to ? { gte: from ? new Date(`${from}T00:00:00+09:00`) : undefined, lte: to ? new Date(`${to}T23:59:59.999+09:00`) : undefined } : undefined,
      },
      include: { holding: { include: { asset: { select: { name: true, symbol: true } } } }, portfolio: { select: { name: true } }, consumptions: { select: { pnlBase: true } } },
      orderBy: { tradeAt: 'desc' },
      take: limit ?? 30,
    });
    return rows.map((t) => ({
      date: kstDate(t.tradeAt),
      type: t.type,
      asset: t.holding?.asset.name ?? null,
      portfolio: t.portfolio.name,
      qty: t.qty?.toString() ?? null,
      price: t.price?.toString() ?? null,
      currency: t.currency,
      cashDelta: t.cashDelta.toString(),
      realizedKrw: t.consumptions.length ? won(t.consumptions.reduce((s, c) => s + Number(c.pnlBase), 0)) : null,
      memo: t.memo,
    }));
  },
);

const quote = tool(
  'get_quote',
  '종목의 현재가, 전일 대비, 거래량을 연결된 증권사·거래소에서 받아 봅니다. 보유하지 않은 종목도 됩니다. 한 번에 5개까지.',
  z.object({ symbols: z.array(z.string()).min(1).max(5).describe('종목 코드, 예: 005930, AAPL, KRW-BTC') }),
  async ({ symbols }, { userId }) => {
    const out = [];
    for (const s of symbols) {
      try {
        const d = await stockDetail(userId, s);
        out.push({ symbol: d.symbol, name: d.name, currency: d.currency, quote: d.quote, held: d.held });
      } catch (e) {
        out.push({ symbol: s, error: e instanceof Error ? e.message : '시세를 받지 못했습니다.' });
      }
    }
    return out;
  },
);

const journals = tool(
  'get_journals',
  '매매일지 목록: 제목, 날짜, 진행 중/종료, 목표 예상 가격과 손절가, 지금 가격과 목표까지 남은 비율, 요약.',
  z.object({ asset: z.string().optional(), status: z.enum(['OPEN', 'CLOSED']).optional() }),
  async ({ asset, status }, { userId }) => {
    const a = asset ? await findAsset(userId, asset) : null;
    const list = await listJournals(userId, { assetId: a?.id, status });
    return list.slice(0, 30).map((j) => ({
      title: j.title,
      asset: j.assetName,
      date: j.entryDate,
      status: j.status,
      targetPrice: j.targetPrice,
      basePrice: j.basePrice,
      stopPrice: j.stopPrice,
      targetDate: j.targetDate,
      currentPrice: j.currentPrice,
      progressPct: pct(j.progress.ratio),
      reached: j.progress.reached,
      summary: j.excerpt,
    }));
  },
);

const notes = tool(
  'get_investment_notes',
  '투자 노트: 정리한 투자 거장(핵심 철학, 키워드, 자산 성질, 철학에 맞는 내 종목), 독서 노트, 키워드, 최근 메모. query를 주면 그 낱말이 든 것만 봅니다.',
  z.object({ query: z.string().optional() }),
  async ({ query }, { userId }) => {
    const q = query?.trim();
    const like = q ? { contains: q, mode: 'insensitive' as const } : undefined;
    const [sages, books, recent, topics] = await Promise.all([
      prisma.sage.findMany({ where: { userId, ...(like ? { OR: [{ name: like }, { oneLine: like }, { contentText: like }] } : {}) }, orderBy: { name: 'asc' } }),
      prisma.book.findMany({ where: { userId, ...(like ? { OR: [{ title: like }, { oneLine: like }, { contentText: like }] } : {}) }, orderBy: { updatedAt: 'desc' }, take: 20 }),
      prisma.note.findMany({ where: { userId, ...(like ? { body: like } : {}) }, orderBy: { updatedAt: 'desc' }, take: 15 }),
      topicsOverview(userId),
    ]);
    const sageViews = [];
    for (const s of sages) {
      const r = await relatedView(userId, { type: 'sage', id: s.id });
      sageViews.push({ name: s.name, oneLine: s.oneLine, keywords: r.topic.filter((t) => t.direct).map((t) => t.label), traits: r.trait.map((t) => t.label), fittingAssets: r.asset.map((a) => `${a.label}(${a.via.join(', ') || '직접'})`) });
    }
    return {
      sages: sageViews,
      books: books.map((b) => ({ title: b.title, author: b.author, status: b.status, oneLine: b.oneLine })),
      notes: recent.map((n) => ({ date: kstDate(n.updatedAt), body: n.body.slice(0, 400) })),
      keywords: topics.map((t) => ({ name: t.name, description: t.description, links: t.links })),
    };
  },
);

const sageProfile = tool(
  'get_sage_profile',
  '투자 노트에 정리한 투자 거장 한 명의 전체 정리(핵심 원칙, 대표 저서, 내가 적은 내용)와 키워드·자산 성질, 그 철학에 맞는 내 종목.',
  z.object({ name: z.string().describe('거장 이름, 예: 워런 버핏') }),
  async ({ name }, { userId }) => {
    const s = await prisma.sage.findFirst({ where: { userId, OR: [{ name }, { name: { contains: name } }, { nameEn: { contains: name, mode: 'insensitive' } }] } });
    if (!s) throw new UserError(`'${name}'을(를) 투자 노트에서 찾지 못했습니다.`);
    return sageSummary(userId, s.id);
  },
);

const priceHistory = tool(
  'get_price_history',
  '종목의 일봉으로 계산한 주가 흐름: 1주·1개월·3개월·6개월·1년 수익률, 52주 고가·저가와 거리, 20·60·120일 이동평균, 20일 변동성(연율), 20일 평균 거래량. 보유하지 않은 종목도 됩니다.',
  z.object({ symbol: z.string().describe('종목 코드, 예: 005930, NVDA, KRW-BTC') }),
  async ({ symbol }, { userId }) => {
    const v = await liveCandles(userId, symbol, '1d', 260);
    const stats = priceStats(v.candles);
    if (!stats) throw new UserError(`${symbol}의 일봉을 받지 못했습니다. 연결된 증권사·거래소에서 이 종목 시세를 주는지 확인하세요.`);
    return { symbol, source: v.source, ...stats };
  },
);

async function findJournal(userId: string, ref: string) {
  const q = ref.trim();
  const j =
    (await prisma.journalEntry.findFirst({ where: { userId, OR: [{ id: q }, { title: q }] } })) ??
    (await prisma.journalEntry.findFirst({ where: { userId, title: { contains: q, mode: 'insensitive' } }, orderBy: { entryDate: 'desc' } }));
  if (!j) throw new UserError(`'${ref}' 매매일지를 찾지 못했습니다. get_journals로 제목을 확인하세요.`);
  return j;
}

const journal = tool(
  'get_journal',
  '매매일지 한 편 전체: 속성(목표 예상 가격, 기준 가격, 손절가, 목표 기한, 사용자 속성), 본문, 연결된 거래, 지금 가격과 목표까지의 진행, 목표가·손절가 알림 상태.',
  z.object({ journal: z.string().describe('일지 제목(일부도 됨)이나 id') }),
  async ({ journal: ref }, { userId }) => {
    const j = await getJournal(userId, (await findJournal(userId, ref)).id);
    const row = await prisma.journalEntry.findUniqueOrThrow({ where: { id: j!.id }, select: { contentText: true } });
    return {
      id: j!.id,
      title: j!.title,
      asset: `${j!.assetName}${j!.symbol ? ` (${j!.symbol})` : ''}`,
      date: j!.entryDate,
      status: j!.status,
      currency: j!.currency,
      targetPrice: j!.targetPrice,
      basePrice: j!.basePrice,
      stopPrice: j!.stopPrice,
      targetDate: j!.targetDate,
      currentPrice: j!.currentPrice,
      progressPct: pct(j!.progress.ratio),
      reached: j!.progress.reached,
      properties: j!.fields.filter((f) => f.value).map((f) => ({ name: f.label, value: f.value })),
      body: row.contentText.slice(0, 6000),
      transactions: j!.txns.map((t) => ({ date: t.tradeAt.slice(0, 10), type: t.type, qty: t.qty, price: t.price, portfolio: t.portfolioName })),
      alerts: j!.alerts,
    };
  },
);

const tradeReview = tool(
  'get_trade_review',
  '실현된 매도 전체를 모아 본 매매 성적: 매도 수, 승률, 평균 수익·손실률, 손익비(profit factor), 실현 손익, 이긴·진 매매의 평균 보유 기간, 일지 없이 한 매도 수, 가장 잘한·못한 매매. 기간을 줄 수 있습니다.',
  z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  async ({ from, to }, { userId }) => {
    const sells = await prisma.transaction.findMany({
      where: { type: 'SELL', portfolio: { userId }, tradeAt: from || to ? { gte: from ? new Date(`${from}T00:00:00+09:00`) : undefined, lte: to ? new Date(`${to}T23:59:59.999+09:00`) : undefined } : undefined },
      include: { consumptions: true, holding: { include: { asset: { select: { name: true } } } }, journals: { select: { entryId: true }, take: 1 } },
      orderBy: { tradeAt: 'desc' },
      take: 1000,
    });
    const rows = sells
      .filter((t) => t.consumptions.length)
      .map((t) => {
        const qty = t.consumptions.reduce((s, c) => s + Number(c.qty), 0);
        return {
          date: kstDate(t.tradeAt),
          asset: t.holding?.asset.name ?? '—',
          pnlKrw: t.consumptions.reduce((s, c) => s + Number(c.pnlBase), 0),
          cost: t.consumptions.reduce((s, c) => s + Number(c.cost), 0),
          pnl: t.consumptions.reduce((s, c) => s + Number(c.pnl), 0),
          holdingDays: qty ? Math.round(t.consumptions.reduce((s, c) => s + c.holdingDays * Number(c.qty), 0) / qty) : 0,
          hasJournal: t.journals.length > 0,
        };
      });
    const [buys, buysWithJournal, open, closed] = await Promise.all([
      prisma.transaction.count({ where: { type: 'BUY', portfolio: { userId } } }),
      prisma.transaction.count({ where: { type: 'BUY', portfolio: { userId }, journals: { some: {} } } }),
      prisma.journalEntry.count({ where: { userId, status: 'OPEN' } }),
      prisma.journalEntry.count({ where: { userId, status: 'CLOSED' } }),
    ]);
    return { period: { from: from ?? null, to: to ?? null }, ...tradeStats(rows), buys, buysWithJournal, journalsOpen: open, journalsClosed: closed };
  },
);

export async function sageSummary(userId: string, sageId: string) {
  const s = await prisma.sage.findFirstOrThrow({ where: { id: sageId, userId } });
  const r = await relatedView(userId, { type: 'sage', id: s.id });
  return {
    name: s.name,
    nameEn: s.nameEn,
    lived: s.lived,
    affiliation: s.affiliation,
    oneLine: s.oneLine,
    profile: blocksText(s.content),
    keywords: r.topic.map((t) => t.label),
    traits: r.trait.map((t) => t.label),
    fittingAssets: r.asset.map((a) => ({ name: a.label, via: a.direct ? '직접 연결' : a.via.join(', ') })),
    books: r.book.map((b) => b.label),
  };
}

// ---------------------------------------------------------------- proposals

async function propose(ctx: ToolContext, kind: string, payload: unknown, summary: string) {
  await prisma.aiAction.create({ data: { conversationId: ctx.conversationId, userId: ctx.userId, toolUseId: ctx.toolUseId, kind, payload: payload as object, summary } });
  return { status: 'proposed', note: '사용자 화면에 확인 카드로 보여 줬습니다. 사용자가 실행을 눌러야 반영되며, 아직 반영되지 않았습니다. 답변에서 실행 여부를 단정하지 마세요.' };
}

const proposeNote = tool(
  'propose_note',
  '투자 노트에 메모를 남기자고 제안합니다(사용자가 확인해야 저장). 리서치 리포트 요약도 여기에 남깁니다. 본문에 #키워드를 쓰면 키워드로 묶이고, assets에 적은 종목이 연결됩니다.',
  z.object({ body: z.string().min(1).max(10000), assets: z.array(z.string()).max(5).optional().describe('연결할 내 종목 코드나 이름') }),
  async (input, ctx) => {
    const assets = [];
    for (const a of input.assets ?? []) assets.push(await findAsset(ctx.userId, a));
    return propose(ctx, 'note', { body: input.body, assetIds: assets.map((a) => a.id) }, `메모 저장: ${input.body.split('\n')[0].slice(0, 60)}`);
  },
);

const proposeAlert = tool(
  'propose_price_alert',
  '가격 알림을 만들자고 제안합니다(사용자가 확인해야 생성). 가격이 그 값 이상 또는 이하가 되면 알림이 갑니다.',
  z.object({
    asset: z.string().describe('내 종목 코드나 이름'),
    price: z.number().positive(),
    direction: z.enum(['ABOVE', 'BELOW']).optional().describe('비우면 지금 가격 기준으로 자동'),
    note: z.string().max(100).optional(),
  }),
  async (input, ctx) => {
    const a = await findAsset(ctx.userId, input.asset);
    const dir = input.direction === 'ABOVE' ? '이상' : input.direction === 'BELOW' ? '이하' : '도달';
    return propose(ctx, 'price_alert', { assetId: a.id, price: String(input.price), direction: input.direction ?? '', note: input.note ?? '' }, `가격 알림: ${a.name} ${input.price.toLocaleString('ko-KR')} ${a.currency} ${dir}`);
  },
);

const proposeTargets = tool(
  'propose_target_weights',
  '포트폴리오의 목표 비중과 허용 오차를 바꾸자고 제안합니다(사용자가 확인해야 저장). 항목 키는 get_target_drift가 돌려준 key입니다(종목, 하위 포트폴리오 P:…, 현금 CASH). 적지 않은 항목은 목표가 없어집니다.',
  z.object({
    portfolio: z.string(),
    targets: z.array(z.object({ key: z.string(), weightPct: z.number().min(0).max(100) })).min(1).max(40),
    tolerancePctPoint: z.number().min(0.1).max(50),
    alert: z.boolean().optional().describe('벗어나면 알림, 기본 true'),
  }),
  async (input, ctx) => {
    const p = await findPortfolio(ctx.userId, input.portfolio);
    const sum = input.targets.reduce((s, t) => s + t.weightPct, 0);
    if (sum > 100.0001) throw new UserError(`목표 비중 합이 ${sum}%입니다. 100%를 넘을 수 없습니다.`);
    const [state, graph] = await Promise.all([currentState(ctx.userId), userGraph(ctx.userId)]);
    const view = await portfolioTargets(ctx.userId, p!.id, state, graph);
    const labels = new Map(view.report.rows.map((r) => [r.key, r.label]));
    const unknown = input.targets.filter((t) => !labels.has(t.key) && t.key !== 'CASH');
    if (unknown.length) throw new UserError(`모르는 항목 키: ${unknown.map((t) => t.key).join(', ')}. get_target_drift의 key를 쓰세요.`);
    const list = input.targets.map((t) => `${labels.get(t.key) ?? '현금'} ${t.weightPct}%`).join(', ');
    return propose(
      ctx,
      'target_weights',
      { portfolioId: p!.id, targets: Object.fromEntries(input.targets.map((t) => [t.key, String(t.weightPct)])), tolerance: String(input.tolerancePctPoint), alert: input.alert ?? true },
      `${p!.name} 목표 비중: ${list} · 허용 오차 ±${input.tolerancePctPoint}%p`,
    );
  },
);

const proposeReview = tool(
  'propose_journal_review',
  '매매일지 본문 끝에 복기 내용을 덧붙이자고 제안합니다(사용자가 확인해야 저장). review는 "## 소제목", "- 목록" 줄을 쓸 수 있는 글입니다. close를 true로 하면 일지를 종료로 바꿉니다.',
  z.object({ journal: z.string().describe('일지 제목이나 id'), review: z.string().min(1).max(6000), close: z.boolean().optional() }),
  async (input, ctx) => {
    const j = await findJournal(ctx.userId, input.journal);
    return propose(ctx, 'journal_review', { entryId: j.id, review: input.review, close: !!input.close }, `'${j.title}' 일지에 복기 덧붙이기${input.close ? ' · 종료로 바꾸기' : ''}`);
  },
);

const proposeDraft = tool(
  'propose_journal_draft',
  '새 매매일지 초안을 만들자고 제안합니다(사용자가 확인해야 생성). 목표 예상 가격은 필수입니다. 보유하지 않은 종목도 종목 코드로 만들 수 있습니다. body는 "## 소제목", "- 목록" 줄을 쓸 수 있는 매수 근거·시나리오·리스크 글입니다.',
  z.object({
    symbol: z.string().describe('종목 코드, 예: 005930, NVDA'),
    title: z.string().min(1).max(80),
    targetPrice: z.number().positive(),
    basePrice: z.number().positive().optional(),
    stopPrice: z.number().positive().optional(),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    body: z.string().min(1).max(8000),
  }),
  async (input, ctx) => {
    const own = await prisma.asset.findFirst({ where: { userId: ctx.userId, symbol: input.symbol.trim().toUpperCase() } });
    const cur = own?.currency ?? '';
    return propose(
      ctx,
      'journal_draft',
      input,
      `새 매매일지: ${input.title} · 목표 ${input.targetPrice.toLocaleString('ko-KR')}${cur ? ` ${cur}` : ''}${input.stopPrice ? ` · 손절 ${input.stopPrice.toLocaleString('ko-KR')}` : ''}`,
    );
  },
);

const TOOLS = [listPortfolios, overview, drift, traits, holding, transactions, quote, priceHistory, journals, journal, tradeReview, notes, sageProfile, proposeNote, proposeAlert, proposeTargets, proposeReview, proposeDraft] as Tool<z.ZodType>[];

export const toolDefs: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => t.def);

/** Runs one client tool call. Never throws: errors go back to the model as is_error results. */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const t = TOOLS.find((x) => x.def.name === name);
  if (!t) return { content: `알 수 없는 도구: ${name}`, isError: true };
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) return { content: JSON.stringify({ INVALID_INPUT: JSON.stringify(input), issues: parsed.error.issues.map((i) => i.message) }), isError: true };
  try {
    return { content: JSON.stringify(await t.run(parsed.data, ctx)), isError: false };
  } catch (e) {
    if (e instanceof UserError) return { content: e.message, isError: true };
    console.error('[ai] tool failed', name, e);
    return { content: '도구 실행 중 오류가 났습니다.', isError: true };
  }
}

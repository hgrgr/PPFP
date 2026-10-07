import type { LotMethod, Prisma } from '@prisma/client';
import { Dec } from '@/domain/decimal';
import { checkEdge, descendants, normalizeEdges, type Edge } from '@/domain/portfolio-graph';
import { dec, prisma } from '../db';

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export async function audit(
  tx: Prisma.TransactionClient | typeof prisma,
  userId: string,
  entity: string,
  entityId: string,
  action: string,
  before?: unknown,
  after?: unknown,
) {
  const json = (v: unknown) => (v === undefined ? undefined : (JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))) as Prisma.InputJsonValue));
  await tx.auditLog.create({ data: { userId, entity, entityId, action, before: json(before), after: json(after) } });
}

export async function ownedPortfolio(userId: string, portfolioId: string) {
  const p = await prisma.portfolio.findFirst({ where: { id: portfolioId, userId } });
  if (!p) throw new UserError('포트폴리오를 찾을 수 없습니다.');
  return p;
}

export async function userGraph(userId: string) {
  const portfolios = await prisma.portfolio.findMany({
    where: { userId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  const rows = await prisma.portfolioEdge.findMany({ where: { parent: { userId } } });
  const edges: Edge[] = normalizeEdges(rows.map((r) => ({ parentId: r.parentId, childId: r.childId, allocation: dec(r.allocation).toString() })));
  return { portfolios, edges };
}

export async function createPortfolio(
  userId: string,
  input: { name: string; description?: string; color?: string; lotMethod?: LotMethod; parentId?: string; allocation?: string },
) {
  const name = input.name.trim();
  if (!name || name.length > 60) throw new UserError('이름은 1~60자로 입력하세요.');
  return prisma.$transaction(async (tx) => {
    const p = await tx.portfolio.create({
      data: { userId, name, description: input.description?.trim() || null, color: input.color || undefined, lotMethod: input.lotMethod },
    });
    if (input.parentId) {
      await linkWith(tx, userId, input.parentId, p.id, input.allocation ?? '1');
    }
    await audit(tx, userId, 'portfolio', p.id, 'create', undefined, p);
    return p;
  });
}

async function linkWith(tx: Prisma.TransactionClient, userId: string, parentId: string, childId: string, allocation: string, update = false) {
  const owned = await tx.portfolio.count({ where: { userId, id: { in: [parentId, childId] } } });
  if (owned !== 2) throw new UserError('포트폴리오를 찾을 수 없습니다.');
  // Lock the user's edges for this check so two concurrent links can't both pass.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))::text`;
  const rows = await tx.portfolioEdge.findMany({ where: { parent: { userId } } });
  const edges = normalizeEdges(rows.map((r) => ({ parentId: r.parentId, childId: r.childId, allocation: dec(r.allocation).toString() })));
  const alloc = Dec.of(allocation);
  const check = checkEdge(edges, { parentId, childId, allocation: alloc }, { allowUpdate: update });
  if (!check.ok) throw new UserError(check.message);
  await tx.portfolioEdge.upsert({
    where: { parentId_childId: { parentId, childId } },
    create: { parentId, childId, allocation: alloc.toString() },
    update: { allocation: alloc.toString() },
  });
  await audit(tx, userId, 'portfolio_edge', `${parentId}>${childId}`, update ? 'update' : 'create', undefined, { allocation: alloc.toString() });
}

/** Link child under parent (allocation as a fraction, e.g. "0.6"). */
export async function linkPortfolio(userId: string, parentId: string, childId: string, allocation: string, update = false) {
  await prisma.$transaction((tx) => linkWith(tx, userId, parentId, childId, allocation, update));
}

export async function unlinkPortfolio(userId: string, parentId: string, childId: string) {
  await prisma.$transaction(async (tx) => {
    const edge = await tx.portfolioEdge.findFirst({ where: { parentId, childId, parent: { userId } } });
    if (!edge) throw new UserError('연결을 찾을 수 없습니다.');
    await tx.portfolioEdge.delete({ where: { parentId_childId: { parentId, childId } } });
    await audit(tx, userId, 'portfolio_edge', `${parentId}>${childId}`, 'delete', { allocation: edge.allocation.toString() });
  });
}

export async function updatePortfolio(
  userId: string,
  id: string,
  input: { name?: string; description?: string; color?: string; lotMethod?: LotMethod; archived?: boolean },
) {
  const before = await ownedPortfolio(userId, id);
  const name = input.name?.trim();
  if (name !== undefined && (!name || name.length > 60)) throw new UserError('이름은 1~60자로 입력하세요.');
  const p = await prisma.portfolio.update({
    where: { id },
    data: {
      name,
      description: input.description === undefined ? undefined : input.description.trim() || null,
      color: input.color,
      lotMethod: input.lotMethod,
      archived: input.archived,
    },
  });
  await audit(prisma, userId, 'portfolio', id, 'update', before, p);
  return p;
}

/** Only empty portfolios (no holdings, no transactions, no children) can be deleted. */
export async function deletePortfolio(userId: string, id: string) {
  const p = await ownedPortfolio(userId, id);
  const [holdings, txns, kids] = await Promise.all([
    prisma.holding.count({ where: { portfolioId: id } }),
    prisma.transaction.count({ where: { portfolioId: id } }),
    prisma.portfolioEdge.count({ where: { parentId: id } }),
  ]);
  if (holdings || txns || kids) {
    throw new UserError('보유 종목·거래·하위 포트폴리오가 없는 포트폴리오만 삭제할 수 있습니다. 대신 보관 처리하세요.');
  }
  await prisma.portfolio.delete({ where: { id } });
  await audit(prisma, userId, 'portfolio', id, 'delete', p);
}

/** Portfolios that may be linked under `parentId` without creating a cycle. */
export function linkCandidates(portfolioIds: string[], edges: Edge[], parentId: string): string[] {
  const blocked = new Set<string>([parentId]);
  // a parent's ancestors can't become its children
  for (const id of portfolioIds) if (descendants(edges, id).has(parentId)) blocked.add(id);
  for (const e of edges) if (e.parentId === parentId) blocked.add(e.childId);
  return portfolioIds.filter((id) => !blocked.has(id));
}

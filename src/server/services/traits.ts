import type { AssetType } from '@prisma/client';
import { Dec } from '@/domain/decimal';
import { PRESETS, suggestTraits, targetsValid, traitAllocation, type TraitDef, type TraitSlice } from '@/domain/traits';
import { prisma } from '../db';
import { currentState } from './analytics';
import { ensureListedAsset } from './assets';
import { UserError } from './portfolios';

export interface TraitView extends TraitDef {
  description: string | null;
}

export interface TraitGroupView {
  id: string;
  name: string;
  description: string | null;
  preset: string | null;
  cashTraitId: string | null;
  base: 'all' | 'tagged';
  traits: TraitView[];
  /** Example targets the preset offers, if any */
  example: string | null;
}

async function ownGroup(userId: string, groupId: string) {
  const g = await prisma.traitGroup.findFirst({ where: { id: groupId, userId }, include: { traits: { orderBy: { sortOrder: 'asc' } } } });
  if (!g) throw new UserError('분류를 찾을 수 없습니다.');
  return g;
}

export async function traitGroups(userId: string): Promise<TraitGroupView[]> {
  const groups = await prisma.traitGroup.findMany({ where: { userId }, include: { traits: { orderBy: { sortOrder: 'asc' } } }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    preset: g.preset,
    cashTraitId: g.cashTraitId,
    base: g.base === 'tagged' ? 'tagged' : 'all',
    example: PRESETS.find((p) => p.key === g.preset)?.example?.label ?? null,
    traits: g.traits.map((t) => ({ id: t.id, name: t.name, color: t.color, description: t.description, targetWeight: t.targetWeight === null ? null : Number(t.targetWeight) })),
  }));
}

/** asset id → trait ids, across all groups */
export async function assetTraitMap(userId: string): Promise<Map<string, string[]>> {
  const links = await prisma.assetTrait.findMany({ where: { asset: { userId } } });
  const m = new Map<string, string[]>();
  for (const l of links) m.set(l.assetId, [...(m.get(l.assetId) ?? []), l.traitId]);
  return m;
}

/** Positive KRW value per held asset, and the total of portfolio cash. */
export async function holdingValues(userId: string) {
  const s = await currentState(userId);
  const byAsset = new Map<string, number>();
  for (const h of s.holdings) {
    if (h.type === 'LIABILITY' || !h.valueFull.isPos()) continue;
    byAsset.set(h.assetId, (byAsset.get(h.assetId) ?? 0) + h.valueFull.toNumber());
  }
  const cash = Dec.sum([...s.cashByPortfolio.values()].flat().map((c) => c.krw)).toNumber();
  return { byAsset, cash: Math.max(0, cash) };
}

// ── groups ──────────────────────────────────────────

export async function createGroupFromPreset(userId: string, key: string, autoTag: boolean): Promise<string> {
  const p = PRESETS.find((x) => x.key === key);
  if (!p) throw new UserError('알 수 없는 분류입니다.');
  if (await prisma.traitGroup.findFirst({ where: { userId, preset: key } })) throw new UserError(`'${p.name}' 분류는 이미 있습니다.`);
  const count = await prisma.traitGroup.count({ where: { userId } });
  const g = await prisma.traitGroup.create({
    data: {
      userId,
      name: p.name,
      description: p.description,
      preset: p.key,
      base: p.base ?? 'all',
      sortOrder: count,
      traits: { create: p.traits.map((t, i) => ({ name: t.name, color: t.color, description: t.description, sortOrder: i })) },
    },
    include: { traits: true },
  });
  if (p.cashTrait) {
    const cashTrait = g.traits.find((t) => t.name === p.cashTrait);
    await prisma.traitGroup.update({ where: { id: g.id }, data: { cashTraitId: cashTrait?.id ?? null } });
  }
  if (autoTag) await applySuggestions(userId, g.id);
  return g.id;
}

export async function createCustomGroup(userId: string, name: string, traitNames: string[]): Promise<string> {
  const n = name.trim().slice(0, 40);
  if (!n) throw new UserError('분류 이름을 입력하세요.');
  const names = [...new Set(traitNames.map((t) => t.trim().slice(0, 30)).filter(Boolean))];
  if (names.length < 2) throw new UserError('성질을 두 개 이상 쉼표로 나눠 입력하세요.');
  if (names.length > 20) throw new UserError('성질은 20개까지입니다.');
  const count = await prisma.traitGroup.count({ where: { userId } });
  if (count >= 20) throw new UserError('분류는 20개까지 만들 수 있습니다.');
  const palette = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#7a5af8', '#c2410c', '#008300'];
  const g = await prisma.traitGroup.create({
    data: { userId, name: n, sortOrder: count, traits: { create: names.map((t, i) => ({ name: t, color: palette[i % palette.length], sortOrder: i })) } },
  });
  return g.id;
}

export async function deleteGroup(userId: string, groupId: string) {
  await ownGroup(userId, groupId);
  await prisma.traitGroup.delete({ where: { id: groupId } });
}

export interface TraitEdit {
  id?: string;
  name: string;
  color: string;
  /** percent, '' for none */
  target: string;
  description?: string;
}

/** Replace a group's name, cash trait and trait list (traits left out are deleted with their tags). */
export async function saveGroup(userId: string, groupId: string, input: { name: string; cashTrait: string; base?: string; traits: TraitEdit[] }) {
  const g = await ownGroup(userId, groupId);
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new UserError('분류 이름을 입력하세요.');
  const traits = input.traits.map((t, i) => {
    const n = t.name.trim().slice(0, 30);
    if (!n) throw new UserError(`${i + 1}번째 성질의 이름을 입력하세요.`);
    if (!/^#[0-9a-fA-F]{6}$/.test(t.color)) throw new UserError(`'${n}' 색을 확인하세요.`);
    const target = t.target.trim() === '' ? null : Number(t.target.replace('%', '')) / 100;
    if (target !== null && !Number.isFinite(target)) throw new UserError(`'${n}' 목표 비중은 숫자로 입력하세요.`);
    return { ...t, name: n, target };
  });
  if (!traits.length) throw new UserError('성질이 하나 이상 있어야 합니다.');
  if (new Set(traits.map((t) => t.name)).size !== traits.length) throw new UserError('같은 이름의 성질이 있습니다.');
  if (!targetsValid(traits.map((t) => t.target))) throw new UserError('목표 비중은 0~100%이고 합이 100%를 넘을 수 없습니다.');
  const keep = new Set(traits.filter((t) => t.id).map((t) => t.id!));
  if ([...keep].some((id) => !g.traits.some((t) => t.id === id))) throw new UserError('성질 목록이 바뀌었습니다. 새로고침 후 다시 시도하세요.');
  await prisma.$transaction(async (tx) => {
    await tx.trait.deleteMany({ where: { groupId, id: { notIn: [...keep] } } });
    // Free the names first so renames that swap names don't collide
    for (const t of traits) if (t.id) await tx.trait.update({ where: { id: t.id }, data: { name: `__tmp_${t.id}` } });
    const ids: string[] = [];
    for (const [i, t] of traits.entries()) {
      const data = { name: t.name, color: t.color, targetWeight: t.target === null ? null : t.target.toString(), description: t.description?.trim().slice(0, 200) || null, sortOrder: i };
      ids.push(t.id ? (await tx.trait.update({ where: { id: t.id }, data })).id : (await tx.trait.create({ data: { ...data, groupId } })).id);
    }
    const cashIdx = traits.findIndex((t) => (t.id ?? `new:${t.name}`) === input.cashTrait || t.name === input.cashTrait);
    await tx.traitGroup.update({ where: { id: groupId }, data: { name, cashTraitId: cashIdx >= 0 ? ids[cashIdx] : null, ...(input.base === 'all' || input.base === 'tagged' ? { base: input.base } : {}) } });
  });
}

/** Fill a preset group's targets with its published example. */
export async function applyExampleTargets(userId: string, groupId: string) {
  const g = await ownGroup(userId, groupId);
  const ex = PRESETS.find((p) => p.key === g.preset)?.example;
  if (!ex) throw new UserError('이 분류에는 예시 비중이 없습니다.');
  await prisma.$transaction(g.traits.map((t) => prisma.trait.update({ where: { id: t.id }, data: { targetWeight: ex.targets[t.name] === undefined ? null : ex.targets[t.name].toString() } })));
}

// ── tagging ─────────────────────────────────────────

export async function setAssetTraits(userId: string, assetId: string, groupId: string, traitIds: string[]) {
  const [asset, g] = await Promise.all([prisma.asset.findFirst({ where: { id: assetId, userId } }), ownGroup(userId, groupId)]);
  if (!asset) throw new UserError('종목을 찾을 수 없습니다.');
  const valid = new Set(g.traits.map((t) => t.id));
  const ids = [...new Set(traitIds)].filter((id) => valid.has(id));
  await prisma.$transaction([
    prisma.assetTrait.deleteMany({ where: { assetId, traitId: { in: [...valid] } } }),
    prisma.assetTrait.createMany({ data: ids.map((traitId) => ({ assetId, traitId })) }),
  ]);
}

/** Tag every untagged asset with what the preset suggests from its type and name. Returns how many were tagged. */
export async function applySuggestions(userId: string, groupId: string): Promise<number> {
  const g = await ownGroup(userId, groupId);
  if (!g.preset) return 0;
  const byName = new Map(g.traits.map((t) => [t.name, t.id]));
  const ids = new Set(g.traits.map((t) => t.id));
  const assets = await prisma.asset.findMany({ where: { userId }, include: { traits: true } });
  const data: { assetId: string; traitId: string }[] = [];
  let tagged = 0;
  for (const a of assets) {
    if (a.traits.some((l) => ids.has(l.traitId))) continue;
    const names = suggestTraits(g.preset, a);
    const traitIds = names.map((n) => byName.get(n)).filter((x): x is string => !!x);
    if (traitIds.length) tagged++;
    for (const traitId of traitIds) data.push({ assetId: a.id, traitId });
  }
  if (data.length) await prisma.assetTrait.createMany({ data, skipDuplicates: true });
  return tagged;
}

/** Start tracking a watchlist stock as an asset so it can be tagged (and written about) before buying. */
export async function trackWatchItem(userId: string, symbol: string): Promise<string> {
  const w = await prisma.watchItem.findFirst({ where: { userId, symbol } });
  if (!w) throw new UserError('관심종목을 찾을 수 없습니다.');
  const a = await ensureListedAsset(userId, w.symbol, { name: w.name, currency: w.currency === 'USD' ? 'USD' : 'KRW', market: w.market });
  return a.id;
}

// ── overview ────────────────────────────────────────

export interface TraitAssetRow {
  id: string;
  name: string;
  symbol: string | null;
  type: AssetType;
  value: number;
  held: boolean;
  traitIds: string[];
}

export interface TraitOverview {
  groups: (TraitGroupView & { slices: TraitSlice[]; total: number })[];
  assets: TraitAssetRow[];
  /** Watchlist stocks not tracked as assets yet */
  watch: { symbol: string; name: string }[];
  cash: number;
}

export async function traitOverview(userId: string): Promise<TraitOverview> {
  const [groups, tags, values, assets, watch] = await Promise.all([
    traitGroups(userId),
    assetTraitMap(userId),
    holdingValues(userId),
    prisma.asset.findMany({ where: { userId, type: { not: 'LIABILITY' } }, orderBy: { name: 'asc' } }),
    prisma.watchItem.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
  ]);
  const rows: TraitAssetRow[] = assets
    .map((a) => ({ id: a.id, name: a.name, symbol: a.symbol, type: a.type, value: values.byAsset.get(a.id) ?? 0, held: values.byAsset.has(a.id), traitIds: tags.get(a.id) ?? [] }))
    .sort((x, y) => y.value - x.value || x.name.localeCompare(y.name));
  const items = rows.filter((r) => r.held).map((r) => ({ assetId: r.id, name: r.name, value: r.value }));
  const tracked = new Set(assets.map((a) => a.symbol));
  return {
    groups: groups.map((g) => ({ ...g, ...traitAllocation(g.traits, items, tags, { value: values.cash, traitId: g.cashTraitId }, g.base) })),
    assets: rows,
    watch: watch.filter((w) => !tracked.has(w.symbol)).map((w) => ({ symbol: w.symbol, name: w.name })),
    cash: values.cash,
  };
}

import type { Prisma } from '@prisma/client';
import { sanitizeContent, plainText, JournalInputError } from '@/domain/journal';
import {
  BOOK_CONTENT,
  canonical,
  hashtags,
  isKType,
  key,
  related,
  SAGE_PRESETS,
  sageContent,
  TOPIC_PRESETS,
  type KRef,
  type KType,
} from '@/domain/knowledge';
import { dbDate, prisma } from '../db';
import { UserError } from './portfolios';
import { assetTraitMap } from './traits';

const guard = async <T,>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof JournalInputError) throw new UserError(e.message);
    throw e;
  }
};

// ── items as the UI shows them ──────────────────────

export interface KItem extends KRef {
  label: string;
  sub?: string;
  color?: string;
  href: string;
}

/** Labels and links for refs; refs that no longer exist (or are not the user's) are dropped. */
export async function describe(userId: string, refs: KRef[]): Promise<Map<string, KItem>> {
  const ids = (t: KType) => [...new Set(refs.filter((r) => r.type === t).map((r) => r.id))];
  const [notes, books, sages, topics, traits, assets] = await Promise.all([
    ids('note').length ? prisma.note.findMany({ where: { userId, id: { in: ids('note') } } }) : [],
    ids('book').length ? prisma.book.findMany({ where: { userId, id: { in: ids('book') } } }) : [],
    ids('sage').length ? prisma.sage.findMany({ where: { userId, id: { in: ids('sage') } } }) : [],
    ids('topic').length ? prisma.topic.findMany({ where: { userId, id: { in: ids('topic') } } }) : [],
    ids('trait').length ? prisma.trait.findMany({ where: { id: { in: ids('trait') }, group: { userId } }, include: { group: true } }) : [],
    ids('asset').length ? prisma.asset.findMany({ where: { userId, id: { in: ids('asset') } }, include: { holdings: { select: { id: true }, take: 1 } } }) : [],
  ]);
  const m = new Map<string, KItem>();
  const put = (i: KItem) => m.set(key(i), i);
  for (const n of notes) put({ type: 'note', id: n.id, label: n.body.split('\n')[0].slice(0, 60) || '(빈 메모)', sub: n.updatedAt.toISOString().slice(0, 10), href: `/notes?open=${n.id}` });
  for (const b of books) put({ type: 'book', id: b.id, label: b.title, sub: b.author ?? undefined, href: `/books/${b.id}` });
  for (const s of sages) put({ type: 'sage', id: s.id, label: s.name, sub: s.oneLine ?? undefined, href: `/sages/${s.id}` });
  for (const t of topics) put({ type: 'topic', id: t.id, label: t.name, color: t.color, href: `/topics?t=${t.id}` });
  for (const t of traits) put({ type: 'trait', id: t.id, label: t.name, sub: t.group.name, color: t.color, href: `/traits?g=${t.groupId}` });
  for (const a of assets) put({ type: 'asset', id: a.id, label: a.name, sub: a.symbol ?? undefined, href: a.holdings[0] ? `/holdings/${a.holdings[0].id}` : `/journal?asset=${a.id}` });
  return m;
}

async function owns(userId: string, r: KRef): Promise<boolean> {
  switch (r.type) {
    case 'note':
      return !!(await prisma.note.findFirst({ where: { id: r.id, userId }, select: { id: true } }));
    case 'book':
      return !!(await prisma.book.findFirst({ where: { id: r.id, userId }, select: { id: true } }));
    case 'sage':
      return !!(await prisma.sage.findFirst({ where: { id: r.id, userId }, select: { id: true } }));
    case 'topic':
      return !!(await prisma.topic.findFirst({ where: { id: r.id, userId }, select: { id: true } }));
    case 'trait':
      return !!(await prisma.trait.findFirst({ where: { id: r.id, group: { userId } }, select: { id: true } }));
    case 'asset':
      return !!(await prisma.asset.findFirst({ where: { id: r.id, userId }, select: { id: true } }));
  }
}

// ── links ───────────────────────────────────────────

export async function addLink(userId: string, x: KRef, y: KRef) {
  if (!isKType(x.type) || !isKType(y.type)) throw new UserError('연결할 수 없는 항목입니다.');
  if (key(x) === key(y)) throw new UserError('자기 자신과는 연결할 수 없습니다.');
  if (x.type === 'trait' && y.type === 'asset') throw new UserError('종목의 성질은 자산 성질 화면에서 지정합니다.');
  if (y.type === 'trait' && x.type === 'asset') throw new UserError('종목의 성질은 자산 성질 화면에서 지정합니다.');
  if (!(await owns(userId, x)) || !(await owns(userId, y))) throw new UserError('항목을 찾을 수 없습니다.');
  const { a, b } = canonical(x, y);
  await prisma.knowledgeLink.upsert({
    where: { userId_aType_aId_bType_bId: { userId, aType: a.type, aId: a.id, bType: b.type, bId: b.id } },
    create: { userId, aType: a.type, aId: a.id, bType: b.type, bId: b.id },
    update: {},
  });
}

export async function removeLink(userId: string, x: KRef, y: KRef) {
  const { a, b } = canonical(x, y);
  await prisma.knowledgeLink.deleteMany({ where: { userId, aType: a.type, aId: a.id, bType: b.type, bId: b.id } });
}

async function dropLinks(userId: string, r: KRef) {
  await prisma.knowledgeLink.deleteMany({ where: { userId, OR: [{ aType: r.type, aId: r.id }, { bType: r.type, bId: r.id }] } });
}

async function allLinks(userId: string) {
  const rows = await prisma.knowledgeLink.findMany({ where: { userId } });
  return rows.filter((l) => isKType(l.aType) && isKType(l.bType)).map((l) => ({ a: { type: l.aType as KType, id: l.aId }, b: { type: l.bType as KType, id: l.bId } }));
}

export interface RelatedItem extends KItem {
  direct: boolean;
  /** Names of the traits/topics it is reached through */
  via: string[];
}

/** Everything related to an item, grouped by type, with how each is reached. */
export async function relatedView(userId: string, ref: KRef): Promise<Record<KType, RelatedItem[]>> {
  const [links, tags] = await Promise.all([allLinks(userId), assetTraitMap(userId)]);
  const rel = related(ref, links, tags);
  const items = await describe(userId, [...rel.map((r) => r.ref), ...rel.flatMap((r) => r.via.filter((v): v is KRef => !!v))]);
  const out: Record<KType, RelatedItem[]> = { note: [], book: [], sage: [], topic: [], trait: [], asset: [] };
  for (const r of rel) {
    const it = items.get(key(r.ref));
    if (!it) continue;
    out[r.ref.type].push({
      ...it,
      direct: r.via.includes(null),
      via: r.via.filter((v): v is KRef => !!v).map((v) => items.get(key(v))?.label ?? '').filter(Boolean),
    });
  }
  for (const list of Object.values(out)) list.sort((a, b) => Number(b.direct) - Number(a.direct) || a.label.localeCompare(b.label));
  return out;
}

/** Everything that can be linked, for the property picker. */
export async function linkOptions(userId: string): Promise<KItem[]> {
  const [notes, books, sages, topics, traits, assets] = await Promise.all([
    prisma.note.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 200, select: { id: true } }),
    prisma.book.findMany({ where: { userId }, select: { id: true } }),
    prisma.sage.findMany({ where: { userId }, select: { id: true } }),
    prisma.topic.findMany({ where: { userId }, select: { id: true } }),
    prisma.trait.findMany({ where: { group: { userId } }, select: { id: true } }),
    prisma.asset.findMany({ where: { userId, type: { not: 'LIABILITY' } }, select: { id: true } }),
  ]);
  const refs: KRef[] = [
    ...topics.map((x) => ({ type: 'topic' as const, id: x.id })),
    ...traits.map((x) => ({ type: 'trait' as const, id: x.id })),
    ...assets.map((x) => ({ type: 'asset' as const, id: x.id })),
    ...sages.map((x) => ({ type: 'sage' as const, id: x.id })),
    ...books.map((x) => ({ type: 'book' as const, id: x.id })),
    ...notes.map((x) => ({ type: 'note' as const, id: x.id })),
  ];
  const m = await describe(userId, refs);
  return refs.map((r) => m.get(key(r))).filter((x): x is KItem => !!x);
}

// ── topics ──────────────────────────────────────────

/** Find or create a topic; a preset name also links the traits it implies (when the user has them). */
export async function ensureTopic(userId: string, rawName: string): Promise<string> {
  const name = rawName.trim().replace(/^#/, '').slice(0, 30);
  if (!name) throw new UserError('키워드 이름을 입력하세요.');
  const found = await prisma.topic.findUnique({ where: { userId_name: { userId, name } } });
  if (found) return found.id;
  const preset = TOPIC_PRESETS.find((t) => t.name === name);
  const t = await prisma.topic.create({ data: { userId, name, color: preset?.color ?? '#2a78d6', description: preset?.description ?? null } });
  if (preset?.traits.length) {
    const traits = await prisma.trait.findMany({ where: { name: { in: preset.traits }, group: { userId } }, select: { id: true } });
    for (const tr of traits) await addLink(userId, { type: 'topic', id: t.id }, { type: 'trait', id: tr.id });
  }
  return t.id;
}

export async function topicsOverview(userId: string) {
  const [topics, links] = await Promise.all([prisma.topic.findMany({ where: { userId }, orderBy: { name: 'asc' } }), allLinks(userId)]);
  const count = (id: string) => links.filter((l) => (l.a.type === 'topic' && l.a.id === id) || (l.b.type === 'topic' && l.b.id === id)).length;
  return topics.map((t) => ({ id: t.id, name: t.name, color: t.color, description: t.description, links: count(t.id), preset: TOPIC_PRESETS.some((p) => p.name === t.name) }));
}

export async function saveTopic(userId: string, id: string, input: { name: string; color: string; description: string }) {
  const name = input.name.trim().replace(/^#/, '').slice(0, 30);
  if (!name) throw new UserError('키워드 이름을 입력하세요.');
  if (!/^#[0-9a-fA-F]{6}$/.test(input.color)) throw new UserError('색을 확인하세요.');
  const clash = await prisma.topic.findFirst({ where: { userId, name, id: { not: id } } });
  if (clash) throw new UserError('같은 이름의 키워드가 있습니다.');
  const r = await prisma.topic.updateMany({ where: { id, userId }, data: { name, color: input.color, description: input.description.trim().slice(0, 200) || null } });
  if (!r.count) throw new UserError('키워드를 찾을 수 없습니다.');
}

export async function deleteTopic(userId: string, id: string) {
  const r = await prisma.topic.deleteMany({ where: { id, userId } });
  if (!r.count) throw new UserError('키워드를 찾을 수 없습니다.');
  await dropLinks(userId, { type: 'topic', id });
}

// ── notes ───────────────────────────────────────────

/** Links a note gets from the page it was written on: the stock, book or investor on screen. */
async function contextRefs(userId: string, url: string | undefined): Promise<KRef[]> {
  if (!url) return [];
  let u: URL;
  try {
    u = new URL(url, 'http://x');
  } catch {
    return [];
  }
  const seg = u.pathname.split('/').filter(Boolean);
  const out: KRef[] = [];
  if (seg[0] === 'holdings' && seg[1]) {
    const h = await prisma.holding.findFirst({ where: { id: seg[1], portfolio: { userId } }, select: { assetId: true } });
    if (h) out.push({ type: 'asset', id: h.assetId });
  }
  if (seg[0] === 'journal' && seg[1] && seg[1] !== 'new' && seg[1] !== 'templates') {
    const j = await prisma.journalEntry.findFirst({ where: { id: seg[1], userId }, select: { assetId: true } });
    if (j) out.push({ type: 'asset', id: j.assetId });
  }
  if (seg[0] === 'market' && u.searchParams.get('s')) {
    const a = await prisma.asset.findFirst({ where: { userId, symbol: u.searchParams.get('s')!.toUpperCase() }, select: { id: true } });
    if (a) out.push({ type: 'asset', id: a.id });
  }
  if ((seg[0] === 'books' || seg[0] === 'sages') && seg[1] && (await owns(userId, { type: seg[0] === 'books' ? 'book' : 'sage', id: seg[1] }))) {
    out.push({ type: seg[0] === 'books' ? 'book' : 'sage', id: seg[1] });
  }
  return out;
}

async function linkHashtags(userId: string, noteId: string, body: string) {
  for (const tag of hashtags(body).slice(0, 20)) await addLink(userId, { type: 'note', id: noteId }, { type: 'topic', id: await ensureTopic(userId, tag) });
}

export async function createNote(userId: string, body: string, sourceUrl?: string): Promise<string> {
  const text = body.trim();
  if (!text) throw new UserError('메모 내용을 입력하세요.');
  if (text.length > 10_000) throw new UserError('메모는 1만 자까지 쓸 수 있습니다.');
  const path = sourceUrl && sourceUrl.startsWith('/') && !sourceUrl.startsWith('//') ? sourceUrl.slice(0, 300) : null;
  const n = await prisma.note.create({ data: { userId, body: text, sourceUrl: path } });
  await linkHashtags(userId, n.id, text);
  for (const r of await contextRefs(userId, path ?? undefined)) await addLink(userId, { type: 'note', id: n.id }, r);
  return n.id;
}

export async function updateNote(userId: string, id: string, input: { body?: string; pinned?: boolean }) {
  const n = await prisma.note.findFirst({ where: { id, userId } });
  if (!n) throw new UserError('메모를 찾을 수 없습니다.');
  const body = input.body === undefined ? undefined : input.body.trim();
  if (body !== undefined && !body) throw new UserError('메모 내용을 입력하세요.');
  if (body && body.length > 10_000) throw new UserError('메모는 1만 자까지 쓸 수 있습니다.');
  await prisma.note.update({ where: { id }, data: { body, pinned: input.pinned } });
  if (body) await linkHashtags(userId, id, body);
}

export async function deleteNote(userId: string, id: string) {
  const r = await prisma.note.deleteMany({ where: { id, userId } });
  if (!r.count) throw new UserError('메모를 찾을 수 없습니다.');
  await dropLinks(userId, { type: 'note', id });
}

export async function listNotes(userId: string, q?: string, topicId?: string) {
  let ids: string[] | undefined;
  if (topicId) {
    const links = await allLinks(userId);
    ids = links.flatMap((l) => (l.a.type === 'note' && key(l.b) === `topic:${topicId}` ? [l.a.id] : l.b.type === 'note' && key(l.a) === `topic:${topicId}` ? [l.b.id] : []));
  }
  return prisma.note.findMany({
    where: { userId, id: ids ? { in: ids } : undefined, body: q ? { contains: q, mode: 'insensitive' } : undefined },
    orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    take: 300,
  });
}

/** Links of many items at once, for list views: item key → linked items. */
export async function linkedItems(userId: string, refs: KRef[]): Promise<Map<string, KItem[]>> {
  const links = await allLinks(userId);
  const want = new Set(refs.map(key));
  const pairs: [string, KRef][] = [];
  for (const l of links) {
    if (want.has(key(l.a))) pairs.push([key(l.a), l.b]);
    if (want.has(key(l.b))) pairs.push([key(l.b), l.a]);
  }
  const items = await describe(userId, pairs.map(([, r]) => r));
  const m = new Map<string, KItem[]>();
  for (const [k, r] of pairs) {
    const it = items.get(key(r));
    if (it) m.set(k, [...(m.get(k) ?? []), it]);
  }
  return m;
}

// ── books ───────────────────────────────────────────

/** A new book note with the summary outline. `info` comes from a book search pick. */
export async function createBook(userId: string, title: string, info?: { author?: string | null; publisher?: string | null; year?: number | null }): Promise<string> {
  const t = title.trim().slice(0, 200);
  if (!t) throw new UserError('책 제목을 입력하세요.');
  const year = info?.year && Number.isInteger(info.year) && info.year >= 1000 && info.year <= 3000 ? info.year : null;
  return (
    await prisma.book.create({
      data: { userId, title: t, author: info?.author?.trim().slice(0, 100) || null, publisher: info?.publisher?.trim().slice(0, 100) || null, publishedYear: year, content: BOOK_CONTENT as Prisma.InputJsonValue },
    })
  ).id;
}

const ymd = (v: string | undefined) => {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new UserError('날짜 형식을 확인하세요.');
  return dbDate(v);
};

export async function saveBook(
  userId: string,
  id: string,
  input: { title: string; author: string; publisher: string; publishedYear: string; status: string; rating: string; startedAt: string; finishedAt: string; oneLine: string; content: unknown },
) {
  return guard(async () => {
    const title = input.title.trim().slice(0, 200);
    if (!title) throw new UserError('책 제목을 입력하세요.');
    const year = input.publishedYear.trim() ? Number(input.publishedYear) : null;
    if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 3000)) throw new UserError('출간 연도를 확인하세요.');
    const rating = input.rating ? Number(input.rating) : null;
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new UserError('별점은 1~5입니다.');
    const content = sanitizeContent(input.content);
    const r = await prisma.book.updateMany({
      where: { id, userId },
      data: {
        title,
        author: input.author.trim().slice(0, 100) || null,
        publisher: input.publisher.trim().slice(0, 100) || null,
        publishedYear: year,
        status: input.status === 'WANT' || input.status === 'DONE' ? input.status : 'READING',
        rating,
        startedAt: ymd(input.startedAt),
        finishedAt: ymd(input.finishedAt),
        oneLine: input.oneLine.trim().slice(0, 300) || null,
        content: content as Prisma.InputJsonValue,
        contentText: plainText(content),
      },
    });
    if (!r.count) throw new UserError('책을 찾을 수 없습니다.');
  });
}

export async function deleteBook(userId: string, id: string) {
  const r = await prisma.book.deleteMany({ where: { id, userId } });
  if (!r.count) throw new UserError('책을 찾을 수 없습니다.');
  await dropLinks(userId, { type: 'book', id });
}

// ── sages ───────────────────────────────────────────

/** Add a built-in investor profile with its keywords and the traits they imply. */
export async function addPresetSage(userId: string, presetKey: string): Promise<string> {
  const p = SAGE_PRESETS.find((s) => s.key === presetKey);
  if (!p) throw new UserError('알 수 없는 인물입니다.');
  if (await prisma.sage.findUnique({ where: { userId_name: { userId, name: p.name } } })) throw new UserError(`${p.name}은(는) 이미 있습니다.`);
  const content = sageContent(p);
  const s = await prisma.sage.create({
    data: { userId, name: p.name, nameEn: p.nameEn, lived: p.lived, affiliation: p.affiliation, oneLine: p.oneLine, preset: p.key, content: content as Prisma.InputJsonValue, contentText: plainText(content) },
  });
  const me = { type: 'sage' as const, id: s.id };
  for (const t of p.topics) await addLink(userId, me, { type: 'topic', id: await ensureTopic(userId, t) });
  const traits = await prisma.trait.findMany({ where: { name: { in: p.traits }, group: { userId } }, select: { id: true } });
  for (const t of traits) await addLink(userId, me, { type: 'trait', id: t.id });
  return s.id;
}

export async function createSage(userId: string, name: string): Promise<string> {
  const n = name.trim().slice(0, 60);
  if (!n) throw new UserError('이름을 입력하세요.');
  if (await prisma.sage.findUnique({ where: { userId_name: { userId, name: n } } })) throw new UserError('같은 이름이 이미 있습니다.');
  const content = [{ type: 'heading', props: { level: 2 }, content: '핵심 원칙' }, { type: 'bulletListItem', content: '' }, { type: 'heading', props: { level: 2 }, content: '대표 저서' }, { type: 'bulletListItem', content: '' }];
  return (await prisma.sage.create({ data: { userId, name: n, content } })).id;
}

export async function saveSage(userId: string, id: string, input: { name: string; nameEn: string; lived: string; affiliation: string; oneLine: string; content: unknown }) {
  return guard(async () => {
    const name = input.name.trim().slice(0, 60);
    if (!name) throw new UserError('이름을 입력하세요.');
    if (await prisma.sage.findFirst({ where: { userId, name, id: { not: id } } })) throw new UserError('같은 이름이 이미 있습니다.');
    const content = sanitizeContent(input.content);
    const r = await prisma.sage.updateMany({
      where: { id, userId },
      data: {
        name,
        nameEn: input.nameEn.trim().slice(0, 80) || null,
        lived: input.lived.trim().slice(0, 40) || null,
        affiliation: input.affiliation.trim().slice(0, 100) || null,
        oneLine: input.oneLine.trim().slice(0, 300) || null,
        content: content as Prisma.InputJsonValue,
        contentText: plainText(content),
      },
    });
    if (!r.count) throw new UserError('인물을 찾을 수 없습니다.');
  });
}

export async function deleteSage(userId: string, id: string) {
  const r = await prisma.sage.deleteMany({ where: { id, userId } });
  if (!r.count) throw new UserError('인물을 찾을 수 없습니다.');
  await dropLinks(userId, { type: 'sage', id });
}

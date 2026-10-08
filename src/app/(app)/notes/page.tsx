import { KnowledgeTabs } from '@/components/knowledge/links';
import { NoteCard, NoteComposer } from '@/components/knowledge/notes';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { linkedItems, linkOptions, listNotes } from '@/server/services/knowledge';

export const metadata = { title: '메모' };
export const dynamic = 'force-dynamic';

export default async function NotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [notes, options, topics] = await Promise.all([
    listNotes(user.id, sp.q?.trim(), sp.topic),
    linkOptions(user.id),
    prisma.topic.findMany({ where: { userId: user.id }, orderBy: { name: 'asc' } }),
  ]);
  const links = await linkedItems(user.id, notes.map((n) => ({ type: 'note' as const, id: n.id })));
  const topic = topics.find((t) => t.id === sp.topic);
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>투자 노트</h1>
          <p className="sub">떠오른 생각, 읽은 책, 투자 거장의 철학을 모아 두고 내 종목·자산 성질과 이어 봅니다.</p>
        </div>
      </header>
      <KnowledgeTabs current="notes" />
      <NoteComposer />
      <form method="get" className="inline" style={{ gap: 8 }}>
        <input name="q" defaultValue={sp.q} placeholder="메모 검색" style={{ maxWidth: 260 }} />
        <button className="btn small" type="submit">검색</button>
        <span className="inline" style={{ gap: 4 }}>
          <a className="chip-btn" aria-pressed={!topic} href="/notes">전체</a>
          {topics.map((t) => (
            <a key={t.id} className="chip-btn" aria-pressed={topic?.id === t.id} href={`/notes?topic=${t.id}`}>#{t.name}</a>
          ))}
        </span>
      </form>
      {notes.length ? (
        <div className="note-grid">
          {notes.map((n) => (
            <NoteCard
              key={n.id}
              note={{ id: n.id, body: n.body, pinned: n.pinned, sourceUrl: n.sourceUrl, updatedAt: n.updatedAt.toISOString() }}
              links={links.get(`note:${n.id}`) ?? []}
              options={options}
              open={sp.open === n.id}
            />
          ))}
        </div>
      ) : (
        <p className="empty">{sp.q || topic ? '맞는 메모가 없습니다.' : '아직 메모가 없습니다. 어느 화면에서든 오른쪽 아래 ✎ 메모를 눌러 바로 적을 수 있습니다.'}</p>
      )}
    </>
  );
}

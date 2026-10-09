import { Stars } from '@/components/journal/fields';
import { AskAiButton } from '@/components/ai/launcher';
import { NewBook } from '@/components/knowledge/doc-forms';
import { KChip, KnowledgeTabs } from '@/components/knowledge/links';
import { BOOK_STATUS_LABEL } from '@/domain/knowledge';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { linkedItems } from '@/server/services/knowledge';

export const metadata = { title: '독서 노트' };
export const dynamic = 'force-dynamic';

export default async function BooksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = sp.status === 'WANT' || sp.status === 'READING' || sp.status === 'DONE' ? sp.status : undefined;
  const books = await prisma.book.findMany({ where: { userId: user.id, status }, orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }] });
  const links = await linkedItems(user.id, books.map((b) => ({ type: 'book' as const, id: b.id })));
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>투자 노트</h1>
          <p className="sub">읽은 책의 핵심과 내 투자에 적용할 점을 정리하고, 키워드·투자 거장·종목과 이어 둡니다.</p>
        </div>
      </header>
      <KnowledgeTabs current="books" />
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <NewBook />
        <AskAiButton label="AI에게 다음 책 추천받기" agent="LIBRARIAN" prompt="지금까지 읽은 책과 내 투자 방식을 보고 다음에 읽을 책 3권을 추천해 줘" />
        <div className="seg" role="group" aria-label="상태">
          <a href="/books" aria-current={!status ? 'true' : undefined}>전체</a>
          {(Object.keys(BOOK_STATUS_LABEL) as (keyof typeof BOOK_STATUS_LABEL)[]).map((s) => (
            <a key={s} href={`/books?status=${s}`} aria-current={status === s ? 'true' : undefined}>{BOOK_STATUS_LABEL[s]}</a>
          ))}
        </div>
      </div>
      {books.length ? (
        <div className="tpl-grid">
          {books.map((b) => (
            <div key={b.id} className="card tight stack book-card" style={{ gap: 6 }}>
              <div className="spread">
                <span className="badge">{BOOK_STATUS_LABEL[b.status]}</span>
                {b.rating ? <Stars value={String(b.rating)} /> : null}
              </div>
              <h3 className="strong" style={{ fontSize: 16 }}>
                <a className="stretched" href={`/books/${b.id}`}>{b.title}</a>
              </h3>
              <span className="sub">{[b.author, b.publisher, b.publishedYear].filter(Boolean).join(' · ')}</span>
              {b.oneLine && <p style={{ fontSize: 13.5, margin: 0 }}>{b.oneLine}</p>}
              <span className="inline" style={{ gap: 4 }}>
                {(links.get(`book:${b.id}`) ?? []).filter((l) => l.type !== 'note').slice(0, 6).map((l) => (
                  <KChip key={`${l.type}:${l.id}`} item={l} />
                ))}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty">아직 정리한 책이 없습니다. 제목을 넣고 추가하면 요약 틀이 준비됩니다.</p>
      )}
    </>
  );
}

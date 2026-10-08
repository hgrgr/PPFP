import { notFound } from 'next/navigation';
import { BookForm } from '@/components/knowledge/doc-forms';
import { LinkChips, RelatedPanel } from '@/components/knowledge/links';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { linkedItems, linkOptions, relatedView } from '@/server/services/knowledge';

export const metadata = { title: '독서 노트' };
export const dynamic = 'force-dynamic';

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const b = await prisma.book.findFirst({ where: { id, userId: user.id } });
  if (!b) notFound();
  const self = { type: 'book' as const, id };
  const [links, options, related] = await Promise.all([linkedItems(user.id, [self]), linkOptions(user.id), relatedView(user.id, self)]);
  return (
    <BookForm
      book={{
        id: b.id,
        title: b.title,
        author: b.author,
        publisher: b.publisher,
        publishedYear: b.publishedYear,
        status: b.status,
        rating: b.rating,
        startedAt: b.startedAt?.toISOString().slice(0, 10) ?? null,
        finishedAt: b.finishedAt?.toISOString().slice(0, 10) ?? null,
        oneLine: b.oneLine,
        content: Array.isArray(b.content) ? (b.content as unknown[]) : [],
      }}
    >
      <section className="stack" style={{ gap: 8 }}>
        <span className="sub strong">속성 — 키워드·자산 성질·종목·투자 거장·다른 책과 연결</span>
        <LinkChips self={self} links={links.get(`book:${id}`) ?? []} options={options} />
      </section>
      <details className="card tight" open>
        <summary>이 책과 이어지는 것</summary>
        <div style={{ marginTop: 10 }}>
          <RelatedPanel data={related} order={['asset', 'sage', 'note', 'book', 'trait', 'topic']} empty="속성을 연결하면 관련된 거장·메모와, 그 성질에 맞는 내 종목이 여기에 나옵니다." />
        </div>
      </details>
    </BookForm>
  );
}

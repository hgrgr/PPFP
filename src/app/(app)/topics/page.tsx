import { KnowledgeTabs, LinkChips, RelatedPanel } from '@/components/knowledge/links';
import { TopicCreate, TopicEdit } from '@/components/knowledge/topics';
import { requireUser } from '@/server/auth';
import { linkedItems, linkOptions, relatedView, topicsOverview } from '@/server/services/knowledge';

export const metadata = { title: '키워드' };
export const dynamic = 'force-dynamic';

export default async function TopicsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const topics = await topicsOverview(user.id);
  const sel = topics.find((t) => t.id === sp.t) ?? topics[0];
  const self = sel ? { type: 'topic' as const, id: sel.id } : null;
  const [links, options, related] = self ? await Promise.all([linkedItems(user.id, [self]), linkOptions(user.id), relatedView(user.id, self)]) : [null, [], null];
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>투자 노트</h1>
          <p className="sub">키워드는 메모·책·거장을 묶는 꼬리표입니다. 키워드에 자산 성질을 이어 두면(예: 가치투자 → 가치주) 그 성질의 종목과도 이어집니다.</p>
        </div>
      </header>
      <KnowledgeTabs current="topics" />
      <TopicCreate />
      {topics.length ? (
        <div className="topic-layout">
          <nav className="stack" style={{ gap: 4 }} aria-label="키워드 목록">
            {topics.map((t) => (
              <a key={t.id} href={`/topics?t=${t.id}`} className="pick-slice inline" aria-pressed={sel?.id === t.id} style={{ padding: '6px 8px', flexWrap: 'nowrap' }}>
                <span className="dot" style={{ background: t.color }} />
                <span style={{ flex: 1 }}>#{t.name}</span>
                <span className="sub">{t.links}</span>
              </a>
            ))}
          </nav>
          {sel && self && (
            <section className="card stack">
              <TopicEdit topic={sel} />
              <div className="stack" style={{ gap: 6 }}>
                <span className="sub strong">연결 — 이 키워드가 뜻하는 자산 성질, 관련 거장·책·메모</span>
                <LinkChips self={self} links={links!.get(`topic:${sel.id}`) ?? []} options={options} />
              </div>
              <RelatedPanel data={related!} order={['trait', 'asset', 'sage', 'book', 'note', 'topic']} />
            </section>
          )}
        </div>
      ) : (
        <p className="empty">아직 키워드가 없습니다. 메모에 #가치투자 처럼 쓰거나 투자 거장을 추가하면 생깁니다.</p>
      )}
    </>
  );
}

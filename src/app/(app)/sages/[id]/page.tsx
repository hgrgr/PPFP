import { notFound } from 'next/navigation';
import { SageForm } from '@/components/knowledge/doc-forms';
import { LinkChips, RelatedPanel } from '@/components/knowledge/links';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { linkedItems, linkOptions, relatedView } from '@/server/services/knowledge';
import { AskAiButton } from '@/components/ai/launcher';

export const metadata = { title: '투자 거장' };
export const dynamic = 'force-dynamic';

export default async function SagePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const s = await prisma.sage.findFirst({ where: { id, userId: user.id } });
  if (!s) notFound();
  const self = { type: 'sage' as const, id };
  const [links, options, related] = await Promise.all([linkedItems(user.id, [self]), linkOptions(user.id), relatedView(user.id, self)]);
  return (
    <SageForm sage={{ id: s.id, name: s.name, nameEn: s.nameEn, lived: s.lived, affiliation: s.affiliation, oneLine: s.oneLine, content: Array.isArray(s.content) ? (s.content as unknown[]) : [] }}>
      <div>
        <AskAiButton className="btn primary small" label={`${s.name}의 관점으로 내 포트폴리오 보기`} agent="SAGE" sageId={s.id} prompt={`${s.name}의 철학으로 보면 내 포트폴리오는 어떤가요? 잘 맞는 종목과 어긋나는 종목, 이 철학이라면 지금 하지 않을 행동을 짚어 주세요.`} />
      </div>
      <section className="stack" style={{ gap: 8 }}>
        <span className="sub strong">속성 — 투자 스타일 키워드, 자산 성질, 관련 종목·책</span>
        <LinkChips self={self} links={links.get(`sage:${id}`) ?? []} options={options} />
      </section>
      <details className="card tight" open>
        <summary>이 철학에 맞는 내 종목 · 관련 기록</summary>
        <div style={{ marginTop: 10 }}>
          <RelatedPanel
            data={related}
            order={['asset', 'trait', 'book', 'note', 'topic', 'sage']}
            empty="키워드(예: 가치투자)나 자산 성질(예: 가치주)을 연결하면, 그 성질로 지정한 내 종목이 여기에 나옵니다."
          />
        </div>
      </details>
    </SageForm>
  );
}

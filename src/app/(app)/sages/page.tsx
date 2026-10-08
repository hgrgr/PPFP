import { NewSage, SagePresetButton } from '@/components/knowledge/doc-forms';
import { KChip, KnowledgeTabs } from '@/components/knowledge/links';
import { SAGE_PRESETS } from '@/domain/knowledge';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { linkedItems, relatedView } from '@/server/services/knowledge';

export const metadata = { title: '투자 거장' };
export const dynamic = 'force-dynamic';

export default async function SagesPage() {
  const user = await requireUser();
  const sages = await prisma.sage.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
  const [links, fits] = await Promise.all([
    linkedItems(user.id, sages.map((s) => ({ type: 'sage' as const, id: s.id }))),
    Promise.all(sages.map((s) => relatedView(user.id, { type: 'sage', id: s.id }).then((r) => [s.id, r.asset.length] as const))),
  ]);
  const fit = new Map(fits);
  const left = SAGE_PRESETS.filter((p) => !sages.some((s) => s.name === p.name));
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>투자 노트</h1>
          <p className="sub">투자 거장의 철학을 정리하고, 그 철학에 맞는 내 종목을 찾아봅니다.</p>
        </div>
      </header>
      <KnowledgeTabs current="sages" />
      {sages.length > 0 && (
        <section className="stack">
          <h2>내가 정리한 거장</h2>
          <div className="tpl-grid">
            {sages.map((s) => (
              <div key={s.id} className="card tight stack book-card" style={{ gap: 6 }}>
                <div className="spread">
                  <h3 className="strong" style={{ fontSize: 16 }}>
                    <a className="stretched" href={`/sages/${s.id}`}>{s.name}</a>
                  </h3>
                  {fit.get(s.id) ? <span className="badge ok">맞는 내 종목 {fit.get(s.id)}</span> : null}
                </div>
                <span className="sub">{[s.nameEn, s.lived, s.affiliation].filter(Boolean).join(' · ')}</span>
                {s.oneLine && <p style={{ fontSize: 13.5, margin: 0 }}>{s.oneLine}</p>}
                <span className="inline" style={{ gap: 4 }}>
                  {(links.get(`sage:${s.id}`) ?? []).filter((l) => l.type === 'topic' || l.type === 'trait').map((l) => (
                    <KChip key={`${l.type}:${l.id}`} item={l} />
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="stack">
        <div className="stack" style={{ gap: 4 }}>
          <h2>거장 추가</h2>
          <p className="sub">추가하면 핵심 원칙·대표 저서가 담긴 정리와 키워드(예: 가치투자)·자산 성질(예: 가치주)이 함께 연결됩니다. 내용은 자유롭게 고치세요.</p>
        </div>
        <NewSage />
        <div className="tpl-grid">
          {left.map((p) => (
            <div key={p.key} className="card tight stack" style={{ gap: 6 }}>
              <div className="spread">
                <h3 className="strong" style={{ fontSize: 15 }}>{p.name}</h3>
                <span className="sub">{p.lived}</span>
              </div>
              <span className="sub">{p.nameEn} · {p.affiliation}</span>
              <p style={{ fontSize: 13.5, margin: 0 }}>{p.oneLine}</p>
              <span className="sub">#{p.topics.join(' #')}</span>
              <div><SagePresetButton presetKey={p.key} /></div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

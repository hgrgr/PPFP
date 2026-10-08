import { FIELD_TYPE_LABEL } from '@/domain/journal';
import { requireUser } from '@/server/auth';
import { journalFormats } from '@/server/services/journal';

export const metadata = { title: '매매일지 양식' };
export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const user = await requireUser();
  const formats = await journalFormats(user.id);
  const builtin = formats.filter((f) => !f.custom);
  const mine = formats.filter((f) => f.custom);
  const card = (f: (typeof formats)[number]) => (
    <div key={f.id} className="card tight stack" style={{ gap: 8 }}>
      <div className="spread">
        <h3 className="strong" style={{ fontSize: 15 }}>{f.name}</h3>
        {f.custom ? <span className="badge">내 양식</span> : <span className="badge">추천 양식</span>}
      </div>
      {f.description && <p className="sub">{f.description}</p>}
      <p className="sub">
        속성: {f.fields.length ? f.fields.map((d) => `${d.label}(${FIELD_TYPE_LABEL[d.type]})`).join(', ') : '기본 속성만'}
      </p>
      <div className="inline" style={{ gap: 6 }}>
        <a className="btn small primary" href={`/journal/new?format=${encodeURIComponent(f.id)}`}>이 양식으로 쓰기</a>
        {f.custom ? (
          <a className="btn small" href={`/journal/templates/${f.id}`}>고치기</a>
        ) : (
          <a className="btn small" href={`/journal/templates/new?from=${encodeURIComponent(f.id)}`}>복사해서 내 양식 만들기</a>
        )}
      </div>
    </div>
  );
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <nav className="crumbs" aria-label="경로"><a href="/journal">매매일지</a> › <span>양식</span></nav>
          <h1>매매일지 양식</h1>
          <p className="sub">양식은 기록할 속성과 본문의 틀입니다. 모든 양식에 종목과 목표 예상 가격이 기본으로 들어갑니다.</p>
        </div>
        <a className="btn primary" href="/journal/templates/new">+ 새 양식</a>
      </header>
      <section className="stack">
        <h2>추천 양식</h2>
        <p className="sub">새 일지를 열면 연결한 거래에 맞춰 하나를 골라 줍니다: 매도 거래는 ‘매도 복기’, 매수 거래는 ‘매수 계획’, 거래 없이 쓰면 ‘장기 투자 노트’.</p>
        <div className="tpl-grid">{builtin.map(card)}</div>
      </section>
      <section className="stack">
        <h2>내 양식</h2>
        {mine.length ? <div className="tpl-grid">{mine.map(card)}</div> : <p className="empty">아직 만든 양식이 없습니다. 추천 양식을 복사해서 고치거나 새로 만드세요.</p>}
      </section>
    </>
  );
}

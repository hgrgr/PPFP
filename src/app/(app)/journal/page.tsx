import { TargetBar } from '@/components/journal/viewer';
import { STATUS_LABEL } from '@/domain/journal';
import { money } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { journalAssets, listJournals } from '@/server/services/journal';

export const metadata = { title: '매매일지' };
export const dynamic = 'force-dynamic';

export default async function JournalListPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [rows, assets] = await Promise.all([listJournals(user.id, { assetId: sp.asset, status: sp.status, q: sp.q?.trim() }), journalAssets(user.id)]);
  const filtered = Boolean(sp.asset || sp.status || sp.q);

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>매매일지</h1>
          <p className="sub">거래마다 근거와 목표 예상 가격을 남기고, 지금 가격과 비교합니다.</p>
        </div>
        <div className="inline">
          <a className="btn" href="/journal/templates">양식 관리</a>
          <a className="btn primary" href={`/journal/new${sp.asset ? `?asset=${sp.asset}` : ''}`}>+ 새 매매일지</a>
        </div>
      </header>

      <form method="get" className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12, alignItems: 'end' }}>
        <label className="field">
          종목
          <select name="asset" defaultValue={sp.asset ?? ''}>
            <option value="">전체</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          상태
          <select name="status" defaultValue={sp.status ?? ''}>
            <option value="">전체</option>
            <option value="OPEN">{STATUS_LABEL.OPEN}</option>
            <option value="CLOSED">{STATUS_LABEL.CLOSED}</option>
          </select>
        </label>
        <label className="field">
          검색
          <input name="q" defaultValue={sp.q} placeholder="제목·본문·종목명" />
        </label>
        <button className="btn" type="submit">필터</button>
      </form>

      <section className="card">
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">작성일 · 제목</th>
                  <th scope="col" className="l">종목</th>
                  <th scope="col">목표 예상 가격</th>
                  <th scope="col">현재가</th>
                  <th scope="col" className="l">진행</th>
                  <th scope="col">상태</th>
                  <th scope="col">거래</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'normal', minWidth: 220 }}>
                      <span className="sub">{r.entryDate}</span>
                      <a className="strong" href={`/journal/${r.id}`}>{r.title}</a>
                      {r.excerpt && <span className="sub excerpt">{r.excerpt}</span>}
                    </td>
                    <td className="l">
                      {r.assetName}
                      <span className="sub">{r.symbol}</span>
                    </td>
                    <td className="money strong">{money(r.targetPrice, r.currency)}</td>
                    <td className="money">{r.currentPrice ? money(r.currentPrice, r.currency) : '—'}</td>
                    <td className="l"><TargetBar entry={r} /></td>
                    <td><span className={`badge ${r.status === 'OPEN' ? '' : 'muted'}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td className="muted">{r.txnCount || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : filtered ? (
          <p className="empty">조건에 맞는 매매일지가 없습니다.</p>
        ) : (
          <div className="empty stack" style={{ alignItems: 'center' }}>
            <p>아직 쓴 매매일지가 없습니다. 거래 내역에서 거래 옆의 ‘+ 일지’를 누르거나 새로 시작하세요.</p>
            <a className="btn primary" href="/journal/new">+ 새 매매일지</a>
          </div>
        )}
      </section>
    </>
  );
}

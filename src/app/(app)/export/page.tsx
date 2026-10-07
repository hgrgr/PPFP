import { requireUser } from '@/server/auth';
import { DATASETS } from '@/server/services/export';
import { userGraph } from '@/server/services/portfolios';

export const metadata = { title: 'Export' };
export const dynamic = 'force-dynamic';

export default async function ExportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { portfolios } = await userGraph(user.id);
  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>Export</h1>
          <p className="sub">CSV는 엑셀에서 한글이 깨지지 않게 UTF-8(BOM)으로 저장됩니다. XLSX 전체 내보내기는 데이터마다 시트를 나눕니다.</p>
        </div>
      </header>

      <form method="get" action="/api/export/all" className="card stack">
        <h2>범위</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
          <label className="field">
            포트폴리오 (하위 포함)
            <select name="p" defaultValue={sp.p ?? ''}>
              <option value="">전체</option>
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            시작일 (거래·실현손익·스냅샷)
            <input type="date" name="from" defaultValue={sp.from} />
          </label>
          <label className="field">
            종료일
            <input type="date" name="to" defaultValue={sp.to} />
          </label>
          <input type="hidden" name="format" value="xlsx" />
          <button className="btn primary" type="submit">전체 XLSX 받기</button>
        </div>
        <p className="sub">아래 개별 데이터 링크도 위에서 고른 범위를 따릅니다(폼을 바꾼 뒤 이 페이지를 다시 열면 반영).</p>
      </form>

      <section className="card">
        <h2>데이터별</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              {Object.entries(DATASETS).map(([key, label]) => {
                const qs = new URLSearchParams(Object.entries({ p: sp.p, from: sp.from, to: sp.to }).filter(([, v]) => v) as [string, string][]);
                return (
                  <tr key={key}>
                    <td className="strong">{label}</td>
                    <td>
                      <span className="inline" style={{ justifyContent: 'flex-end' }}>
                        <a className="btn small" href={`/api/export/${key}?format=csv&${qs}`}>CSV</a>
                        <a className="btn small" href={`/api/export/${key}?format=xlsx&${qs}`}>XLSX</a>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

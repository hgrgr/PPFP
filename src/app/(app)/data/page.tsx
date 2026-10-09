import { DataImport } from '@/components/data-import';
import { SAMPLES, SHEET_KEYS, SHEETS } from '@/domain/data-format';
import { requireUser } from '@/server/auth';
import { DATASETS } from '@/server/services/export';
import { userGraph } from '@/server/services/portfolios';

export const metadata = { title: '가져오기 · 내보내기' };
export const dynamic = 'force-dynamic';

type Tab = 'export' | 'import' | 'format';

export default async function DataPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'import' || sp.tab === 'format' ? sp.tab : 'export';
  const { portfolios } = await userGraph(user.id);
  const scope = new URLSearchParams(Object.entries({ p: sp.p, from: sp.from, to: sp.to }).filter(([, v]) => v) as [string, string][]);
  const q = scope.toString() ? `&${scope}` : '';

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>가져오기 · 내보내기</h1>
          <p className="sub">포트폴리오, 거래 내역, 매매일지, 투자 노트를 파일로 내보내고, 같은 형식의 파일로 가져옵니다. 내보낸 파일은 그대로 다시 가져올 수 있습니다.</p>
        </div>
      </header>
      <nav className="seg" aria-label="가져오기 · 내보내기" style={{ alignSelf: 'flex-start' }}>
        <a href={`/data${scope.toString() ? `?${scope}` : ''}`} aria-current={tab === 'export' ? 'true' : undefined}>
          내보내기
        </a>
        <a href="/data?tab=import" aria-current={tab === 'import' ? 'true' : undefined}>
          가져오기
        </a>
        <a href="/data?tab=format" aria-current={tab === 'format' ? 'true' : undefined}>
          형식과 샘플
        </a>
      </nav>

      {tab === 'export' && (
        <>
          <form method="get" action="/data" className="card stack" aria-label="내보낼 범위">
            <h2>범위</h2>
            <div className="data-scope">
              <label className="field">
                포트폴리오 (하위 포함)
                <select name="p" defaultValue={sp.p ?? ''}>
                  <option value="">전체</option>
                  {portfolios.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                시작일
                <input type="date" name="from" defaultValue={sp.from} />
              </label>
              <label className="field">
                종료일
                <input type="date" name="to" defaultValue={sp.to} />
              </label>
              <button className="btn" type="submit">
                범위 적용
              </button>
            </div>
            <p className="sub">포트폴리오는 포트폴리오·거래 내역·보고서에, 기간은 거래 내역·매매일지·보고서에 적용됩니다. 메모·독서 노트·투자 거장·키워드는 늘 전부 내보냅니다.</p>
          </form>

          <section className="card">
            <div className="spread">
              <h2>데이터 (다시 가져올 수 있는 형식)</h2>
              <a className="btn primary" href={`/api/export/all?format=xlsx${q}`}>
                전체 XLSX 받기
              </a>
            </div>
            <p className="sub">전체 XLSX에는 시트마다 데이터 하나와 열 설명을 담은 안내 시트가 들어 있습니다. 백업하거나 다른 PPFP 계정으로 옮길 때 씁니다. 본문은 마크다운으로 바뀌어 들어갑니다.</p>
            <div className="table-wrap">
              <table>
                <tbody>
                  {SHEET_KEYS.map((k) => (
                    <tr key={k}>
                      <td className="strong">{SHEETS[k].name}</td>
                      <td className="l sub data-about">{SHEETS[k].about}</td>
                      <td>
                        <span className="inline" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <a className="btn small" href={`/api/export/${k}?format=csv${q}`}>
                            CSV
                          </a>
                          <a className="btn small" href={`/api/export/${k}?format=xlsx${q}`}>
                            XLSX
                          </a>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="spread">
              <h2>보고서 (내보내기만)</h2>
              <a className="btn" href={`/api/export/reports?format=xlsx${q}`}>
                보고서 전체 XLSX
              </a>
            </div>
            <p className="sub">앱이 계산한 값입니다. 가져오기에는 쓰지 않습니다.</p>
            <div className="table-wrap">
              <table>
                <tbody>
                  {Object.entries(DATASETS).map(([key, label]) => (
                    <tr key={key}>
                      <td className="strong">{label}</td>
                      <td>
                        <span className="inline" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <a className="btn small" href={`/api/export/${key}?format=csv${q}`}>
                            CSV
                          </a>
                          <a className="btn small" href={`/api/export/${key}?format=xlsx${q}`}>
                            XLSX
                          </a>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="sub">CSV는 엑셀에서 한글이 깨지지 않게 UTF-8(BOM)으로 저장됩니다.</p>
          </section>
        </>
      )}

      {tab === 'import' && <DataImport />}

      {tab === 'format' && (
        <>
          <section className="card">
            <div className="spread">
              <h2>샘플 파일</h2>
              <a className="btn primary" href="/api/data/sample/all?format=xlsx">
                샘플 전체 XLSX 받기
              </a>
            </div>
            <p className="sub">
              샘플은 서로 이어지는 가상의 예시입니다. 그대로 가져와 볼 수 있고, 예시 줄을 지우고 내 데이터를 채워 써도 됩니다. 첫 줄의 열 이름은 바꾸지 마세요. 엑셀에서 날짜가 숫자로 바뀌면 셀
              서식을 텍스트로 두세요.
            </p>
          </section>
          {SHEET_KEYS.map((k) => {
            const s = SHEETS[k];
            const ex = SAMPLES[k][0] ?? {};
            return (
              <section key={k} className="card" id={k}>
                <div className="spread">
                  <h2>{s.name}</h2>
                  <span className="inline" style={{ gap: 6 }}>
                    <a className="btn small" href={`/api/data/sample/${k}?format=csv`}>
                      샘플 CSV
                    </a>
                    <a className="btn small" href={`/api/data/sample/${k}?format=xlsx`}>
                      샘플 XLSX
                    </a>
                  </span>
                </div>
                <p className="sub">{s.about}</p>
                <div className="table-wrap">
                  <table className="data-format">
                    <thead>
                      <tr>
                        <th scope="col">열</th>
                        <th scope="col">필수</th>
                        <th scope="col">설명</th>
                        <th scope="col">예</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.columns.map((c) => (
                        <tr key={c.header}>
                          <td className="strong">{c.header}</td>
                          <td>{c.required ? <span className="badge warn">필수</span> : ''}</td>
                          <td className="sub">{c.note}</td>
                          <td className="mono">{(ex[c.header] ?? '').split('\n')[0]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </>
      )}
    </>
  );
}

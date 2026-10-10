import { IMPORT_SOURCES, LINT_LABEL, lintVerdict, TEMPLATES } from '@/domain/philosophy';
import { requireUser } from '@/server/auth';
import { listPhilosophies, rankingRows } from '@/server/services/philosophy';
import { LintPreviewForm, PhilosophyForm, PhilosophyRowActions } from '@/components/philosophy/philosophy-forms';

export const metadata = { title: '투자 철학' };
export const dynamic = 'force-dynamic';

const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`);
const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(2));
const ORIGIN: Record<string, string> = { custom: '직접 작성', skill: 'AI 스킬', sage: '투자 거장' };
const originLabel = (o: string) => (o.startsWith('template:') ? `템플릿 · ${TEMPLATES[o.slice(9)]?.label ?? o.slice(9)}` : (ORIGIN[o] ?? o));
const LEVEL = { block: '차단', caution: '주의', info: '참고' } as const;

export default async function PhilosophiesPage() {
  const user = await requireUser();
  const [items, ranked] = await Promise.all([listPhilosophies(user.id), rankingRows(user.id)]);
  const templates = Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, oneLine: t.oneLine, rules: JSON.stringify(t.rules, null, 2) }));

  return (
    <>
      <p className="callout" role="note">
        실험 기능 — 아직 메뉴에 없고 동작이 바뀔 수 있습니다.
      </p>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>투자 철학</h1>
          <p className="sub">원칙은 글로, 운용은 숫자 규칙(어떤 종목을 얼마나, 언제 맞추고, 어디까지 허용하는지)으로 적습니다. 고칠 때마다 새 버전이 쌓이고, 채택한 버전만 운용 기준이 됩니다.</p>
        </div>
      </header>

      <section className="card stack" id="mine">
        <div className="spread">
          <h2>내 철학</h2>
          <span className="sub">{items.length ? `${items.filter((x) => !x.archived).length}개 사용 중` : ''}</span>
        </div>
        {!items.length ? (
          <p className="empty">아직 철학이 없습니다. 아래에서 템플릿으로 시작해 보세요.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">이름</th>
                  <th scope="col" className="l">규칙</th>
                  <th scope="col">채택 버전</th>
                  <th scope="col">원칙 검사</th>
                  <th scope="col">운용 기록</th>
                  <th scope="col">
                    <span className="sr-only">동작</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const verdict = lintVerdict(p.lint);
                  return (
                    <tr key={p.id} className={p.archived ? 'muted' : undefined}>
                      <td>
                        <span className="strong">{p.name}</span>
                        <span className="sub">
                          {originLabel(p.origin)}
                          {p.oneLine ? ` · ${p.oneLine}` : ''}
                          {p.archived ? ' · 보관됨' : ''}
                        </span>
                      </td>
                      <td className="l">{p.rulesError ? <span className="badge warn">규칙 형식 오류</span> : <span className="sub">{p.summary ?? '—'}</span>}</td>
                      <td>
                        <span className="inline" style={{ justifyContent: 'flex-end', gap: 6 }}>
                          {p.activeVersion ? `v${p.activeVersion}` : <span className="badge warn">미채택</span>}
                          {p.draft !== null && <span className="badge">초안 v{p.draft}</span>}
                        </span>
                      </td>
                      <td>
                        {verdict === 'ok' ? (
                          <span className="badge ok">문제 없음</span>
                        ) : (
                          <span className={`badge ${verdict === 'info' ? '' : 'warn'}`} title={p.lint.map((f) => `${LINT_LABEL[f.code] ?? f.code}: ${f.excerpt}`).join('\n')}>
                            {LEVEL[verdict]} {p.lint.length}건
                          </span>
                        )}
                      </td>
                      <td>
                        {p.runs ? `${p.runs}회` : '—'}
                        {p.following > 0 && <span className="sub">포트폴리오 {p.following}개가 따름</span>}
                      </td>
                      <td>
                        <PhilosophyRowActions id={p.id} name={p.name} draft={p.draft} archived={p.archived} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack" id="ranking">
        <div className="spread">
          <h2>성과 랭킹</h2>
          <span className="sub">가격 수익(배당 제외) · 종가 체결 · 가정 비용 기준이며 미래 수익을 보장하지 않습니다</span>
        </div>
        {!ranked.length ? (
          <p className="empty">아직 계산된 백테스트나 페이퍼 운용이 없습니다. 운용 기록이 생기면 기간과 시도 횟수를 반영한 점수로 여기서 비교합니다.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">순위</th>
                  <th scope="col" className="l">철학</th>
                  <th scope="col">근거</th>
                  <th scope="col">기간</th>
                  <th scope="col">연환산</th>
                  <th scope="col">최대 낙폭</th>
                  <th scope="col">변동성</th>
                  <th scope="col">샤프</th>
                  <th scope="col">소르티노</th>
                  <th scope="col">회전율(연)</th>
                  <th scope="col">점수</th>
                  <th scope="col" className="l">경고</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r) => (
                  <tr key={r.id}>
                    <td>{r.rank ?? '—'}</td>
                    <td className="l">
                      <span className="strong">{r.name}</span>
                      <span className="sub">
                        v{r.version} · {r.mode === 'PAPER' ? '페이퍼(표본 외)' : '백테스트(표본 내)'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${r.grade === 'A' ? 'ok' : r.grade === 'D' ? 'warn' : ''}`}>{r.grade}</span>
                    </td>
                    <td>{(r.metrics.years * 12).toFixed(0)}개월</td>
                    <td>{pct(r.metrics.cagr)}</td>
                    <td>{pct(r.metrics.maxDrawdown)}</td>
                    <td>{pct(r.metrics.volatility)}</td>
                    <td>{num(r.metrics.sharpe)}</td>
                    <td>{num(r.metrics.sortino)}</td>
                    <td>{pct(r.metrics.turnover, 0)}</td>
                    <td>{num(r.score)}</td>
                    <td className="l">
                      <span className="inline" style={{ gap: 4 }}>
                        {r.warnings.map((w) => (
                          <span key={w.code} className={`badge ${w.level === 'info' ? '' : 'warn'}`} title={w.message}>
                            {LEVEL[w.level]}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details>
          <summary>점수는 이렇게 매깁니다</summary>
          <p className="sub">
            샤프 지수를 기록 길이로 줄여 잡고(페이퍼는 그대로, 백테스트는 절반만 인정), 여러 번 고쳐 본 만큼 운으로 나올 수 있는 샤프(√(2·ln 시도 수) ÷ √연수의 절반)를 빼고, 최대 낙폭을 더합니다. 근거 등급은 A(페이퍼 12개월 이상), B(백테스트 또는 짧은 페이퍼), D(표본이 너무 적어 비교 불가)입니다. 일별 표본 60개 미만은 순위에서 뺍니다.
          </p>
        </details>
      </section>

      <section className="card stack" id="new">
        <h2>{items.length ? '철학 추가' : '첫 철학 만들기'}</h2>
        <PhilosophyForm templates={templates} />
      </section>

      <section className="card stack" id="sources">
        <h2>가져오기 출처</h2>
        <p className="sub">다른 곳의 철학은 글로만 들어옵니다. 그 글이 규칙이 되거나 데이터를 바꾸려면 언제나 내가 채택해야 하고, 외부 글의 지시는 AI 도구 권한을 갖지 않습니다.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">출처</th>
                <th scope="col" className="l">순위·인기 표시의 의미</th>
                <th scope="col" className="l">들어오는 방식</th>
                <th scope="col">상태</th>
              </tr>
            </thead>
            <tbody>
              {IMPORT_SOURCES.map((s) => (
                <tr key={s.key}>
                  <td className="strong">{s.label}</td>
                  <td className="l" style={{ whiteSpace: 'normal' }}>
                    {s.signal}
                  </td>
                  <td className="l" style={{ whiteSpace: 'normal' }}>
                    {s.how}
                  </td>
                  <td>{s.status === 'ready' ? <span className="badge ok">사용 가능</span> : <span className="badge">준비 중</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details>
          <summary>가져오기 전 위험 문구 검사 해 보기</summary>
          <p className="sub">이전 지시 무시·역할 바꾸기, 도구 직접 호출, 주문·송금 지시, 키·비밀번호 요구, 외부 주소로 보내기, 보이지 않는 글자, 숨겨진 주석을 찾습니다. 패턴 검사는 우회될 수 있어 마지막 방어선이 아닙니다.</p>
          <LintPreviewForm />
        </details>
      </section>
    </>
  );
}

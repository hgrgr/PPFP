import { createPortfolioAction, linkPortfolioAction, unlinkPortfolioAction } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { Dec } from '@/domain/decimal';
import { LOT_METHOD_LABEL, LOT_METHODS } from '@/domain/lots';
import { allocatedShare, buildForest, effectiveWeights, type TreeNode } from '@/domain/portfolio-graph';
import { krwShort, pct } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { currentState } from '@/server/services/analytics';
import { userGraph } from '@/server/services/portfolios';

export const metadata = { title: '포트폴리오' };
export const dynamic = 'force-dynamic';

export default async function PortfoliosPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await requireUser();
  const { welcome } = await searchParams;
  const [{ portfolios, edges }, state] = await Promise.all([userGraph(user.id), currentState(user.id)]);
  const byId = new Map(portfolios.map((p) => [p.id, p]));
  const forest = buildForest(portfolios.map((p) => p.id), edges);
  const rolled = new Map<string, Dec>();
  for (const p of portfolios) {
    let v = Dec.ZERO;
    for (const [id, w] of effectiveWeights(edges, p.id)) v = v.add((state.direct.get(id) ?? Dec.ZERO).mul(w));
    rolled.set(p.id, v);
  }

  const Node = ({ n, parentId }: { n: TreeNode; parentId?: string }) => {
    const p = byId.get(n.id)!;
    const unallocated = Dec.ONE.sub(allocatedShare(edges, n.id));
    return (
      <li>
        <div className="node">
          <span className="dot" style={{ background: p.color }} />
          <a className="strong" href={`/portfolios/${p.id}`}>{p.name}</a>
          {p.archived && <span className="badge">보관됨</span>}
          {parentId && <span className="badge">{pct(n.allocation.toString(), 2, false).replace('.00', '')} 포함</span>}
          {parentId && unallocated.isPos() && <span className="badge warn">미배정 {pct(unallocated.toString(), 0, false)}</span>}
          <span className="money muted" style={{ marginLeft: 'auto' }}>{krwShort((rolled.get(p.id) ?? Dec.ZERO).toString())}</span>
          <a className="btn small" href={`/dashboard?p=${p.id}`}>분석</a>
          {parentId && (
            <ActionForm action={unlinkPortfolioAction} confirm={`'${p.name}'을(를) 이 상위에서 분리할까요? 포트폴리오 자체는 삭제되지 않습니다.`}>
              <input type="hidden" name="parentId" value={parentId} />
              <input type="hidden" name="childId" value={p.id} />
              <Submit className="btn small" pendingText="…">분리</Submit>
            </ActionForm>
          )}
        </div>
        {n.children.length > 0 && (
          <ul>
            {n.children.map((c) => (
              <Node key={`${n.id}>${c.id}`} n={c} parentId={n.id} />
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>포트폴리오</h1>
          <p className="sub">포트폴리오 안에 다른 포트폴리오를 원하는 비율만큼 넣을 수 있습니다. 한 포트폴리오를 여러 곳에 나눠 넣어도 합계는 100%를 넘지 않습니다.</p>
        </div>
      </header>

      {welcome && (
        <div className="callout">
          가입을 환영합니다. 먼저 맨 위 포트폴리오(예: 순자산, 은퇴 준비)를 만들고, 그 아래에 계좌나 전략별 포트폴리오를 붙여 보세요.
        </div>
      )}

      <section className="card">
        <h2>구조</h2>
        {forest.length ? (
          <ul className="tree">
            {forest.map((n) => (
              <Node key={n.id} n={n} />
            ))}
          </ul>
        ) : (
          <p className="empty">아직 포트폴리오가 없습니다.</p>
        )}
        <p className="sub">하위 포트폴리오의 금액은 할당 비율만큼 상위에 합산됩니다. 같은 포트폴리오가 여러 상위 아래에 보일 수 있습니다.</p>
      </section>

      <section className="row">
        <div className="card">
          <h2>새 포트폴리오</h2>
          <ActionForm action={createPortfolioAction} className="grid" resetOnSuccess>
            <label className="field full">
              이름
              <input name="name" required maxLength={60} placeholder="예: 해외 성장주" />
            </label>
            <label className="field">
              상위 포트폴리오 (선택)
              <select name="parentId" defaultValue="">
                <option value="">없음 (최상위)</option>
                {portfolios.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              상위에 포함할 비율 (%)
              <input name="allocation" type="number" min="0.01" max="100" step="0.01" defaultValue="100" />
            </label>
            <label className="field">
              매도 시 기본 Lot 방식
              <select name="lotMethod" defaultValue="FIFO">
                {LOT_METHODS.map((m) => (
                  <option key={m} value={m}>{LOT_METHOD_LABEL[m]}</option>
                ))}
              </select>
            </label>
            <label className="field">
              색상
              <input name="color" type="color" defaultValue="#2F4FC9" />
            </label>
            <label className="field full">
              설명 (선택)
              <input name="description" maxLength={200} />
            </label>
            <div className="full">
              <Submit>만들기</Submit>
            </div>
          </ActionForm>
        </div>

        <div className="card">
          <h2>기존 포트폴리오 연결</h2>
          {portfolios.length < 2 ? (
            <p className="empty">포트폴리오가 두 개 이상 있어야 연결할 수 있습니다.</p>
          ) : (
            <ActionForm action={linkPortfolioAction} className="grid">
              <label className="field">
                상위
                <select name="parentId" required>
                  {portfolios.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                하위
                <select name="childId" required>
                  {portfolios.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (남은 할당 {pct(Dec.ONE.sub(allocatedShare(edges, p.id)).toString(), 0, false)})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                포함 비율 (%)
                <input name="allocation" type="number" min="0.01" max="100" step="0.01" defaultValue="100" required />
              </label>
              <label className="check full">
                <input type="checkbox" name="update" value="1" /> 이미 연결된 경우 비율만 변경
              </label>
              <div className="full">
                <Submit>연결</Submit>
              </div>
            </ActionForm>
          )}
          <p className="sub">순환 구조(하위가 다시 상위를 포함)는 저장되지 않습니다.</p>
        </div>
      </section>
    </>
  );
}

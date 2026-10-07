import { notFound } from 'next/navigation';
import {
  addAssetAndBuyAction,
  cashAction,
  deletePortfolioAction,
  linkPortfolioAction,
  unlinkPortfolioAction,
  updatePortfolioAction,
} from '@/app/actions';
import { AddAssetForm } from '@/components/add-asset-form';
import { ActionForm, DateTimeField, Submit } from '@/components/forms';
import { Dec } from '@/domain/decimal';
import { LOT_METHOD_LABEL, LOT_METHODS } from '@/domain/lots';
import { effectiveWeights } from '@/domain/portfolio-graph';
import { krw, krwShort, money, pct, qty, signedKrwShort, tone } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { currentState } from '@/server/services/analytics';
import { ASSET_TYPE_LABEL } from '@/server/services/assets';
import { userGraph } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

export default async function PortfolioPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [{ portfolios, edges }, state, toss] = await Promise.all([
    userGraph(user.id),
    currentState(user.id),
    prisma.tossCredential.findUnique({ where: { userId: user.id }, select: { userId: true } }),
  ]);
  const p = portfolios.find((x) => x.id === id);
  if (!p) notFound();
  const names = new Map(portfolios.map((x) => [x.id, x.name]));
  const parents = edges.filter((e) => e.childId === id);
  const children = edges.filter((e) => e.parentId === id);
  let total = Dec.ZERO;
  for (const [pid, w] of effectiveWeights(edges, id)) total = total.add((state.direct.get(pid) ?? Dec.ZERO).mul(w));
  const direct = state.direct.get(id) ?? Dec.ZERO;
  const holdings = state.holdings.filter((h) => h.portfolioId === id).sort((a, b) => b.valueFull.cmp(a.valueFull));
  const cash = state.cashByPortfolio.get(id) ?? [];

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <nav className="crumbs" aria-label="상위 포트폴리오">
            <a href="/portfolios">포트폴리오</a>
            {parents.map((e) => (
              <span key={e.parentId}>
                › <a href={`/portfolios/${e.parentId}`}>{names.get(e.parentId)}</a> ({pct(e.allocation.toString(), 0, false)})
              </span>
            ))}
          </nav>
          <h1 className="inline">
            <span className="dot" style={{ background: p.color, width: 14, height: 14 }} />
            {p.name}
            {p.archived && <span className="badge">보관됨</span>}
          </h1>
          {p.description && <p className="sub">{p.description}</p>}
        </div>
        <div className="inline">
          <a className="btn" href={`/dashboard?p=${id}`}>기간 분석</a>
          <a className="btn" href={`/transactions?p=${id}`}>거래 내역</a>
          <a className="btn primary" href="#add">+ 거래 추가</a>
        </div>
      </header>

      <section className="row">
        <div className="card kpi">
          <div className="label">하위 포함 평가액</div>
          <div className="value money">{krw(total.toString())}</div>
          <div className="note">직접 보유 <span className="money">{krwShort(direct.toString())}</span></div>
        </div>
        <div className="card kpi">
          <div className="label">현금</div>
          <div className="value money">{krw(Dec.sum(cash.map((c) => c.krw)).toString())}</div>
          <div className="note money">{cash.length ? cash.map((c) => money(c.amount.toString(), c.currency)).join(' · ') : '현금 기록 없음'}</div>
        </div>
        <div className="card kpi">
          <div className="label">매도 기본 Lot 방식</div>
          <div className="value" style={{ fontSize: 20 }}>{LOT_METHOD_LABEL[p.lotMethod]}</div>
          <div className="note">매도할 때마다 바꿀 수 있습니다.</div>
        </div>
      </section>

      <section className="card">
        <h2>직접 보유 종목</h2>
        {holdings.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th scope="col">자산</th><th scope="col">유형</th><th scope="col">수량</th><th scope="col">Lot</th><th scope="col">현재가</th><th scope="col">평가액</th><th scope="col">미실현 손익</th></tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const u = h.valueFull.sub(h.costFull);
                  return (
                    <tr key={h.holdingId}>
                      <td><a className="strong" href={`/holdings/${h.holdingId}`}>{h.name}</a><span className="sub">{h.symbol ?? '수기'}</span></td>
                      <td className="muted">{ASSET_TYPE_LABEL[h.type]}</td>
                      <td className="money">{qty(h.qty.toString())}</td>
                      <td className="muted">{h.lots}</td>
                      <td>{h.price ? money(h.price.toString(), h.currency) : '—'}{h.stale && <span className="sub">지연</span>}</td>
                      <td className="money">{krwShort(h.valueFull.toString())}</td>
                      <td className={`money ${tone(u.toString())}`}>
                        {signedKrwShort(u.toString())}
                        <span className="sub">{h.costFull.isZero() ? '' : pct(u.div(h.costFull.abs()).toString())}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">아직 직접 보유한 자산이 없습니다. 아래에서 매수를 기록하세요.</p>
        )}
      </section>

      <section className="row" id="add">
        <div className="card wide">
          <h2>자산 추가 · 매수</h2>
          <AddAssetForm action={addAssetAndBuyAction} portfolioId={id} tossLinked={!!toss} usdkrw={state.usdkrw.toFixed(2)} />
          <p className="sub">이미 가진 종목을 더 사려면 종목 화면에서 매수하세요. 같은 종목 코드는 하나의 보유로 합쳐지고 매수마다 Lot이 따로 생깁니다.</p>
        </div>
        <div className="card">
          <h2>입출금 · 배당 · 이자</h2>
          <ActionForm action={cashAction} className="grid" resetOnSuccess>
            <input type="hidden" name="portfolioId" value={id} />
            <label className="field">
              유형
              <select name="type" defaultValue="DEPOSIT">
                <option value="DEPOSIT">입금 (외부 → 포트폴리오)</option>
                <option value="WITHDRAW">출금 (포트폴리오 → 외부)</option>
                <option value="DIVIDEND">배당</option>
                <option value="INTEREST">이자</option>
                <option value="FEE">수수료</option>
                <option value="TAX">세금</option>
              </select>
            </label>
            <label className="field">
              통화
              <select name="currency" defaultValue="KRW">
                <option value="KRW">KRW</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label className="field">
              금액
              <input name="amount" type="number" inputMode="decimal" min="0" step="any" required />
            </label>
            <label className="field">
              환율 (USD일 때)
              <input name="fxRate" type="number" inputMode="decimal" min="0" step="any" defaultValue={state.usdkrw.toFixed(2)} />
            </label>
            <label className="field">
              관련 종목 (배당)
              <select name="holdingId" defaultValue="">
                <option value="">없음</option>
                {holdings.map((h) => (
                  <option key={h.holdingId} value={h.holdingId}>{h.name}</option>
                ))}
              </select>
            </label>
            <DateTimeField />
            <label className="field full">
              메모
              <input name="memo" maxLength={200} />
            </label>
            <div className="full"><Submit>기록</Submit></div>
          </ActionForm>
          <p className="sub">입금·출금은 수익률 계산에서 제외되고, 배당·이자는 수익으로 잡힙니다.</p>
        </div>
      </section>

      <section className="row">
        <div className="card">
          <h2>하위 포트폴리오</h2>
          {children.length ? (
            <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {children.map((e) => (
                <li key={e.childId} className="spread">
                  <a className="strong" href={`/portfolios/${e.childId}`}>{names.get(e.childId)}</a>
                  <ActionForm action={linkPortfolioAction} className="inline">
                    <input type="hidden" name="parentId" value={id} />
                    <input type="hidden" name="childId" value={e.childId} />
                    <input type="hidden" name="update" value="1" />
                    <label className="field" style={{ width: 110 }}>
                      <span className="sub">포함 비율 %</span>
                      <input name="allocation" type="number" min="0.01" max="100" step="0.01" defaultValue={e.allocation.mul(100).toString()} />
                    </label>
                    <Submit className="btn small" pendingText="…">변경</Submit>
                  </ActionForm>
                  <ActionForm action={unlinkPortfolioAction} confirm="이 하위 포트폴리오 연결을 해제할까요?">
                    <input type="hidden" name="parentId" value={id} />
                    <input type="hidden" name="childId" value={e.childId} />
                    <Submit className="btn small danger" pendingText="…">분리</Submit>
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">하위 포트폴리오가 없습니다. 포트폴리오 화면에서 연결할 수 있습니다.</p>
          )}
        </div>

        <div className="card">
          <h2>설정</h2>
          <ActionForm action={updatePortfolioAction} className="grid">
            <input type="hidden" name="id" value={id} />
            <label className="field full">
              이름
              <input name="name" defaultValue={p.name} required maxLength={60} />
            </label>
            <label className="field">
              매도 기본 Lot 방식
              <select name="lotMethod" defaultValue={p.lotMethod}>
                {LOT_METHODS.map((m) => (
                  <option key={m} value={m}>{LOT_METHOD_LABEL[m]}</option>
                ))}
              </select>
            </label>
            <label className="field">
              색상
              <input name="color" type="color" defaultValue={p.color} />
            </label>
            <label className="field">
              상태
              <select name="archived" defaultValue={p.archived ? '1' : '0'}>
                <option value="0">사용 중</option>
                <option value="1">보관</option>
              </select>
            </label>
            <label className="field full">
              설명
              <input name="description" defaultValue={p.description ?? ''} maxLength={200} />
            </label>
            <div className="full"><Submit>저장</Submit></div>
          </ActionForm>
          <ActionForm action={deletePortfolioAction} confirm={`'${p.name}'을(를) 삭제할까요? 되돌릴 수 없습니다.`}>
            <input type="hidden" name="id" value={id} />
            <Submit className="btn small danger" pendingText="삭제 중…">포트폴리오 삭제</Submit>
          </ActionForm>
          <p className="sub">거래나 하위 포트폴리오가 있으면 삭제할 수 없습니다. 대신 보관하세요.</p>
        </div>
      </section>
    </>
  );
}

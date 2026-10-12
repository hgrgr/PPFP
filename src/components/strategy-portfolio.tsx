import type { Portfolio } from '@prisma/client';
import { removeAccountAction, removeMemberAction, setAccountAction, setMemberAction, setOverlapAction } from '@/app/strategy-actions';
import { deletePortfolioAction, updatePortfolioAction } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { FxAmount } from '@/components/amount';
import { Dec } from '@/domain/decimal';
import type { OverlapInfo } from '@/domain/strategy-portfolios';
import { krw, pct, qty, tone } from '@/lib/format';
import type { CurrentState } from '@/server/services/analytics';
import { prisma } from '@/server/db';
import { accountCandidates, memberCandidates, strategyStates } from '@/server/services/strategy-portfolios';

/** Under a holding's name: the strategies that take it, and 중복 when two or more do */
export function StrategyTag({ info }: { info?: OverlapInfo | null }) {
  if (!info) return null;
  return (
    <span className="sub strategy-tag">
      {info.overlap && <span className="badge warn">중복</span>} 전략: {info.label}
      {info.total.gt(Dec.ONE) && ` (합계 ${pct(info.total.toString(), 0, false)})`}
    </span>
  );
}

const pctInput = (d: Dec) => Number(d.mul(100).toFixed(2)).toString();

/** The page of a strategy portfolio: what it takes from the accounts, and adding more. */
export async function StrategyPortfolio({ userId, portfolio: p, state, members, local }: { userId: string; portfolio: Portfolio; state: CurrentState; members: Map<string, OverlapInfo>; local: boolean }) {
  const [candidates, accounts, states] = await Promise.all([memberCandidates(userId, p.id), accountCandidates(userId, p.id), strategyStates(userId, prisma, { archived: true })]);
  const via = states.find((x) => x.id === p.id)?.viaAccounts ?? new Map<string, Dec>();
  // Cash of the whole accounts taken
  const cash = Dec.sum([...state.cashByPortfolio].flatMap(([pid, list]) => list.map((c) => c.krw.mul(via.get(pid) ?? Dec.ZERO))));
  const live = new Map(state.holdings.map((h) => [h.holdingId, h]));
  const usdkrw = state.usdkrw.toNumber();
  const rows = candidates
    .filter((c) => c.share)
    .map((c) => {
      const h = live.get(c.holdingId);
      const value = h ? h.valueFull.mul(c.share!) : Dec.ZERO;
      const cost = h ? h.costFull.mul(c.share!) : Dec.ZERO;
      return { c, h, value, cost, pnl: value.sub(cost) };
    })
    .sort((a, b) => b.value.cmp(a.value));
  const total = Dec.sum(rows.map((r) => r.value)).add(cash);
  const cost = Dec.sum(rows.map((r) => r.cost));
  const pnl = total.sub(cash).sub(cost);
  const addable = candidates.filter((c) => !c.share);

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <nav className="crumbs" aria-label="포트폴리오">
            <a href="/portfolios#strategies">전략</a>
          </nav>
          <h1 className="inline">
            <span className="dot" style={{ background: p.color, width: 14, height: 14 }} />
            {p.name}
            <span className="badge">{p.allowOverlap ? '겹쳐 담기 허용' : '나눠 담기'}</span>
            {p.archived && <span className="badge">보관됨</span>}
          </h1>
          <p className="sub">{p.description ?? '계좌 포트폴리오의 종목을 비율만큼 담은 전략입니다. 매수·매도는 계좌에서 기록하고, 여기서는 담을 종목과 비율만 정합니다.'}</p>
        </div>
        <div className="inline">
          <a className="btn" href={`/dashboard?p=${p.id}`}>기간 분석</a>
        </div>
      </header>

      <section className="row" aria-label="요약">
        <div className="card kpi">
          <div className="label">전략 평가액</div>
          <div className="value money">{krw(total.toString())}</div>
          <div className="note">
            {rows.length}종목{cash.isZero() ? '' : ` · 계좌 현금 ${krw(cash.toString())}`} · 순자산에는 계좌에서 한 번만 들어갑니다
          </div>
        </div>
        <div className="card kpi">
          <div className="label">원가 (담은 비율만큼)</div>
          <div className="value money">{krw(cost.toString())}</div>
        </div>
        <div className="card kpi">
          <div className="label">평가손익</div>
          <div className={`value money ${tone(pnl.toString())}`}>{krw(pnl.toString())}</div>
          <div className="note">{cost.isZero() ? '' : pct(pnl.div(cost.abs()).toString())}</div>
        </div>
      </section>

      <section className="card">
        <h2>담은 종목</h2>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>종목</th>
                  <th>계좌</th>
                  <th className="num">담은 비율</th>
                  <th className="num">수량 (비율만큼)</th>
                  <th className="num">평가액</th>
                  <th className="num">평가손익</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, h, value, cost: rc, pnl }) => {
                  const info = members.get(c.holdingId);
                  return (
                    <tr key={c.holdingId}>
                      <td>
                        <a className="strong" href={`/holdings/${c.holdingId}`}>{c.name}</a>
                        <span className="sub">{c.symbol ?? '수기'}</span>
                        <StrategyTag info={info?.overlap ? info : null} />
                      </td>
                      <td className="sub">{c.account}</td>
                      <td className="num">
                        {c.direct && (
                          <ActionForm action={setMemberAction} className="inline share-form">
                            <input type="hidden" name="strategyId" value={p.id} />
                            <input type="hidden" name="holdingId" value={c.holdingId} />
                            <input name="percent" type="number" min="0.01" max="100" step="0.01" defaultValue={pctInput(c.direct)} aria-label={`${c.name} 담을 비율(%)`} />
                            <Submit className="btn small" pendingText="…">%</Submit>
                          </ActionForm>
                        )}
                        {c.viaAccount && <span className="sub">계좌로 {pct(c.viaAccount.toString(), 0, false)}</span>}
                      </td>
                      <td className="num">{h ? qty(h.qty.mul(c.share!).toString()) : '0'}</td>
                      <td className="num money">{h ? <FxAmount value={value.toNumber()} currency={h.currency} usdkrw={usdkrw} local={local} /> : '—'}</td>
                      <td className={`num money ${tone(pnl.toString())}`}>
                        {h ? <FxAmount value={pnl.toNumber()} currency={h.currency} usdkrw={usdkrw} local={local} signed /> : '—'}
                        <span className="sub">{rc.isZero() ? '' : pct(pnl.div(rc.abs()).toString())}</span>
                      </td>
                      <td>
                        {c.direct && (
                          <ActionForm action={removeMemberAction} confirm={`${c.name}을(를) 이 전략에서 뺄까요? 계좌의 종목과 거래는 그대로입니다.`}>
                            <input type="hidden" name="strategyId" value={p.id} />
                            <input type="hidden" name="holdingId" value={c.holdingId} />
                            <Submit className="btn small" pendingText="…">빼기</Submit>
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">아직 담은 종목이 없습니다. 아래에서 계좌를 통째로 담거나 계좌의 종목을 담으세요.</p>
        )}
      </section>

      <section className="card" id="accounts">
        <div className="stack" style={{ gap: 4 }}>
          <h2>계좌 통째로 담기</h2>
          <p className="sub">
            계좌 포트폴리오를 비율만큼 담으면 그 계좌의 종목과 현금, 하위 포트폴리오까지 함께 들어오고, 계좌에서 새로 산 종목도 저절로 담깁니다. 예: *미국 주식*을 성장 전략과
            올웨더 전략에 각각 100%. 순자산에는 계좌에서 한 번만 들어갑니다.
          </p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>계좌</th>
                <th>다른 전략</th>
                <th className="num">담은 비율</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.accountId}>
                  <td>
                    <a className="strong" href={`/portfolios/${a.accountId}`}>{a.name}</a>
                  </td>
                  <td className="sub">{a.others ?? '—'}</td>
                  <td className="num">
                    <ActionForm action={setAccountAction} className="inline share-form">
                      <input type="hidden" name="strategyId" value={p.id} />
                      <input type="hidden" name="accountId" value={a.accountId} />
                      <input name="percent" type="number" min="0.01" max="100" step="0.01" defaultValue={a.share ? pctInput(a.share) : '100'} aria-label={`${a.name} 담을 비율(%)`} />
                      <Submit className="btn small" pendingText="…">{a.share ? '%' : '담기'}</Submit>
                    </ActionForm>
                  </td>
                  <td>
                    {a.share && (
                      <ActionForm action={removeAccountAction} confirm={`${a.name}을(를) 이 전략에서 뺄까요? 계좌의 종목과 거래는 그대로입니다.`}>
                        <input type="hidden" name="strategyId" value={p.id} />
                        <input type="hidden" name="accountId" value={a.accountId} />
                        <Submit className="btn small" pendingText="…">빼기</Submit>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="stack" style={{ gap: 4 }}>
          <h2>계좌의 종목 하나씩 담기</h2>
          <p className="sub">
            {p.allowOverlap
              ? '이 전략은 겹쳐 담기를 허용합니다. 다른 전략이 담은 비율과 상관없이 100%까지 담을 수 있습니다.'
              : '나눠 담기 전략끼리는 한 종목의 비율 합계가 100%를 넘을 수 없습니다. 다른 전략이 담은 만큼은 남은 비율로 보입니다.'}
          </p>
        </div>
        {addable.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>종목</th>
                  <th>계좌</th>
                  <th>다른 전략</th>
                  <th className="num">담을 비율</th>
                </tr>
              </thead>
              <tbody>
                {addable.map((c) => {
                  const splitTaken = c.others ? Dec.sum(c.others.strategies.filter((o) => !o.allowOverlap).map((o) => o.share)) : Dec.ZERO;
                  const room = p.allowOverlap ? Dec.ONE : Dec.max(Dec.ZERO, Dec.ONE.sub(splitTaken));
                  return (
                    <tr key={c.holdingId}>
                      <td>
                        <span className="strong">{c.name}</span> <span className="sub">{c.symbol ?? '수기'}</span>
                      </td>
                      <td className="sub">{c.account}</td>
                      <td className="sub">{c.others ? c.others.label : '—'}</td>
                      <td className="num">
                        {room.isPos() ? (
                          <ActionForm action={setMemberAction} className="inline share-form">
                            <input type="hidden" name="strategyId" value={p.id} />
                            <input type="hidden" name="holdingId" value={c.holdingId} />
                            <input name="percent" type="number" min="0.01" max={pctInput(room)} step="0.01" defaultValue={pctInput(room)} aria-label={`${c.name} 담을 비율(%)`} />
                            <Submit className="btn small" pendingText="…">담기</Submit>
                          </ActionForm>
                        ) : (
                          <span className="sub">남은 비율 없음</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">담을 수 있는 계좌 종목이 없습니다. 계좌 포트폴리오에 매수를 기록하거나 보유종목을 가져오세요.</p>
        )}
      </section>

      <section className="row">
        <div className="card">
          <h2>담는 방식</h2>
          <p className="sub">겹쳐 담기를 허용하면 다른 전략이 이미 다 담은 종목도 이 전략에 100%로 담을 수 있습니다. 그런 종목은 어디서나 *중복*으로 표시되고, 순자산에는 한 번만 들어갑니다.</p>
          <ActionForm action={setOverlapAction}>
            <input type="hidden" name="strategyId" value={p.id} />
            <input type="hidden" name="allow" value={p.allowOverlap ? '0' : '1'} />
            <Submit className="btn">{p.allowOverlap ? '나눠 담기로 바꾸기' : '겹쳐 담기 허용'}</Submit>
          </ActionForm>
        </div>
        <div className="card">
          <h2>전략 설정</h2>
          <ActionForm action={updatePortfolioAction} className="grid">
            <input type="hidden" name="id" value={p.id} />
            <label className="field">
              이름
              <input name="name" defaultValue={p.name} maxLength={60} required />
            </label>
            <label className="field">
              색상
              <input name="color" type="color" defaultValue={p.color} />
            </label>
            <label className="field full">
              설명
              <input name="description" defaultValue={p.description ?? ''} maxLength={200} />
            </label>
            <div className="full">
              <Submit>저장</Submit>
            </div>
          </ActionForm>
          <ActionForm action={deletePortfolioAction} confirm={`'${p.name}' 전략을 지울까요? 계좌의 종목과 거래는 그대로입니다.`}>
            <input type="hidden" name="id" value={p.id} />
            <Submit className="btn small danger" pendingText="…">전략 지우기</Submit>
          </ActionForm>
        </div>
      </section>
    </>
  );
}

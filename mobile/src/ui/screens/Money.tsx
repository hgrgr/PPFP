/** 순자산 · 대출, 목표, 세금 · 배당: the web app's calculations on the phone's book. */
import { useState } from 'react';
import { balanceSheet, loanSchedule, loanStatus, addMonths, LIABILITY_KINDS, REPAYMENT_LABEL, type BalanceItem } from '@/domain/net-worth';
import { simulateGoal, monthlyNeeded } from '@/domain/goals';
import { bucketOf, taxYear, TAX_RULES } from '@/domain/tax';
import { db, kstToday } from '~/core/db';
import { recordTxn, saveGoal, saveLoan, updateAsset } from '~/core/store';
import type { Loan } from '~/core/types';
import { useBook, useLive } from '../hooks';
import { nowLocal, pct, shortWon, won } from '../format';
import { Msg, Topbar, useAction } from '../kit';

export function NetWorth() {
  const data = useBook();
  const loans = useLive(() => db.loans.toArray());
  const act = useAction();
  const [edit, setEdit] = useState<string | null>(null);
  if (!data || !loans) return <Topbar title="순자산 · 대출" back />;
  const items: BalanceItem[] = data.book.holdings.map((h) => ({ id: `${h.portfolioId}:${h.asset.id}`, name: h.asset.name, type: h.asset.type, kind: h.asset.kind ?? null, value: h.valueKrw.toNumber() }));
  if (!data.book.cashKrw.isZero()) items.push({ id: 'cash', name: '포트폴리오 현금', type: 'CASH_BAL', value: data.book.cashKrw.toNumber() });
  const bs = balanceSheet(items);
  const debts = [...new Map(data.book.holdings.filter((h) => h.asset.type === 'LIABILITY').map((h) => [h.asset.id, h.asset])).values()];
  const today = kstToday();

  return (
    <>
      <Topbar title="순자산 · 대출" back />
      <div className="page">
        <section className="card">
          <div className="sub">순자산</div>
          <div className="big">{won(bs.netWorth)}</div>
          <div className="kpis">
            <div className="kpi"><span className="sub">총자산</span><span className="v">{shortWon(bs.assets)}</span></div>
            <div className="kpi"><span className="sub">총부채</span><span className="v">{shortWon(bs.liabilities)}</span></div>
            <div className="kpi"><span className="sub">부채 / 총자산</span><span className="v">{pct(bs.debtToAssets, false)}</span></div>
            <div className="kpi"><span className="sub">부채비율 (부채 / 순자산)</span><span className="v">{pct(bs.debtToEquity, false)}</span></div>
          </div>
        </section>
        {bs.groups.map((g) => (
          <section key={g.key} className="card">
            <div className="card-head">
              <h2>{g.side === 'LIABILITY' ? '부채 · ' : ''}{g.label}</h2>
              <span className="strong num">{shortWon(g.total)}</span>
            </div>
            {g.items.map((it) => (
              <div key={it.id} className="card-head sub">
                <span>{it.name}</span>
                <span className="num">{won(it.amount)}</span>
              </div>
            ))}
          </section>
        ))}

        <section className="card">
          <h2>대출 상환 일정</h2>
          {!debts.length && <p className="sub">부채 자산이 없습니다. 기록 탭에서 매수 › 새 자산 › 부채로 대출을 넣으세요(수량 1, 단가 = 원금, 현금 사용 끔).</p>}
          {debts.map((a) => {
            const l = loans.find((x) => x.assetId === a.id);
            const sched = l ? loanSchedule({ principal: l.principal, startDate: l.startDate, maturityDate: addMonths(l.startDate, l.months), method: l.method, graceMonths: l.graceMonths, paymentDay: l.paymentDay, rates: [{ from: l.startDate, rate: l.annualRate }] }) : [];
            const st = l ? loanStatus(l.principal, sched, today) : null;
            return (
              <div key={a.id} className="card" style={{ background: 'var(--surface-2)' }}>
                <div className="card-head">
                  <span className="strong">{a.name}</span>
                  <span className="sub">{a.kind ? LIABILITY_KINDS[a.kind] ?? '' : ''}</span>
                </div>
                {l && st ? (
                  <>
                    <div className="sub">
                      {REPAYMENT_LABEL[l.method]} · 연 {(l.annualRate * 100).toFixed(2)}% · {l.months}개월 · 상환 {(st.progress * 100).toFixed(1)}%
                    </div>
                    <div className="kpis">
                      <div className="kpi"><span className="sub">남은 원금 (일정상)</span><span className="v">{won(st.remaining)}</span></div>
                      <div className="kpi"><span className="sub">남은 이자</span><span className="v">{won(st.remainingInterest)}</span></div>
                      <div className="kpi"><span className="sub">다음 납입</span><span className="v">{st.next ? `${st.next.dueDate.slice(5)} ${shortWon(st.next.payment)}` : '없음'}</span></div>
                      <div className="kpi"><span className="sub">만기</span><span className="v">{st.payoffDate ?? '—'}</span></div>
                    </div>
                    <div className="actions">
                      <button className="btn small" onClick={() => setEdit(a.id)}>조건 고치기</button>
                      <button className="btn small" onClick={() => act.run(async () => {
                        // Book the scheduled balance as the liability's value (평가 갱신)
                        const h = data.book.holdings.find((x) => x.asset.id === a.id);
                        if (!h) return;
                        await recordTxn({ portfolioId: h.portfolioId, type: 'VALUATION', assetId: a.id, localAt: nowLocal(), price: String(Math.round(st.remaining)), memo: '상환 일정의 남은 원금' });
                        await updateAsset(a.id, { price: null });
                        return '남은 원금을 부채 가치로 기록했습니다.';
                      })}>남은 원금 반영</button>
                    </div>
                  </>
                ) : (
                  <button className="btn small" onClick={() => setEdit(a.id)}>대출 조건 넣기</button>
                )}
                {edit === a.id && <LoanForm assetId={a.id} loan={l ?? null} onDone={() => setEdit(null)} />}
              </div>
            );
          })}
          <Msg {...act.msg} />
        </section>
      </div>
    </>
  );
}

function LoanForm({ assetId, loan, onDone }: { assetId: string; loan: Loan | null; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ principal: String(loan?.principal ?? ''), rate: loan ? String(loan.annualRate * 100) : '', start: loan?.startDate ?? kstToday(), months: String(loan?.months ?? 360), method: loan?.method ?? 'AMORTIZING', grace: String(loan?.graceMonths ?? 0), day: String(loan?.paymentDay ?? 25) });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <div className="form">
      <div className="grid2">
        <label className="field">원금 (원)<input inputMode="numeric" value={f.principal} onChange={(e) => set('principal', e.target.value)} /></label>
        <label className="field">금리 (연 %)<input inputMode="decimal" value={f.rate} onChange={(e) => set('rate', e.target.value)} /></label>
        <label className="field">시작일<input type="date" value={f.start} onChange={(e) => set('start', e.target.value)} /></label>
        <label className="field">기간 (개월)<input inputMode="numeric" value={f.months} onChange={(e) => set('months', e.target.value)} /></label>
        <label className="field">상환 방식
          <select value={f.method} onChange={(e) => set('method', e.target.value)}>
            <option value="AMORTIZING">원리금균등</option>
            <option value="EQUAL_PRINCIPAL">원금균등</option>
            <option value="BULLET">만기일시</option>
          </select>
        </label>
        <label className="field">거치 (개월)<input inputMode="numeric" value={f.grace} onChange={(e) => set('grace', e.target.value)} /></label>
        <label className="field">납입일<input inputMode="numeric" value={f.day} onChange={(e) => set('day', e.target.value)} /></label>
      </div>
      <button className="btn primary" disabled={act.busy} onClick={() => act.run(async () => {
        await saveLoan({ assetId, principal: Number(f.principal.replace(/,/g, '')), annualRate: Number(f.rate) / 100, startDate: f.start, months: Number(f.months), method: f.method as Loan['method'], graceMonths: Number(f.grace), paymentDay: Number(f.day) });
        onDone();
      })}>저장</button>
      <Msg {...act.msg} />
    </div>
  );
}

export function Goals() {
  const data = useBook();
  const goals = useLive(() => db.goals.toArray());
  const act = useAction();
  const [f, setF] = useState({ name: '', target: '', targetDate: '', monthly: '' });
  if (!data || !goals) return <Topbar title="목표" back />;
  const start = data.book.valueKrw.toNumber();
  return (
    <>
      <Topbar title="목표" back />
      <div className="page">
        <p className="sub">지금 순자산 {won(start)}에서 시작해, 매달 넣을 돈과 연 6% · 변동성 15%(주식 60·채권 40 정도)로 2,000번 모의 실험합니다. 금액은 물가 2.5%를 뺀 오늘 가치입니다.</p>
        {goals.map((g) => {
          const months = Math.max(1, Math.round((Date.parse(g.targetDate) - Date.now()) / (30.44 * 86_400_000)));
          const sim = simulateGoal({ start, monthly: g.monthly, months, target: g.target, ret: 0.06, vol: 0.15, inflation: 0.025 });
          const last = sim.years[sim.years.length - 1];
          return (
            <section key={g.id} className="card">
              <div className="card-head">
                <h2>{g.name}</h2>
                <button className="btn small danger" onClick={() => db.goals.delete(g.id)}>지우기</button>
              </div>
              <div className="sub">{g.targetDate}까지 {won(g.target)} · 매달 {won(g.monthly)}</div>
              <div className="big">{(sim.probability * 100).toFixed(0)}%</div>
              <div className="sub">목표에 닿을 확률</div>
              <div className="kpis">
                <div className="kpi"><span className="sub">중간 경우</span><span className="v">{shortWon(last?.p50)}</span></div>
                <div className="kpi"><span className="sub">나쁜 경우 (하위 10%)</span><span className="v">{shortWon(last?.p10)}</span></div>
                <div className="kpi"><span className="sub">좋은 경우 (상위 10%)</span><span className="v">{shortWon(last?.p90)}</span></div>
                <div className="kpi"><span className="sub">변동 없이 가면 필요한 월 저축</span><span className="v">{shortWon(monthlyNeeded(start, g.target, months, 0.06 - 0.025))}</span></div>
              </div>
            </section>
          );
        })}
        <section className="card form">
          <h2>새 목표</h2>
          <label className="field">이름<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="은퇴 자금" /></label>
          <div className="grid2">
            <label className="field">목표 금액 (원)<input inputMode="numeric" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
            <label className="field">목표 날짜<input type="date" value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} /></label>
            <label className="field">매달 넣을 돈<input inputMode="numeric" value={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.value })} /></label>
          </div>
          <button className="btn primary" disabled={act.busy} onClick={() => act.run(async () => { await saveGoal(f); setF({ name: '', target: '', targetDate: '', monthly: '' }); return '목표를 만들었습니다.'; })}>만들기</button>
          <Msg {...act.msg} />
        </section>
      </div>
    </>
  );
}

export function Tax() {
  const data = useBook();
  const thisYear = Number(kstToday().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  if (!data) return <Topbar title="세금 · 배당" back />;
  const realized = data.book.realized.filter((r) => r.date.startsWith(String(year))).map((r) => ({ date: r.date, asset: r.asset.name, bucket: bucketOf(r.asset.type, r.asset.currency), pnlKrw: r.pnlKrw.toNumber() }));
  const income = data.book.income.filter((i) => i.date.startsWith(String(year))).map((i) => ({ date: i.date, asset: i.asset?.name ?? null, kind: i.type, amountKrw: i.amountKrw.toNumber() }));
  const open = year === thisYear ? data.book.holdings.map((h) => ({ assetId: h.asset.id, asset: h.asset.name, symbol: h.asset.symbol, bucket: bucketOf(h.asset.type, h.asset.currency), valueKrw: h.valueKrw.toNumber(), unrealizedKrw: h.pnlKrw.toNumber() })) : null;
  const t = taxYear(year, realized, income, open);
  return (
    <>
      <Topbar title="세금 · 배당" back />
      <div className="page">
        <div className="seg">
          {[thisYear - 2, thisYear - 1, thisYear].map((y) => (
            <button key={y} className={y === year ? 'on' : ''} onClick={() => setYear(y)}>{y}년</button>
          ))}
        </div>
        <section className="card">
          <h2>해외주식 양도소득</h2>
          <div className="kpis">
            <div className="kpi"><span className="sub">이익 − 손실</span><span className="v">{won(t.overseas.netKrw)}</span></div>
            <div className="kpi"><span className="sub">예상 세금 (22%)</span><span className="v">{won(t.overseas.taxKrw)}</span></div>
          </div>
          <p className="sub">기본공제 {shortWon(TAX_RULES.overseasDeduction)}를 뺀 금액에 22%(지방세 포함). 다음 해 5월에 신고합니다.</p>
          {t.harvest && t.harvest.deductionRoomKrw > 0 && <p className="sub">올해 공제 여유 {won(t.harvest.deductionRoomKrw)}: 이익 난 종목을 이만큼 팔고 다시 사면 세금 없이 취득가를 높일 수 있습니다.</p>}
          {t.harvest && t.harvest.lossSavingKrw > 0 && <p className="sub">손실 중인 종목을 연말 전에 팔면 세금을 약 {won(t.harvest.lossSavingKrw)} 줄일 수 있습니다.</p>}
        </section>
        <section className="card">
          <h2>금융소득 (배당 + 이자)</h2>
          <div className="kpis">
            <div className="kpi"><span className="sub">배당</span><span className="v">{won(t.financial.dividendsKrw)}</span></div>
            <div className="kpi"><span className="sub">이자</span><span className="v">{won(t.financial.interestKrw)}</span></div>
          </div>
          <p className={t.financial.overThreshold ? 'err-text' : 'sub'}>
            {t.financial.overThreshold ? `연 ${shortWon(TAX_RULES.financialThreshold)}을 넘어 종합과세 대상입니다.` : `연 ${shortWon(TAX_RULES.financialThreshold)}까지는 원천징수(15.4%)로 끝납니다.`}
          </p>
        </section>
        <section className="card">
          <h2>국내주식 · 가상자산</h2>
          <p className="sub">국내주식(소액주주) 이익 {won(t.domestic.netKrw)}: 양도세 없음. 가상자산 이익 {won(t.crypto.netKrw)}: {t.crypto.taxed ? `예상 세금 ${won(t.crypto.taxKrw)}` : `${TAX_RULES.cryptoFromYear}년부터 과세 예정`}.</p>
          <p className="sub">이 앱의 기록으로 계산한 추정치입니다. 실제 신고는 증권사 자료와 세무 안내를 확인하세요.</p>
        </section>
      </div>
    </>
  );
}

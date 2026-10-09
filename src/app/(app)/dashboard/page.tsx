import { refreshDataAction } from '@/app/actions';
import { AutoRefresh, PrivacyToggle, ScopeSelect } from '@/components/client-bits';
import { ValueChart, WeightChart } from '@/components/charts';
import { AllocationDonut, JournalPanel, JournalPanelProvider, JournalPickButton } from '@/components/journal/dashboard-panel';
import { ActionForm, Submit } from '@/components/forms';
import { PeriodBar } from '@/components/period-bar';
import { kstDateTime, krw, krwShort, money, pct, qty, signedKrwShort, tone } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { dashboard } from '@/server/services/analytics';
import { journalCounts } from '@/server/services/journal';
import { assetTraitMap, traitGroups } from '@/server/services/traits';
import { traitAllocation } from '@/domain/traits';
import { userGraph } from '@/server/services/portfolios';
import { AskAiButton } from '@/components/ai/launcher';

export const metadata = { title: '대시보드' };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DashboardPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const params = { p: one(sp.p), period: one(sp.period), from: one(sp.from), to: one(sp.to), alloc: one(sp.alloc), g: one(sp.g) };
  const [d, graph, counts, groups] = await Promise.all([dashboard(user.id, params.p ?? null, params), userGraph(user.id), journalCounts(user.id), traitGroups(user.id)]);
  const s = d.summary;
  const allocKind = params.alloc === 'ccy' ? 'ccy' : params.alloc === 'type' ? 'type' : params.alloc === 'trait' && groups.length ? 'trait' : 'holding';
  // 성질: one of the user's trait groups, over the holdings in scope
  const traitGroup = allocKind === 'trait' ? groups.find((g) => g.id === params.g) ?? groups[0] : null;
  const traitSlices = traitGroup
    ? (() => {
        const byAsset = new Map<string, { assetId: string; name: string; value: number }>();
        for (const h of d.holdings) {
          if (h.type === 'LIABILITY' || !h.value.isPos()) continue;
          const cur = byAsset.get(h.assetId);
          if (cur) cur.value += h.value.toNumber();
          else byAsset.set(h.assetId, { assetId: h.assetId, name: h.name, value: h.value.toNumber() });
        }
        return byAsset;
      })()
    : null;
  const tags = traitGroup ? await assetTraitMap(user.id) : null;
  const slices =
    allocKind === 'ccy'
      ? d.allocation.byCurrency
      : allocKind === 'type'
        ? d.allocation.byType
        : traitGroup && traitSlices && tags
          ? traitAllocation(traitGroup.traits, [...traitSlices.values()], tags, { value: d.allocation.byType.find((x) => x.key === 'CASH_BAL')?.value ?? 0, traitId: traitGroup.cashTraitId }, traitGroup.base)
              .slices.filter((x) => x.value > 0 && !x.excluded)
              .map((x) => ({ key: x.key, label: x.label, sub: x.target === null ? undefined : `목표 ${pct(x.target, 1, false)}`, color: x.color, value: x.value, share: x.share }))
          : d.allocation.byHolding;
  const linkParams = { p: params.p, period: params.period, from: params.from, to: params.to };
  const q = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...linkParams, ...extra })) if (v) u.set(k, v);
    return `/dashboard?${u.toString()}`;
  };

  if (!graph.portfolios.length) {
    return (
      <div className="card">
        <h1>시작하기</h1>
        <p>
          먼저 포트폴리오를 만들고 자산을 추가하세요. 증권사 Open API를 연결하면 계좌의 보유종목을 한 번에 가져올 수 있고, API가 없는 증권사는 잔고 화면을 붙여넣어 가져올 수
          있습니다.
        </p>
        <div className="inline">
          <a className="btn primary" href="/portfolios">포트폴리오 만들기</a>
          <a className="btn" href="/settings">증권사 연결</a>
          <a className="btn" href="/import">보유종목 가져오기</a>
        </div>
      </div>
    );
  }

  return (
    <JournalPanelProvider counts={counts}>
      <AutoRefresh seconds={30} />
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <nav className="crumbs" aria-label="경로">
            <a href={q({ p: undefined })}>순자산 전체</a>
            {d.scope.path.map((c) => (
              <span key={c.id}>
                › <a href={q({ p: c.id })}>{c.name}</a>
              </span>
            ))}
          </nav>
          <h1>{d.scope.name}</h1>
          <p className="sub">
            {kstDateTime(new Date())} 기준 · USD/KRW {d.usdkrw.toFixed(2)}
            {d.stale && <span className="badge warn" style={{ marginLeft: 8 }}>일부 시세 지연</span>}
          </p>
        </div>
        <div className="inline">
          <ScopeSelect value={params.p ?? ''} options={graph.portfolios.map((p) => ({ id: p.id, label: p.name }))} />
          <PrivacyToggle />
          <AskAiButton label="AI 점검" prompt={`${d.scope.name} 범위의 포트폴리오를 점검해 줘. 지금 가장 신경 써야 할 점 3가지와 그 근거를 알려 줘.`} />
          <a className="btn" href={`/data?${new URLSearchParams(Object.entries({ p: params.p, from: d.range.start, to: d.range.end }).filter(([, v]) => v) as [string, string][]).toString()}`}>
            내보내기
          </a>
          {d.scope.id && (
            <a className="btn primary" href={`/portfolios/${d.scope.id}#add`}>
              + 거래 추가
            </a>
          )}
        </div>
      </header>

      <PeriodBar base="/dashboard" params={linkParams} range={d.range} />

      {!d.hasSnapshots && (
        <div className="callout inline spread">
          <span>기간 분석용 일별 기록이 아직 없습니다. 과거 시세를 받아 지금까지의 기록을 계산하려면 실행하세요.</span>
          <ActionForm action={refreshDataAction}>
            <Submit className="btn small" pendingText="계산 중…">과거 기록 계산</Submit>
          </ActionForm>
        </div>
      )}

      <section className="row" aria-label="요약">
        <div className="card kpi">
          <div className="label">총평가액</div>
          <div className="value money">{krw(d.total.toString())}</div>
          <div className="note">
            원가 <span className="money">{krwShort(d.costBase.toString())}</span> · 미실현{' '}
            <span className={`money ${tone(d.unrealized.toString())}`}>{signedKrwShort(d.unrealized.toString())}</span>
          </div>
        </div>
        <div className="card kpi">
          <div className="label">기간 손익 (입출금 제외)</div>
          <div className={`value money ${tone(s?.pnl.toString())}`}>{s ? signedKrwShort(s.pnl.toString()) : '—'}</div>
          <div className="note">
            실현 <span className={`money ${tone(d.realized.toString())}`}>{signedKrwShort(d.realized.toString())}</span> · 순입금{' '}
            <span className="money">{s ? signedKrwShort(s.netFlow.toString()) : '—'}</span>
          </div>
        </div>
        <div className="card kpi">
          <div className="label">수익률 (시간가중, TWR)</div>
          <div className={`value ${tone(s?.twr.toString())}`}>{s ? pct(s.twr.toString()) : '—'}</div>
          <div className="note">최대낙폭 {s ? pct(s.maxDrawdown.toString()) : '—'}</div>
        </div>
        <div className="card kpi">
          <div className="label">배당 · 이자</div>
          <div className="value money">{krw(d.income.toString())}</div>
          <div className="note">기간 내 받은 금액 (원화 환산)</div>
        </div>
      </section>

      <section className="row">
        <div className="card wide">
          <div className="spread">
            <h2>평가액 추이</h2>
            <div className="inline sub">
              <span className="inline" style={{ gap: 6 }}><span style={{ width: 16, height: 2, background: 'var(--ink)', display: 'inline-block' }} />평가액</span>
              <span className="inline" style={{ gap: 6 }}><span style={{ width: 16, borderTop: '2px dashed var(--muted)', display: 'inline-block' }} />투자원금 (시작 평가액 + 순입금)</span>
            </div>
          </div>
          <ValueChart data={d.chart} />
        </div>
        <div className="card">
          <div className="spread">
            <h2>자산 배분</h2>
            <div className="seg" role="group" aria-label="배분 기준">
              <a href={q({ alloc: undefined })} aria-current={allocKind === 'holding' ? 'true' : undefined}>종목</a>
              <a href={q({ alloc: 'type' })} aria-current={allocKind === 'type' ? 'true' : undefined}>유형</a>
              <a href={q({ alloc: 'ccy' })} aria-current={allocKind === 'ccy' ? 'true' : undefined}>통화</a>
              <a href={groups.length ? q({ alloc: 'trait', g: traitGroup?.id }) : '/traits'} aria-current={allocKind === 'trait' ? 'true' : undefined} title={groups.length ? undefined : '자산 성질에서 분류를 먼저 추가하세요'}>성질</a>
            </div>
          </div>
          {traitGroup && (
            <div className="inline" style={{ gap: 4 }} aria-label="성질 분류">
              {groups.map((g) => (
                <a key={g.id} className="chip-btn" aria-pressed={g.id === traitGroup.id} href={q({ alloc: 'trait', g: g.id })}>{g.name}</a>
              ))}
              <a className="sub" href={`/traits?g=${traitGroup.id}`} style={{ marginLeft: 4 }}>목표 비중 ›</a>
            </div>
          )}
          <AllocationDonut slices={slices} byStock={allocKind === 'holding'} centerLabel="총자산" centerValue={krwShort(slices.reduce((a, b) => a + b.value, 0))} />
          <p className="sub">
            {allocKind === 'holding' && '여러 포트폴리오에 나눠 담은 같은 종목은 하나로 합칩니다. 전체 종목별 비중은 아래 보유 종목 표에 있습니다. '}
            {allocKind === 'trait' && '성질을 두 개 고른 종목은 반씩 나눠 셉니다. '}
            {traitGroup?.base === 'tagged' && '이 분류는 성질을 지정한 종목끼리의 비중입니다. '}
            부채는 배분에서 제외하고 총평가액에서는 차감합니다.
          </p>
        </div>
      </section>

      <JournalPanel />

      <section className="card">
        <div className="stack" style={{ gap: 4 }}>
          <h2>비중 변화</h2>
          <p className="sub">기간 동안 자산유형별 비중 (100% 누적)</p>
        </div>
        <div className="row">
          <div className="wide">
            <WeightChart keys={d.weightChange.keys} points={d.weightChange.points} />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th scope="col">자산유형</th><th scope="col">시작</th><th scope="col">종료</th><th scope="col">변화</th></tr>
              </thead>
              <tbody>
                {d.weightChange.keys.map((k) => {
                  const a = d.weightChange.start[k.key] ?? 0, b = d.weightChange.end[k.key] ?? 0;
                  return (
                    <tr key={k.key}>
                      <td><span className="inline" style={{ flexWrap: 'nowrap' }}><span className="dot" style={{ background: k.color }} />{k.label}</span></td>
                      <td className="muted">{pct(a, 1, false)}</td>
                      <td className="strong">{pct(b, 1, false)}</td>
                      <td>{pct(b - a, 1)}p</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="row">
        <div className="card">
          <div className="spread">
            <h2>{d.scope.id ? '하위 포트폴리오' : '포트폴리오'}</h2>
            <a className="sub" href="/portfolios">구조 편집 ›</a>
          </div>
          {d.children.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th scope="col">포트폴리오</th><th scope="col">할당</th><th scope="col">평가액</th><th scope="col">비중</th><th scope="col">기간 수익률</th></tr>
                </thead>
                <tbody>
                  {d.children.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <a href={q({ p: c.id })} className="inline strong" style={{ flexWrap: 'nowrap' }}>
                          <span className="dot" style={{ background: c.color }} />
                          {c.name}
                        </a>
                      </td>
                      <td className="muted">{pct(c.allocation.toString(), 0, false)}</td>
                      <td className="money">{krwShort(c.value.toString())}</td>
                      <td className="muted">{pct(c.share, 1, false)}</td>
                      <td className={tone(c.twr?.toString())}>{c.twr ? pct(c.twr.toString()) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">하위 포트폴리오가 없습니다.</p>
          )}
        </div>

        <div className="card">
          <div className="spread">
            <h2>보유 종목</h2>
            <span className="sub">{d.holdings.length}개</span>
          </div>
          {d.holdings.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th scope="col">종목</th><th scope="col">수량 · Lot</th><th scope="col">현재가</th><th scope="col">평가액</th><th scope="col">비중</th><th scope="col">미실현 손익</th><th scope="col">매매일지</th></tr>
                </thead>
                <tbody>
                  {d.holdings.slice(0, 15).map((h) => (
                    <tr key={h.holdingId}>
                      <td>
                        <a href={`/holdings/${h.holdingId}`} className="strong">{h.name}</a>
                        <span className="sub">{[h.symbol, h.portfolioName].filter(Boolean).join(' · ')}</span>
                      </td>
                      <td className="money">{qty(h.qty.toString())}<span className="sub">Lot {h.lots}</span></td>
                      <td>
                        {h.price ? money(h.price.toString(), h.currency) : '—'}
                        {h.stale && <span className="sub">지연</span>}
                      </td>
                      <td className="money">{krwShort(h.value.toString())}</td>
                      <td className="muted">{pct(h.weight, 1, false)}</td>
                      <td className={`money ${tone(h.unrealized.toString())}`}>
                        {signedKrwShort(h.unrealized.toString())}
                        <span className="sub">{h.costBase.isZero() ? '' : pct(h.unrealized.div(h.costBase.abs()).toString())}</span>
                      </td>
                      <td><JournalPickButton assetId={h.assetId} name={h.name} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">보유 종목이 없습니다.</p>
          )}
        </div>
      </section>
    </JournalPanelProvider>
  );
}

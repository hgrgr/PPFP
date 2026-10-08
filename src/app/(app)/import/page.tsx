import { importHoldingsAction, readPasteAction, syncExchangeAction } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { ImportTable, PasteImport } from '@/components/import-table';
import { kstDateTime } from '@/lib/format';
import { BROKERS, isCryptoBroker } from '@/lib/brokers';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { loadBrokerSources } from '@/server/services/imports';

export const metadata = { title: '보유종목 가져오기' };
export const dynamic = 'force-dynamic';

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const user = await requireUser();
  const { p } = await searchParams;
  const portfolios = await prisma.portfolio.findMany({
    where: { userId: user.id, archived: false },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true },
  });
  const defaultPortfolioId = portfolios.some((x) => x.id === p) ? p! : (portfolios[0]?.id ?? '');
  const [sources, exchanges] = portfolios.length
    ? await Promise.all([loadBrokerSources(user.id), prisma.brokerConnection.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } }).then((l) => l.filter((c) => isCryptoBroker(c.broker)))])
    : [[], []];
  const yearAgo = new Date(Date.now() + 9 * 3_600_000 - 365 * 86_400_000).toISOString().slice(0, 10);
  const nameOf = new Map(portfolios.map((x) => [x.id, x.name]));

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>보유종목 가져오기</h1>
          <p className="sub">
            연결한 증권사 계좌의 보유종목을 골라 포트폴리오에 넣습니다. 같은 계좌에서 이미 가져온 수량은 빼고 보여주므로, 나중에 다시 와도 새로 산 만큼만 가져올 수
            있습니다.
          </p>
        </div>
        <a className="btn" href="/settings">
          증권사 연결 관리
        </a>
      </header>

      {!portfolios.length ? (
        <section className="card">
          <p className="empty">먼저 종목을 넣을 포트폴리오를 만드세요.</p>
          <div>
            <a className="btn primary" href="/portfolios">
              포트폴리오 만들기
            </a>
          </div>
        </section>
      ) : (
        <>
          {sources.length === 0 && (
            <p className="callout">
              연결된 증권사가 없습니다. <a href="/settings">설정</a>에서 한국투자·키움·LS·DB·메리츠·토스증권 Open API를 연결하거나, 아래에서 잔고를 붙여넣으세요. 코인 거래소는 연결하면
              아래에 거래내역 동기화가 나타납니다.
            </p>
          )}
          {sources.map((s) => (
            <section key={s.key} className="card">
              <div className="spread">
                <h2>{s.label}</h2>
                <span className="badge">{s.broker ? BROKERS[s.broker].label : '붙여넣기'}</span>
              </div>
              {s.error ? (
                <p className="msg err">
                  {s.error} <a href="/settings">연결 확인하기</a>
                </p>
              ) : (
                <ImportTable source={s} portfolios={portfolios} defaultPortfolioId={defaultPortfolioId} action={importHoldingsAction} />
              )}
            </section>
          ))}

          {exchanges.length > 0 && (
            <section className="card" id="crypto">
              <h2>코인 거래소 거래내역</h2>
              <p className="sub">
                거래소의 체결·원화 입출금·코인 입출고를 같은 날짜·가격·수수료로 포트폴리오에 기록해 Lot·실현손익·수익률을 계산합니다. 시작일 이전부터 갖고 있던 코인과 원화는 시작
                시점에 거래소 평균단가로 넣고, 외부 지갑과 주고받은 코인은 그날 종가로 평가합니다. 한 번 가져온 뒤에는 새로 생긴 내역만 이어서 가져옵니다.
              </p>
              {exchanges.map((c) => (
                <div key={c.id} className="callout stack" style={{ gap: 10 }}>
                  <div className="spread">
                    <span className="strong">{c.label}</span>
                    <span className="sub">
                      {c.historySyncedTo
                        ? `${nameOf.get(c.historyPortfolioId ?? '') ?? '포트폴리오'} · ${c.historySince ? kstDateTime(c.historySince).slice(0, 10) : ''}부터 · 마지막 동기화 ${kstDateTime(c.historySyncedTo)}`
                        : '아직 가져오지 않음'}
                    </span>
                  </div>
                  {c.lastError && <p className="msg err">{c.lastError}</p>}
                  <ActionForm action={syncExchangeAction} className="inline">
                    <input type="hidden" name="id" value={c.id} />
                    {!c.historySyncedTo && (
                      <>
                        <label className="field" style={{ minWidth: 200 }}>
                          <span className="sub">넣을 포트폴리오</span>
                          <select name="portfolioId" defaultValue={defaultPortfolioId} required>
                            {portfolios.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span className="sub">시작일</span>
                          <input type="date" name="since" defaultValue={yearAgo} required />
                        </label>
                      </>
                    )}
                    <Submit pendingText="내역을 가져오는 중… (주문이 많으면 몇 분 걸릴 수 있음)">{c.historySyncedTo ? '새 거래내역 동기화' : '거래내역 가져오기'}</Submit>
                  </ActionForm>
                  {c.broker === 'KORBIT' && <p className="sub">코빗(디지털엑스) API는 체결 내역을 최근 36시간만 주므로, 그 이전 보유분은 시작 시점에 평균단가로 넣습니다.</p>}
                </div>
              ))}
            </section>
          )}

          <section className="card" id="paste">
            <h2>잔고 붙여넣기 · 파일</h2>
            <p className="sub">하나증권·미래에셋증권·KB증권처럼 연결할 수 없는 증권사의 보유종목을 가져옵니다. 증권사 이름별로 이미 가져온 수량을 기억합니다.</p>
            <PasteImport readAction={readPasteAction} importAction={importHoldingsAction} portfolios={portfolios} defaultPortfolioId={defaultPortfolioId} />
          </section>
        </>
      )}
    </>
  );
}

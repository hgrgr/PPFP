import { importHoldingsAction, readPasteAction } from '@/app/actions';
import { ImportTable, PasteImport } from '@/components/import-table';
import { BROKERS } from '@/lib/brokers';
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
  const sources = portfolios.length ? await loadBrokerSources(user.id) : [];

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
              연결된 증권사가 없습니다. <a href="/settings">설정</a>에서 한국투자·키움·LS·DB·메리츠·토스증권 Open API를 연결하거나, 아래에서 잔고를 붙여넣으세요.
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

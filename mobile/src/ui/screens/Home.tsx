import { Link } from 'react-router-dom';
import type { HoldingView } from '~/core/book';
import { ASSET_TYPE_LABEL, type AssetType } from '~/core/types';
import { db } from '~/core/db';
import { refreshPrices } from '~/core/prices';
import { seedDemo } from '~/core/demo';
import { useBook, useLive, useSetting } from '../hooks';
import { ago, pct, shortWon, tone, won } from '../format';
import { Icon, Msg, Shares, Spark, Topbar, useAction } from '../kit';
import type { ServerLink } from '~/core/server';

export function Home() {
  const data = useBook();
  const days = useLive(() => db.days.orderBy('date').toArray());
  const pricesAt = useSetting<string | null>('pricesAt', null);
  const link = useSetting<ServerLink | null>('server', null);
  const unread = useLive(() => db.notices.filter((n) => !n.read).count());
  const refresh = useAction();

  if (!data) return <Topbar title="PPFP" />;
  const { book } = data;

  if (!data.txns.length) return <Welcome />;

  const profit = book.valueKrw.sub(book.investedKrw);
  const ret = book.investedKrw.isPos() ? profit.div(book.investedKrw).toNumber() : null;
  const byType = new Map<string, number>();
  for (const h of book.holdings) {
    if (h.asset.type === 'LIABILITY') continue;
    byType.set(h.asset.type, (byType.get(h.asset.type) ?? 0) + h.valueKrw.toNumber());
  }
  if (book.cashKrw.isPos()) byType.set('CASH_BAL', (byType.get('CASH_BAL') ?? 0) + book.cashKrw.toNumber());
  const types = [...byType].sort((a, b) => b[1] - a[1]).map(([t, v]) => ({ label: t === 'CASH_BAL' ? '포트폴리오 현금' : ASSET_TYPE_LABEL[t as AssetType], value: v, sub: shortWon(v) }));

  return (
    <>
      <Topbar
        title="PPFP"
        right={
          <>
            <span className={`pill ${link ? 'on' : ''}`} title={link ? `${link.url} 연결됨` : '서버 없이 이 폰에서만'}>
              <span className="led" />
              {link ? '서버 연동' : '스탠드얼론'}
            </span>
            <Link to="/notices" className="btn small" aria-label={`알림${unread ? ` ${unread}개` : ''}`}>
              {Icon.bell}
              {unread ? <span className="badge">{unread}</span> : null}
            </Link>
          </>
        }
      />
      <div className="page">
        <section className="card" aria-label="순자산">
          <div className="sub">순자산 (자산 − 부채)</div>
          <div className="big">{won(book.valueKrw)}</div>
          <div className={`num ${tone(profit)}`}>
            {profit.isNeg() ? '' : '+'}
            {won(profit)} ({pct(ret)}) <span className="sub">넣은 돈 대비</span>
          </div>
          <Spark points={(days ?? []).slice(-90).map((d) => d.value)} label="최근 순자산 추이" />
          <div className="kpis">
            <div className="kpi">
              <span className="sub">총자산</span>
              <span className="v">{shortWon(book.assetsKrw)}</span>
            </div>
            <div className="kpi">
              <span className="sub">부채</span>
              <span className="v">{shortWon(book.liabilitiesKrw)}</span>
            </div>
            <div className="kpi">
              <span className="sub">넣은 돈</span>
              <span className="v">{shortWon(book.investedKrw)}</span>
            </div>
            <div className="kpi">
              <span className="sub">현금</span>
              <span className="v">{shortWon(book.cashKrw)}</span>
            </div>
          </div>
          <div className="actions">
            <button className="btn small" disabled={refresh.busy} onClick={() => refresh.run(async () => {
              const r = await refreshPrices();
              return [`시세 ${r.updated}개를 새로 받았습니다.`, ...r.notes, r.failed.length ? `받지 못한 종목: ${r.failed.join(', ')}` : ''].filter(Boolean).join(' ');
            })}>
              {Icon.refresh} {refresh.busy ? '받는 중…' : '시세 새로고침'}
            </button>
            <span className="sub" style={{ alignSelf: 'center' }}>
              시세 {ago(pricesAt)} · $1 = {Number(data.usdKrw.toString()).toLocaleString('ko-KR')}원
            </span>
          </div>
          <Msg {...refresh.msg} />
          {book.problems.length > 0 && <Msg error={`맞지 않는 거래가 ${book.problems.length}건 있습니다: ${book.problems[0].message}`} />}
        </section>

        <section className="card" aria-label="자산 배분">
          <div className="card-head">
            <h2>자산 배분</h2>
            <Link to="/net-worth" className="sub">재무상태표 ›</Link>
          </div>
          <Shares items={types} />
        </section>

        <section className="card flush" aria-label="포트폴리오">
          <div className="card-head" style={{ padding: '14px 14px 4px' }}>
            <h2>포트폴리오</h2>
            <Link to="/portfolios" className="sub">관리 ›</Link>
          </div>
          <div className="list">
            {book.portfolios.map((p) => {
              const pr = p.valueKrw.sub(p.investedKrw);
              return (
                <Link key={p.portfolio.id} to={`/holdings?p=${p.portfolio.id}`} className="row">
                  <div className="grow">
                    <span className="name">{p.portfolio.name}</span>
                    <span className="sub">{p.holdings.length}종목 · 현금 {shortWon(p.cashKrw)}</span>
                  </div>
                  <div className="end">
                    <span className="strong">{shortWon(p.valueKrw)}</span>
                    <span className={`sub ${tone(pr)}`}>{pr.isNeg() ? '' : '+'}{shortWon(pr)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <TopMovers holdings={book.holdings} />
      </div>
    </>
  );
}

function TopMovers({ holdings }: { holdings: HoldingView[] }) {
  const listed = holdings.filter((h) => h.priceFrom === 'market' && h.costKrw.isPos());
  if (!listed.length) return null;
  const ranked = [...listed].sort((a, b) => b.pnlKrw.div(b.costKrw).cmp(a.pnlKrw.div(a.costKrw))).slice(0, 5);
  return (
    <section className="card flush" aria-label="수익률 상위">
      <div className="card-head" style={{ padding: '14px 14px 4px' }}>
        <h2>수익률 상위</h2>
        <Link to="/holdings" className="sub">전체 ›</Link>
      </div>
      <div className="list">
        {ranked.map((h) => (
          <Link key={`${h.portfolioId}:${h.asset.id}`} to={`/asset/${h.asset.id}`} className="row">
            <div className="grow">
              <span className="name">{h.asset.name}</span>
              <span className="sub">{shortWon(h.valueKrw)}</span>
            </div>
            <span className={`strong num ${tone(h.pnlKrw)}`}>{pct(h.pnlKrw.div(h.costKrw).toNumber())}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Welcome() {
  const act = useAction();
  return (
    <>
      <Topbar title="PPFP" />
      <div className="page">
        <section className="card">
          <h2>내 자산을 이 폰에서 관리합니다</h2>
          <p className="sub">
            서버 없이 이 폰 안에만 저장합니다. 주식·코인·예금·부동산·대출까지 넣으면 순자산과 수익률을 계산합니다. 백업 파일을 구글 드라이브에 두고, 나중에 PPFP 서버를 연결하면 실시간 알림 같은 기능이 더 열립니다.
          </p>
          <div className="actions">
            <Link to="/portfolios" className="btn primary">포트폴리오 만들기</Link>
            <Link to="/backup" className="btn">백업에서 되살리기</Link>
          </div>
        </section>
        <section className="card">
          <h2>먼저 둘러보기</h2>
          <p className="sub">예시 포트폴리오와 거래를 넣어 화면을 둘러봅니다. 나중에 더보기 › 데이터 지우기로 지울 수 있습니다.</p>
          <button className="btn" disabled={act.busy} onClick={() => act.run(async () => { await seedDemo(); return '예시 데이터를 넣었습니다.'; })}>
            예시 데이터 넣기
          </button>
          <Msg {...act.msg} />
        </section>
        <section className="card">
          <h2>서버를 쓰고 있다면</h2>
          <p className="sub">이미 PPFP 웹 서버를 쓰고 있으면 더보기 › 서버 연동에서 로그인한 뒤 서버의 데이터를 이 폰으로 가져올 수 있습니다.</p>
          <Link to="/server" className="btn">서버 연동</Link>
        </section>
      </div>
    </>
  );
}


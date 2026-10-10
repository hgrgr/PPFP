import { addAssetAndBuyAction } from '@/app/actions';
import { AddAssetForm } from '@/components/add-asset-form';
import { AssetBookView } from '@/components/asset-book';
import { krw, pct, signedKrwShort, tone } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { prisma } from '@/server/db';
import { assetBook } from '@/server/services/asset-book';

export const metadata = { title: '보유 자산' };
export const dynamic = 'force-dynamic';

export default async function AssetsPage() {
  const user = await requireUser();
  const [book, linked] = await Promise.all([assetBook(user.id), prisma.brokerConnection.count({ where: { userId: user.id } })]);
  const held = book.assets.filter((a) => a.type !== 'LIABILITY');
  const value = held.reduce((s, a) => s + a.value, 0);
  const cost = held.reduce((s, a) => s + a.cost, 0);
  const debt = book.assets.filter((a) => a.type === 'LIABILITY').reduce((s, a) => s + a.value, 0);
  const untagged = book.assets.filter((a) => !a.traitIds.length).length;
  const spread = book.assets.filter((a) => a.positions.length > 1).length;

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>보유 자산</h1>
          <p className="sub">가진 종목과 자산을 포트폴리오와 상관없이 한곳에서 봅니다. 어느 포트폴리오에 담겼는지, 어떤 성질인지 보고, 옮기거나 빼거나 더 살 수 있습니다.</p>
        </div>
        <a className="btn primary" href="#add">
          + 자산 추가
        </a>
      </header>

      <section className="row asset-kpis">
        <div className="card kpi">
          <div className="label">보유 자산</div>
          <div className="value">{held.length}개</div>
          <div className="note">{spread ? `${spread}개는 여러 포트폴리오에 나눠 담김` : '포트폴리오마다 따로 담김'}</div>
        </div>
        <div className="card kpi">
          <div className="label">평가액 (현금 제외)</div>
          <div className="value money">{krw(value)}</div>
          <div className="note">{debt ? <>부채 <span className="money">{krw(debt)}</span></> : '부채 없음'}</div>
        </div>
        <div className="card kpi">
          <div className="label">미실현 손익</div>
          <div className={`value money ${tone(value - cost)}`}>{signedKrwShort(value - cost)}</div>
          <div className="note">{cost ? pct((value - cost) / cost) : '—'}</div>
        </div>
        <div className="card kpi">
          <div className="label">성질 미지정</div>
          <div className="value">{untagged}개</div>
          <div className="note">
            {book.groups.length ? '관리를 눌러 성질을 고르세요.' : <a href="/traits">자산 성질에서 분류 추가하기</a>}
          </div>
        </div>
      </section>

      <AssetBookView book={book} />

      <section className="card" id="add">
        <h2>자산 추가 · 매수</h2>
        {book.portfolios.length ? (
          <>
            <AddAssetForm action={addAssetAndBuyAction} portfolios={book.portfolios.filter((p) => !p.archived)} marketLinked={linked > 0} usdkrw={book.usdkrw} />
            <p className="sub">이미 가진 종목을 더 사려면 목록에서 관리를 누르세요. 같은 포트폴리오의 같은 종목 코드는 하나의 보유로 합쳐지고 매수마다 Lot이 따로 생깁니다.</p>
          </>
        ) : (
          <p className="empty">
            먼저 <a href="/portfolios">포트폴리오</a>를 만드세요.
          </p>
        )}
      </section>
    </>
  );
}

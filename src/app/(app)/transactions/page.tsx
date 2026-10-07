import { deleteTransactionAction } from '@/app/actions';
import { ActionForm, Submit } from '@/components/forms';
import { Dec } from '@/domain/decimal';
import { TXN_LABEL, TXN_TYPES, type TxnType } from '@/domain/ledger';
import { isDate } from '@/domain/period';
import { effectiveWeights } from '@/domain/portfolio-graph';
import { kstDateTime, money, qty, tone } from '@/lib/format';
import { requireUser } from '@/server/auth';
import { dec, prisma } from '@/server/db';
import { userGraph } from '@/server/services/portfolios';

export const metadata = { title: '거래 내역' };
export const dynamic = 'force-dynamic';

const PAGE = 100;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { portfolios, edges } = await userGraph(user.id);
  const names = new Map(portfolios.map((p) => [p.id, p.name]));
  const scope = sp.p && names.has(sp.p) ? sp.p : '';
  const ids = scope ? [...effectiveWeights(edges, scope).keys()] : portfolios.map((p) => p.id);
  const type = (TXN_TYPES as readonly string[]).includes(sp.type ?? '') ? (sp.type as TxnType) : undefined;
  const from = isDate(sp.from) ? new Date(Date.parse(sp.from + 'T00:00:00+09:00')) : undefined;
  const to = isDate(sp.to) ? new Date(Date.parse(sp.to + 'T23:59:59.999+09:00')) : undefined;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);

  const where = { portfolioId: { in: ids }, type, tradeAt: from || to ? { gte: from, lte: to } : undefined };
  const [rows, count] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { holding: { include: { asset: true } }, consumptions: true },
      orderBy: { tradeAt: 'desc' },
      skip: page * PAGE,
      take: PAGE,
    }),
    prisma.transaction.count({ where }),
  ]);
  const pageHref = (n: number) =>
    `?${new URLSearchParams([...Object.entries(sp).filter(([k, v]) => v && k !== 'page'), ['page', String(n)]] as [string, string][])}`;
  const exportQs = new URLSearchParams(Object.entries({ p: scope, from: sp.from, to: sp.to }).filter(([, v]) => v) as [string, string][]);

  return (
    <>
      <header className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>거래 내역</h1>
          <p className="sub">{count.toLocaleString('ko-KR')}건 · 삭제한 거래는 감사 로그에 남습니다.</p>
        </div>
        <div className="inline">
          <a className="btn" href={`/api/export/transactions?format=csv&${exportQs}`}>CSV</a>
          <a className="btn" href={`/api/export/transactions?format=xlsx&${exportQs}`}>XLSX</a>
        </div>
      </header>

      <form method="get" className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12, alignItems: 'end' }}>
        <label className="field">
          포트폴리오 (하위 포함)
          <select name="p" defaultValue={scope}>
            <option value="">전체</option>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          유형
          <select name="type" defaultValue={type ?? ''}>
            <option value="">전체</option>
            {TXN_TYPES.map((t) => (
              <option key={t} value={t}>{TXN_LABEL[t]}</option>
            ))}
          </select>
        </label>
        <label className="field">
          시작일
          <input type="date" name="from" defaultValue={sp.from} />
        </label>
        <label className="field">
          종료일
          <input type="date" name="to" defaultValue={sp.to} />
        </label>
        <button className="btn" type="submit">필터</button>
      </form>

      <section className="card">
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">일시</th><th scope="col" className="l">포트폴리오</th><th scope="col">유형</th><th scope="col" className="l">자산</th>
                  <th scope="col">수량</th><th scope="col">단가</th><th scope="col">현금 증감</th><th scope="col">실현손익</th><th scope="col"><span className="sr-only">작업</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const pnl = t.consumptions.length ? Dec.sum(t.consumptions.map((c) => dec(c.pnl))) : null;
                  return (
                    <tr key={t.id}>
                      <td>{kstDateTime(t.tradeAt)}</td>
                      <td className="l"><a href={`/portfolios/${t.portfolioId}`}>{names.get(t.portfolioId)}</a></td>
                      <td className="strong">{TXN_LABEL[t.type]}</td>
                      <td className="l">{t.holding ? <a href={`/holdings/${t.holdingId}`}>{t.holding.asset.name}</a> : <span className="muted">—</span>}</td>
                      <td>{t.qty ? qty(dec(t.qty).toString()) : t.splitRatio ? `×${dec(t.splitRatio).toString()}` : '—'}</td>
                      <td>{t.price ? money(dec(t.price).toString(), t.currency) : '—'}</td>
                      <td className={`money ${tone(dec(t.cashDelta).toString())}`}>{dec(t.cashDelta).isZero() ? '—' : money(dec(t.cashDelta).toString(), t.currency)}</td>
                      <td className={pnl ? tone(pnl.toString()) : 'muted'}>{pnl ? money(pnl.toString(), t.currency) : '—'}</td>
                      <td>
                        <ActionForm action={deleteTransactionAction} confirm="이 거래를 삭제하고 Lot·현금을 되돌릴까요?">
                          <input type="hidden" name="id" value={t.id} />
                          <Submit className="btn small danger" pendingText="…">삭제</Submit>
                        </ActionForm>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">조건에 맞는 거래가 없습니다.</p>
        )}
        {count > PAGE && (
          <div className="inline">
            {page > 0 && <a className="btn small" href={pageHref(page - 1)}>이전</a>}
            <span className="sub">{page + 1} / {Math.ceil(count / PAGE)}</span>
            {(page + 1) * PAGE < count && <a className="btn small" href={pageHref(page + 1)}>다음</a>}
          </div>
        )}
      </section>
    </>
  );
}

import type { BalanceGroup } from '@/domain/net-worth';
import { krw, krwShort } from '@/lib/format';

/** One side of the balance sheet: group rows with their items, each linking to its holding. */
export function BalanceSide({ title, groups, total }: { title: string; groups: BalanceGroup[]; total: number }) {
  return (
    <div className="card stack">
      <div className="spread">
        <h2>{title}</h2>
        <span className="strong money">{krw(total)}</span>
      </div>
      {groups.length === 0 ? (
        <p className="empty">아직 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>항목</th>
                <th>금액</th>
                <th>비중</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => [
                <tr key={g.key}>
                  <td className="strong">{g.label}</td>
                  <td className="strong money">{krwShort(g.total)}</td>
                  <td className="muted">{total > 0 ? `${((g.total / total) * 100).toFixed(1)}%` : '—'}</td>
                </tr>,
                ...g.items.map((it) => (
                  <tr key={`${g.key}:${it.id}`}>
                    <td style={{ paddingLeft: 24 }}>{it.href ? <a href={it.href}>{it.name}</a> : it.name}</td>
                    <td className="money">{krwShort(it.amount)}</td>
                    <td />
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

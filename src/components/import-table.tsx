'use client';

import { useActionState, useCallback, useEffect, useMemo, useState } from 'react';
import type { ActionState, PasteState } from '@/app/actions';
import { Dec } from '@/domain/decimal';
import { money, qty as fmtQty } from '@/lib/format';
import type { ImportRow, ImportSource } from '@/server/services/imports';
import { ActionForm, DateTimeField, Submit } from './forms';

type Action = (s: ActionState, f: FormData) => Promise<ActionState>;
interface PortfolioOption {
  id: string;
  name: string;
}

interface RowState {
  checked: boolean;
  qty: string;
  price: string;
  portfolioId: string;
}

const pos = (v: string) => {
  try {
    return Dec.of(v).isPos();
  } catch {
    return false;
  }
};

/** Probably recorded by hand already: nothing came from this source, yet the app holds at least as much. */
function likelyRecorded(r: ImportRow) {
  return !pos(r.importedQty) && pos(r.ledgerQty) && Dec.of(r.ledgerQty).gte(r.brokerQty);
}

function initial(rows: ImportRow[], portfolioId: string): RowState[] {
  return rows.map((r) => ({
    checked: pos(r.suggestedQty) && !likelyRecorded(r),
    qty: pos(r.suggestedQty) ? r.suggestedQty : r.brokerQty,
    price: r.avgPrice,
    portfolioId,
  }));
}

/** Holdings of one source with per-row quantity, price and destination portfolio. */
export function ImportTable({
  source,
  portfolios,
  defaultPortfolioId,
  action,
}: {
  source: ImportSource;
  portfolios: PortfolioOption[];
  defaultPortfolioId: string;
  action: Action;
}) {
  const fallback = defaultPortfolioId || portfolios[0]?.id || '';
  const signature = source.rows.map((r) => `${r.symbol}:${r.brokerQty}:${r.importedQty}`).join('|');
  const [state, setState] = useState<RowState[]>(() => initial(source.rows, fallback));
  const [bulk, setBulk] = useState(fallback);
  const [justImported, setJustImported] = useState<Set<string>>(new Set());
  // After an import the page re-renders with new "already imported" numbers: start over from them.
  useEffect(() => {
    setState(initial(source.rows, fallback));
    setJustImported(new Set());
  }, [signature, fallback]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pasted tables are not re-read after an import, so untick what was just imported to prevent doubles.
  const submit = useCallback<Action>(
    async (prev, form) => {
      const result = await action(prev, form);
      if (result.ok) {
        setJustImported((done) => new Set([...done, ...source.rows.filter((_, i) => state[i]?.checked).map((r) => r.symbol)]));
        setState((rows) => rows.map((r) => ({ ...r, checked: false })));
      }
      return result;
    },
    [action, source.rows, state],
  );

  const selected = useMemo(
    () =>
      state.flatMap((s, i) => {
        const r = source.rows[i];
        return s.checked ? [{ symbol: r.symbol, name: r.name, currency: r.currency, market: r.market, qty: s.qty, price: s.price, portfolioId: s.portfolioId }] : [];
      }),
    [state, source.rows],
  );
  const set = (i: number, patch: Partial<RowState>) => setState((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const allChecked = state.length > 0 && state.every((s) => s.checked);

  if (!source.rows.length) return <p className="empty">계좌에 보유종목이 없습니다.</p>;

  return (
    <ActionForm action={submit} className="stack">
      <input type="hidden" name="sourceKey" value={source.key} />
      <input type="hidden" name="sourceLabel" value={source.label} />
      <input type="hidden" name="rows" value={JSON.stringify(selected)} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    aria-label="전체 선택"
                    onChange={(e) => setState((prev) => prev.map((s) => ({ ...s, checked: e.target.checked })))}
                  />
                </label>
              </th>
              <th scope="col">종목</th>
              <th scope="col">계좌 수량</th>
              <th scope="col">이미 가져옴</th>
              <th scope="col">가져올 수량</th>
              <th scope="col">평균단가</th>
              <th scope="col">현재가</th>
              <th scope="col">넣을 포트폴리오</th>
            </tr>
          </thead>
          <tbody>
            {source.rows.map((r, i) => {
              const s = state[i];
              if (!s) return null;
              const done = !pos(r.suggestedQty);
              return (
                <tr key={r.symbol + r.currency}>
                  <td>
                    <input type="checkbox" checked={s.checked} aria-label={`${r.name} 선택`} onChange={(e) => set(i, { checked: e.target.checked })} />
                  </td>
                  <td>
                    <span className="strong">{r.name}</span>
                    <span className="sub">
                      {r.symbol} · {r.currency}
                      {likelyRecorded(r) && ' · 장부에 이미 있음'}
                    </span>
                  </td>
                  <td className="money">{fmtQty(r.brokerQty)}</td>
                  <td className={done ? 'muted' : 'money'}>
                    {pos(r.importedQty) ? fmtQty(r.importedQty) : '—'}
                    {(done || justImported.has(r.symbol)) && <span className="sub">{justImported.has(r.symbol) ? '방금 가져옴' : '완료'}</span>}
                  </td>
                  <td>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={s.qty}
                      onChange={(e) => set(i, { qty: e.target.value })}
                      aria-label={`${r.name} 가져올 수량`}
                      style={{ width: 110 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={s.price}
                      onChange={(e) => set(i, { price: e.target.value })}
                      aria-label={`${r.name} 평균단가 (${r.currency})`}
                      style={{ width: 120 }}
                    />
                  </td>
                  <td className="muted">{r.lastPrice && pos(r.lastPrice) ? money(r.lastPrice, r.currency) : '—'}</td>
                  <td>
                    <select value={s.portfolioId} onChange={(e) => set(i, { portfolioId: e.target.value })} aria-label={`${r.name} 넣을 포트폴리오`}>
                      {portfolios.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="inline" style={{ alignItems: 'end' }}>
        <label className="field" style={{ minWidth: 200 }}>
          <span className="sub">선택한 종목을 모두</span>
          <select value={bulk} onChange={(e) => setBulk(e.target.value)}>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={() => setState((prev) => prev.map((s) => (s.checked ? { ...s, portfolioId: bulk } : s)))}>
          에 넣기
        </button>
        <DateTimeField name="tradeAt" label="취득 기준 일시 (KST)" />
        <Submit pendingText="가져오는 중…">{`선택한 ${selected.length}종목 가져오기`}</Submit>
      </div>
      <p className="sub">
        종목마다 증권사 평균단가로 시작 Lot 하나를 만들고, 외부 입금(수익률 계산에서 제외)으로 기록합니다. 해외 종목은 현재 환율을 취득 환율로 씁니다. 정확한 취득일·단가가
        필요하면 대신 과거 매수를 직접 기록하세요.
      </p>
    </ActionForm>
  );
}

/** Paste a balance table (or upload CSV/XLSX), review it, then import like an API source. */
export function PasteImport({
  readAction,
  importAction,
  portfolios,
  defaultPortfolioId,
}: {
  readAction: (s: PasteState, f: FormData) => Promise<PasteState>;
  importAction: Action;
  portfolios: PortfolioOption[];
  defaultPortfolioId: string;
}) {
  const [state, formAction, pending] = useActionState(readAction, {} as PasteState);
  return (
    <div className="stack">
      <form action={formAction} className="grid">
        <label className="field">
          증권사 이름
          <input name="label" required maxLength={30} placeholder="예: 하나증권, 미래에셋 ISA" defaultValue={state.source?.label} />
        </label>
        <label className="field">
          잔고 파일 (선택)
          <input name="file" type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv" />
        </label>
        <label className="field full">
          잔고 표 붙여넣기
          <textarea
            name="text"
            rows={7}
            spellCheck={false}
            placeholder={'종목코드\t종목명\t보유수량\t평균단가\n005930\t삼성전자\t10\t71,200\nAAPL\t애플\t3\t187.50'}
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}
          />
        </label>
        <p className="sub full">
          HTS·MTS·웹의 잔고 화면을 표 전체로 복사해 붙여넣거나 내려받은 CSV·엑셀 파일을 올리세요. 첫 줄에 <span className="strong">종목코드</span>·
          <span className="strong">보유수량</span>·<span className="strong">평균단가</span>(또는 매입금액) 열 이름이 있으면 순서는 상관없습니다. 종목명만 있고 코드가 없는
          표는 읽지 못합니다.
        </p>
        <div className="full">
          <button className="btn primary" type="submit" disabled={pending} aria-busy={pending}>
            {pending ? '읽는 중…' : '읽기'}
          </button>
        </div>
      </form>
      {state.error && (
        <p role="alert" className="msg err">
          {state.error}
        </p>
      )}
      {state.errors && state.errors.length > 0 && (
        <div role="status" className="callout">
          <div className="strong">읽지 못한 줄 {state.errors.length}개</div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {state.errors.slice(0, 12).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {state.source && state.source.rows.length > 0 && (
        <ImportTable key={`${state.source.key}:${state.at}`} source={state.source} portfolios={portfolios} defaultPortfolioId={defaultPortfolioId} action={importAction} />
      )}
    </div>
  );
}

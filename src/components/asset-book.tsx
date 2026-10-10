'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import type { ActionState } from '@/app/actions';
import { buyAction, moveHoldingAction, removeAssetAction, removeHoldingAction } from '@/app/actions';
import { setAssetTraitsAction } from '@/app/trait-actions';
import { krwShort, money, pct, qty, signedKrwShort, tone } from '@/lib/format';
import type { AssetBook, BookAsset } from '@/server/services/asset-book';
import { ActionForm, DateTimeField, Submit } from './forms';

const TYPE_LABEL: Record<string, string> = {
  KR_STOCK: '국내 주식·ETF',
  US_STOCK: '해외 주식·ETF',
  CRYPTO: '가상자산',
  BOND: '채권',
  CASH: '현금·예금',
  REAL_ESTATE: '부동산',
  FUND: '펀드',
  ALTERNATIVE: '대안자산',
  LIABILITY: '부채',
};

type Notify = (r: ActionState) => void;

/**
 * A form whose result is shown by the page, not next to the form: moving or removing a
 * holding takes its row (and the form with it) off the list.
 */
function BookForm({
  action,
  confirm,
  onResult,
  className,
  children,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  confirm: string;
  onResult: Notify;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <form
      className={className}
      onSubmit={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
      action={async (f) => onResult(await action({}, f))}
    >
      {children}
    </form>
  );
}

function Toast({ notice, onClose }: { notice: ActionState | null; onClose: () => void }) {
  useEffect(() => {
    if (!notice?.ok) return;
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [notice, onClose]);
  if (!notice || (!notice.ok && !notice.error)) return null;
  return (
    <div className={`toast ${notice.error ? 'err' : 'ok'}`} role={notice.error ? 'alert' : 'status'}>
      <span>{notice.error ?? notice.ok}</span>
      <button type="button" className="btn small" onClick={onClose}>
        닫기
      </button>
    </div>
  );
}

type Traits = Map<string, { name: string; color: string; group: string }>;

/** Every asset the user holds, with where it sits and how it is classified. */
export function AssetBookView({ book }: { book: AssetBook }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [pid, setPid] = useState('');
  const [trait, setTrait] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<ActionState | null>(null);
  const closeNotice = useCallback(() => setNotice(null), []);
  const traits: Traits = useMemo(() => new Map(book.groups.flatMap((g) => g.traits.map((t) => [t.id, { ...t, group: g.name }]))), [book.groups]);
  const types = [...new Set(book.assets.map((a) => a.type))];

  const rows = book.assets.filter((a) => {
    const needle = q.trim().toLowerCase();
    if (needle && !a.name.toLowerCase().includes(needle) && !(a.symbol ?? '').toLowerCase().includes(needle)) return false;
    if (type && a.type !== type) return false;
    if (pid && !a.positions.some((p) => p.portfolioId === pid)) return false;
    if (trait === 'none' ? a.traitIds.length > 0 : trait && !a.traitIds.includes(trait)) return false;
    return true;
  });
  const shown = rows.reduce((s, a) => s + a.value, 0);

  return (
    <section className="card" aria-label="보유 자산 목록">
      <div className="asset-filters">
        <input type="search" placeholder="이름이나 종목 코드" aria-label="자산 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="자산 유형" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">유형: 전체</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select aria-label="포트폴리오" value={pid} onChange={(e) => setPid(e.target.value)}>
          <option value="">포트폴리오: 전체</option>
          {book.portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select aria-label="성질" value={trait} onChange={(e) => setTrait(e.target.value)}>
          <option value="">성질: 전체</option>
          {book.groups.map((g) => (
            <optgroup key={g.id} label={g.name}>
              {g.traits.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          ))}
          <option value="none">성질 미지정</option>
        </select>
        <span className="sub" style={{ marginLeft: 'auto' }}>
          {rows.length}개 · <span className="money">{krwShort(shown)}</span>
        </span>
      </div>

      {rows.length ? (
        <div className="table-wrap">
          <table className="asset-book">
            <thead>
              <tr>
                <th scope="col">자산</th>
                <th scope="col" className="l">
                  소속 포트폴리오
                </th>
                <th scope="col" className="l">
                  성질
                </th>
                <th scope="col">수량</th>
                <th scope="col">현재가</th>
                <th scope="col">평가액</th>
                <th scope="col">비중</th>
                <th scope="col">미실현 손익</th>
                <th scope="col">
                  <span className="sr-only">관리</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const u = a.value - a.cost;
                const isOpen = open === a.assetId;
                return (
                  <Fragment key={a.assetId}>
                    <tr className={isOpen ? 'open' : undefined}>
                      <td>
                        <button type="button" className="linkish strong" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : a.assetId)}>
                          {a.name}
                        </button>
                        <span className="sub">
                          {a.symbol ?? '수기'} · {TYPE_LABEL[a.type]}
                        </span>
                      </td>
                      <td className="l">
                        <div className="inline" style={{ gap: 4, flexWrap: 'wrap' }}>
                          {a.positions.map((p) => (
                            <a key={p.holdingId} className="badge port-chip" href={`/holdings/${p.holdingId}`} title={`${p.portfolioName}의 ${a.name} 보기`}>
                              <span className="dot" style={{ background: p.color }} />
                              {p.portfolioName}
                            </a>
                          ))}
                        </div>
                      </td>
                      <td className="l">
                        <div className="inline" style={{ gap: 4, flexWrap: 'wrap' }}>
                          {a.traitIds.length ? (
                            a.traitIds.map((id) => {
                              const t = traits.get(id);
                              return t ? (
                                <span
                                  key={id}
                                  className="trait-chip"
                                  aria-pressed="true"
                                  style={{
                                    ['--c' as string]: t.color,
                                    cursor: 'default',
                                  }}
                                  title={t.group}
                                >
                                  {t.name}
                                </span>
                              ) : null;
                            })
                          ) : (
                            <span className="sub">미지정</span>
                          )}
                        </div>
                      </td>
                      <td className="money">{qty(a.qty)}</td>
                      <td>
                        {a.price ? money(a.price, a.currency) : '—'}
                        {a.stale && <span className="sub">지연</span>}
                      </td>
                      <td className="money">{krwShort(a.value)}</td>
                      <td className="muted">{a.type === 'LIABILITY' ? '—' : pct(a.weight, 1, false)}</td>
                      <td className={`money ${tone(u)}`}>
                        {signedKrwShort(u)}
                        <span className="sub">{a.cost ? pct(u / Math.abs(a.cost)) : ''}</span>
                      </td>
                      <td>
                        <button type="button" className="btn small" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : a.assetId)}>
                          {isOpen ? '닫기' : '관리'}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="asset-detail">
                        <td colSpan={9}>
                          <AssetDetail asset={a} book={book} onResult={setNotice} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">{book.assets.length ? '조건에 맞는 자산이 없습니다.' : '아직 보유한 자산이 없습니다. 아래에서 추가하세요.'}</p>
      )}
      <Toast notice={notice} onClose={closeNotice} />
    </section>
  );
}

function AssetDetail({ asset, book, onResult }: { asset: BookAsset; book: AssetBook; onResult: Notify }) {
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="stack" style={{ gap: 8 }}>
        <h3>담긴 포트폴리오</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">포트폴리오</th>
                <th scope="col">수량</th>
                <th scope="col">평가액</th>
                <th scope="col">미실현 손익</th>
                <th scope="col">다른 포트폴리오로 옮기기</th>
                <th scope="col">
                  <span className="sr-only">제거</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {asset.positions.map((p) => {
                const u = p.value - p.cost;
                const others = book.portfolios.filter((x) => x.id !== p.portfolioId);
                return (
                  <tr key={p.holdingId}>
                    <td>
                      <a className="strong inline" style={{ gap: 6 }} href={`/holdings/${p.holdingId}`}>
                        <span className="dot" style={{ background: p.color }} />
                        {p.portfolioName}
                      </a>
                      <span className="sub">
                        거래 {p.txns}건 · Lot {p.lots}
                      </span>
                    </td>
                    <td className="money">{qty(p.qty)}</td>
                    <td className="money">{krwShort(p.value)}</td>
                    <td className={`money ${tone(u)}`}>{signedKrwShort(u)}</td>
                    <td>
                      {others.length ? (
                        <BookForm
                          action={moveHoldingAction}
                          onResult={onResult}
                          className="inline move-form"
                          confirm={`${p.portfolioName}의 ${asset.name}을(를) 고른 포트폴리오로 옮길까요?\n거래 ${p.txns}건과 Lot이 함께 옮겨 가서 처음부터 그 포트폴리오에서 산 것처럼 됩니다. 그곳에 같은 종목이 있으면 하나로 합칩니다.\n현금 유지를 켜 두면 매매 대금만큼 현금도 보내 두 포트폴리오의 현금은 그대로입니다.${p.synced ? '\n증권사에서 가져온 거래가 있어, 다음 동기화 때 원래 포트폴리오에 다시 들어올 수 있습니다.' : ''}`}
                        >
                          <input type="hidden" name="id" value={p.holdingId} />
                          <label className="check" title="끄면 거래의 현금 기록만 따라가서, 원래 포트폴리오 현금은 늘고 옮겨 간 곳 현금은 줄어듭니다.">
                            <input type="checkbox" name="settle" value="1" defaultChecked />
                            현금 유지
                          </label>
                          <select name="to" aria-label={`${p.portfolioName}에서 옮길 포트폴리오`} defaultValue="" required>
                            <option value="" disabled>
                              옮길 곳
                            </option>
                            {others.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                          <Submit className="btn small" pendingText="…">
                            옮기기
                          </Submit>
                        </BookForm>
                      ) : (
                        <span className="sub">다른 포트폴리오 없음</span>
                      )}
                    </td>
                    <td>
                      <BookForm
                        action={removeHoldingAction}
                        onResult={onResult}
                        confirm={`${asset.name}을(를) ${p.portfolioName}에서 뺄까요?\n거래 ${p.txns}건(매수·매도·배당 등)과 Lot이 함께 지워지고, 그 거래로 늘거나 준 현금도 되돌아갑니다. 감사 로그에는 남습니다.`}
                      >
                        <input type="hidden" name="id" value={p.holdingId} />
                        <Submit className="btn small danger" pendingText="…">
                          제거
                        </Submit>
                      </BookForm>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="inline" style={{ gap: 8, flexWrap: 'wrap' }}>
          <a className="btn small" href={`/holdings/${asset.positions[0].holdingId}`}>
            종목 화면 (매수·매도)
          </a>
          <a className="btn small" href={`/journal?asset=${asset.assetId}`}>
            매매일지 {asset.journals}
          </a>
          {asset.positions.length > 1 && (
            <BookForm
              action={removeAssetAction}
              onResult={onResult}
              confirm={`${asset.name}을(를) 포트폴리오 ${asset.positions.length}곳에서 모두 뺄까요?\n거래 ${asset.positions.reduce((s, p) => s + p.txns, 0)}건과 Lot이 모두 지워지고 현금 기록도 되돌아갑니다.`}
            >
              <input type="hidden" name="assetId" value={asset.assetId} />
              <Submit className="btn small danger" pendingText="빼는 중…">
                모든 포트폴리오에서 빼기
              </Submit>
            </BookForm>
          )}
        </div>
      </div>

      <div className="asset-detail-grid">
        <div className="stack" style={{ gap: 8 }}>
          <h3>매수 추가</h3>
          <ActionForm key={asset.positions.map((p) => p.holdingId).join()} action={buyAction} className="grid" resetOnSuccess aria-label={`${asset.name} 매수 추가`}>
            <input type="hidden" name="assetId" value={asset.assetId} />
            <label className="field full">
              담을 포트폴리오
              <select name="portfolioId" defaultValue={asset.positions[0].portfolioId}>
                {book.portfolios.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {asset.positions.some((p) => p.portfolioId === x.id) ? ' (보유 중)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              수량
              <input name="qty" type="number" inputMode="decimal" min="0" step="any" required />
            </label>
            <label className="field">
              단가 ({asset.currency})
              <input name="price" type="number" inputMode="decimal" min="0" step="any" defaultValue={asset.price ?? undefined} required />
            </label>
            {asset.currency !== 'KRW' && (
              <label className="field">
                환율 (원/{asset.currency})
                <input name="fxRate" type="number" inputMode="decimal" min="0" step="any" defaultValue={book.usdkrw} required />
              </label>
            )}
            <DateTimeField />
            <label className="check full">
              <input type="checkbox" name="fromCash" value="1" defaultChecked />그 포트폴리오의 현금으로 결제 (끄면 외부 자금 투입으로 기록)
            </label>
            <div className="full">
              <Submit className="btn small primary">매수 기록</Submit>
            </div>
          </ActionForm>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <h3>성질</h3>
          {book.groups.length ? (
            book.groups.map((g) => <TraitPicker key={g.id} assetId={asset.assetId} group={g} active={asset.traitIds.filter((id) => g.traits.some((t) => t.id === id))} />)
          ) : (
            <p className="sub">
              아직 분류가 없습니다. <a href="/traits">자산 성질</a>에서 올웨더 국면, 주식 체급(우량 대형주 등), 주식 스타일 같은 분류를 추가하세요.
            </p>
          )}
          <p className="sub">
            성질을 누르면 바로 저장됩니다. 분류와 성질은 <a href="/traits">자산 성질</a>에서 고칩니다.
          </p>
        </div>
      </div>
    </div>
  );
}

function TraitPicker({ assetId, group, active }: { assetId: string; group: AssetBook['groups'][number]; active: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(active);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => {
    const next = on.includes(id) ? on.filter((x) => x !== id) : [...on, id];
    setOn(next);
    start(async () => {
      const r = await setAssetTraitsAction(assetId, group.id, next);
      setError(r.error ?? null);
      if (r.error) setOn(on);
      else router.refresh();
    });
  };
  return (
    <div className="stack" style={{ gap: 4 }} aria-busy={pending}>
      <span className="sub strong">{group.name}</span>
      <div className="inline" style={{ gap: 4, flexWrap: 'wrap' }} role="group" aria-label={`${group.name} 성질`}>
        {group.traits.map((t) => (
          <button key={t.id} type="button" className="trait-chip" aria-pressed={on.includes(t.id)} style={{ ['--c' as string]: t.color }} onClick={() => toggle(t.id)}>
            {t.name}
          </button>
        ))}
      </div>
      {error && <span className="sub down">{error}</span>}
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  addCustomGroupAction,
  addPresetGroupAction,
  deleteGroupAction,
  exampleTargetsAction,
  saveGroupAction,
  setAssetTraitsAction,
  suggestAction,
  trackWatchAction,
  type TraitResult,
} from '@/app/trait-actions';
import { PRESETS, UNASSIGNED } from '@/domain/traits';
import { krw, krwShort, pct } from '@/lib/format';
import type { TraitOverview } from '@/server/services/traits';

type Group = TraitOverview['groups'][number];
const SUGGESTABLE = new Set(['allWeather', 'assetClass', 'region']);

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<TraitResult>({});
  const act = (fn: () => Promise<TraitResult>, after?: (r: TraitResult) => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r);
      if (!r.error) {
        after?.(r);
        router.refresh();
      }
    });
  return { pending, msg, act, setMsg };
}

function Msg({ msg }: { msg: TraitResult }) {
  if (!msg.error && !msg.ok) return null;
  return <p className={`msg ${msg.error ? 'err' : 'ok'}`} role={msg.error ? 'alert' : 'status'}>{msg.error ?? msg.ok}</p>;
}

/** Classify assets by traits (올웨더 국면, 자산군, 주식 스타일 …), compare with targets and see what to buy. */
export function TraitsBoard({ data, initialGroup }: { data: TraitOverview; initialGroup?: string }) {
  const [gid, setGid] = useState<string>(data.groups.some((g) => g.id === initialGroup) ? initialGroup! : data.groups[0]?.id ?? 'add');
  const group = data.groups.find((g) => g.id === gid);
  const select = (id: string) => {
    setGid(id);
    const u = new URL(location.href);
    u.searchParams.set('g', id);
    history.replaceState(null, '', u);
  };

  return (
    <>
      {data.groups.length > 0 && (
        <div className="seg" role="tablist" aria-label="분류" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
          {data.groups.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={gid === g.id} aria-pressed={gid === g.id} onClick={() => select(g.id)}>
              {g.name}
            </button>
          ))}
          <button type="button" role="tab" aria-selected={gid === 'add'} aria-pressed={gid === 'add'} onClick={() => select('add')}>
            + 분류 추가
          </button>
        </div>
      )}
      {group ? <GroupView key={group.id} group={group} data={data} onDeleted={() => select(data.groups.find((g) => g.id !== group.id)?.id ?? 'add')} /> : <AddGroup existing={data.groups} onAdded={(id) => id && setGid(id)} />}
    </>
  );
}

function AddGroup({ existing, onAdded }: { existing: Group[]; onAdded: (id?: string) => void }) {
  const { pending, msg, act } = useAct();
  const [auto, setAuto] = useState(true);
  const [name, setName] = useState('');
  const [traits, setTraits] = useState('');
  const left = PRESETS.filter((p) => !existing.some((g) => g.preset === p.key));
  return (
    <section className="stack">
      <div className="stack" style={{ gap: 4 }}>
        <h2>분류 추가</h2>
        <p className="sub">자산을 어떤 기준으로 나눠 볼지 고릅니다. 여러 분류를 함께 쓸 수 있고, 성질 이름·색·목표 비중은 추가한 뒤 고칠 수 있습니다.</p>
      </div>
      <Msg msg={msg} />
      <label className="inline sub" style={{ gap: 6 }}>
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        추가하면서 종목 유형·이름으로 알 수 있는 성질은 자동으로 지정 (올웨더 국면, 자산군, 지역)
      </label>
      <div className="tpl-grid">
        {left.map((p) => (
          <div key={p.key} className="card tight stack" style={{ gap: 8 }}>
            <h3 className="strong" style={{ fontSize: 15 }}>{p.name}</h3>
            <p className="sub">{p.description}</p>
            <div className="inline" style={{ gap: 4 }}>
              {p.traits.map((t) => (
                <span key={t.name} className="chip" style={{ paddingRight: 10 }} title={t.description}>
                  <span className="dot" style={{ background: t.color }} />
                  {t.name}
                </span>
              ))}
            </div>
            {p.example && <p className="sub">예시 목표: {p.example.label}</p>}
            <div>
              <button type="button" className="btn small primary" disabled={pending} onClick={() => act(() => addPresetGroupAction(p.key, auto && SUGGESTABLE.has(p.key)), (r) => onAdded(r.id))}>
                추가
              </button>
            </div>
          </div>
        ))}
        <div className="card tight stack" style={{ gap: 8 }}>
          <h3 className="strong" style={{ fontSize: 15 }}>직접 만들기</h3>
          <input aria-label="분류 이름" value={name} placeholder="분류 이름 (예: 투자 테마)" onChange={(e) => setName(e.target.value)} />
          <input aria-label="성질" value={traits} placeholder="성질을 쉼표로: AI, 2차전지, 바이오" onChange={(e) => setTraits(e.target.value)} />
          <div>
            <button type="button" className="btn small primary" disabled={pending} onClick={() => act(() => addCustomGroupAction(name, traits), (r) => onAdded(r.id))}>
              만들기
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function GroupView({ group, data, onDeleted }: { group: Group; data: TraitOverview; onDeleted: () => void }) {
  const { pending, msg, act } = useAct();
  const [editing, setEditing] = useState(false);
  const traitIds = new Set(group.traits.map((t) => t.id));
  const short = group.slices.filter((s) => s.gap !== null && s.gap > 0.005).sort((a, b) => b.gap! - a.gap!);
  const over = group.slices.filter((s) => s.gap !== null && s.gap < -0.005).sort((a, b) => a.gap! - b.gap!);
  const hasTargets = group.traits.some((t) => t.targetWeight !== null);
  const scale = Math.max(0.0001, ...group.slices.map((s) => Math.max(s.share, s.target ?? 0)));

  return (
    <>
      <section className="card">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: 4, maxWidth: 720 }}>
            <h2>{group.name}</h2>
            {group.description && <p className="sub">{group.description}</p>}
          </div>
          <div className="inline" style={{ gap: 6 }}>
            <button type="button" className="btn small" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>{editing ? '편집 닫기' : '성질 · 목표 비중 편집'}</button>
            {group.example && (
              <button type="button" className="btn small" disabled={pending} title={group.example} onClick={() => act(() => exampleTargetsAction(group.id))}>
                예시 비중 채우기
              </button>
            )}
            {group.preset && SUGGESTABLE.has(group.preset) && (
              <button type="button" className="btn small" disabled={pending} onClick={() => act(() => suggestAction(group.id))}>
                미지정 종목 자동 지정
              </button>
            )}
            <button
              type="button"
              className="btn small danger"
              disabled={pending}
              onClick={() => confirm(`'${group.name}' 분류와 종목별 지정을 지울까요?`) && act(() => deleteGroupAction(group.id), onDeleted)}
            >
              분류 삭제
            </button>
          </div>
        </div>
        <Msg msg={msg} />
        {editing && <GroupEditor group={group} onSaved={() => setEditing(false)} />}

        <div className="table-wrap">
          <table className="trait-table">
            <thead>
              <tr>
                <th scope="col">성질</th>
                <th scope="col" className="l" style={{ width: '40%' }}>지금 비중 {hasTargets && <span className="sub" style={{ display: 'inline' }}>· 세로선은 목표</span>}</th>
                <th scope="col">지금</th>
                <th scope="col">목표</th>
                <th scope="col">차이</th>
                <th scope="col">평가액</th>
              </tr>
            </thead>
            <tbody>
              {group.slices.map((s) => (
                <tr key={s.key}>
                  <td>
                    <span className="inline" style={{ flexWrap: 'nowrap', gap: 8 }} title={group.traits.find((t) => t.id === s.key)?.description ?? undefined}>
                      <span className="dot" style={{ background: s.color }} />
                      <span className={s.key === UNASSIGNED ? 'muted' : 'strong'}>{s.label}</span>
                    </span>
                    <span className="sub">{s.assets.length ? `${s.assets.slice(0, 3).map((a) => a.name).join(', ')}${s.assets.length > 3 ? ` 외 ${s.assets.length - 3}` : ''}` : '없음'}</span>
                  </td>
                  <td className="l">
                    <span className="alloc-bar" aria-hidden="true">
                      {!s.excluded && <span className="fill" style={{ width: `${(s.share / scale) * 100}%`, background: s.color }} />}
                      {s.target !== null && <span className="target" style={{ left: `${(s.target / scale) * 100}%` }} />}
                    </span>
                  </td>
                  <td className="strong">{s.excluded ? <span className="sub" title="비중 기준이 ‘지정한 종목끼리’라 계산에서 뺍니다">제외</span> : pct(s.share, 1, false)}</td>
                  <td className="muted">{s.target === null ? '—' : pct(s.target, 1, false)}</td>
                  <td>
                    {s.gap === null ? (
                      <span className="muted">—</span>
                    ) : Math.abs(s.gap) <= 0.005 ? (
                      <span className="badge ok">맞음</span>
                    ) : s.gap > 0 ? (
                      <span className="badge warn">{pct(s.gap, 1, false)}p 부족</span>
                    ) : (
                      <span className="badge">{pct(-s.gap, 1, false)}p 많음</span>
                    )}
                  </td>
                  <td className="money">{krwShort(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub">
          {group.base === 'tagged' ? (
            <>이 분류를 지정한 종목끼리의 비중입니다. 합계 <span className="money">{krw(group.total)}</span> (미지정은 비중 계산에서 뺍니다).</>
          ) : (
            <>합계 <span className="money">{krw(group.total)}</span> (부채 제외, 포트폴리오 현금 {group.cashTraitId ? `→ ${group.traits.find((t) => t.id === group.cashTraitId)?.name}` : '→ 미지정'}).</>
          )}{' '}
          금액 기준 비중입니다. 한 분류에서 성질을 두 개 고른 종목은 반씩 나눠 셉니다.
        </p>
      </section>

      <section className="card">
        <div className="stack" style={{ gap: 4 }}>
          <h2>무엇을 살까 · 부족한 성질</h2>
          <p className="sub">
            {hasTargets
              ? '목표 비중보다 적은 성질과, 그 성질로 지정한 종목(관심종목 포함)입니다. 금액은 목표까지 채우려면 더 필요한 대략의 금액입니다.'
              : '목표 비중을 정하면 부족한 성질과 살 만한 종목이 여기에 나옵니다. ‘성질 · 목표 비중 편집’에서 정하세요.'}
          </p>
        </div>
        {hasTargets && !short.length && <p className="empty">모든 성질이 목표 비중 근처입니다.</p>}
        {short.map((s) => {
          const cands = data.assets.filter((a) => a.traitIds.includes(s.key));
          return (
            <div key={s.key} className="buy-row">
              <div className="inline" style={{ gap: 8 }}>
                <span className="dot" style={{ background: s.color }} />
                <span className="strong">{s.label}</span>
                <span className="badge warn">{pct(s.gap!, 1, false)}p 부족</span>
                <span className="sub">≈ {krwShort((s.gap! * group.total) / Math.max(0.01, 1 - s.target!))} 더 사면 목표</span>
              </div>
              {cands.length ? (
                <div className="inline" style={{ gap: 6 }}>
                  {cands.map((c) => (
                    <a key={c.id} className="chip-btn" href={`/journal/new?asset=${c.id}&format=builtin:buy`} title="매수 계획 일지 쓰기">
                      {c.name}
                      <span className="sub">{c.held ? krwShort(c.value) : '관심'}</span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="sub">이 성질로 지정한 종목이 없습니다. 아래 표에서 관심종목이나 보유 종목에 지정하세요.</p>
              )}
            </div>
          );
        })}
        {over.length > 0 && (
          <p className="sub">
            목표보다 많은 성질: {over.map((s) => `${s.label} ${pct(-s.gap!, 1, false)}p`).join(', ')} — 새로 사기보다 비중을 줄이거나 그대로 두는 쪽을 검토하세요.
          </p>
        )}
      </section>

      <section className="card">
        <div className="stack" style={{ gap: 4 }}>
          <h2>종목별 성질 지정 · {group.name}</h2>
          <p className="sub">칩을 눌러 켜고 끕니다. 성질은 분류마다 따로 지정합니다.</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">종목</th>
                <th scope="col">평가액</th>
                <th scope="col" className="l">성질</th>
              </tr>
            </thead>
            <tbody>
              {data.assets.map((a) => (
                <AssetRow key={a.id} asset={a} group={group} active={a.traitIds.filter((t) => traitIds.has(t))} />
              ))}
              {data.watch.map((w) => (
                <WatchRow key={w.symbol} symbol={w.symbol} name={w.name} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function AssetRow({ asset, group, active }: { asset: TraitOverview['assets'][number]; group: Group; active: string[] }) {
  const { pending, msg, act } = useAct();
  const [on, setOn] = useState(active);
  const toggle = (id: string) => {
    const next = on.includes(id) ? on.filter((x) => x !== id) : [...on, id];
    setOn(next);
    act(() => setAssetTraitsAction(asset.id, group.id, next));
  };
  return (
    <tr>
      <td>
        <span className="strong">{asset.name}</span>
        <span className="sub">{asset.symbol}</span>
      </td>
      <td className="money">{asset.held ? krwShort(asset.value) : <span className="sub">보유 안 함</span>}</td>
      <td className="l" style={{ whiteSpace: 'normal' }}>
        <div className="inline" style={{ gap: 4 }} aria-busy={pending}>
          {group.traits.map((t) => (
            <button key={t.id} type="button" className="trait-chip" aria-pressed={on.includes(t.id)} style={{ ['--c' as string]: t.color }} onClick={() => toggle(t.id)}>
              {t.name}
            </button>
          ))}
        </div>
        {msg.error && <span className="sub down">{msg.error}</span>}
      </td>
    </tr>
  );
}

function WatchRow({ symbol, name }: { symbol: string; name: string }) {
  const { pending, msg, act } = useAct();
  return (
    <tr>
      <td>
        <span className="strong">{name}</span>
        <span className="sub">{symbol} · 관심종목</span>
      </td>
      <td><span className="sub">—</span></td>
      <td className="l">
        <button type="button" className="btn small" disabled={pending} onClick={() => act(() => trackWatchAction(symbol))}>
          성질 지정하기
        </button>
        {msg.error && <span className="sub down">{msg.error}</span>}
      </td>
    </tr>
  );
}

function GroupEditor({ group, onSaved }: { group: Group; onSaved: () => void }) {
  const { pending, msg, act } = useAct();
  const [name, setName] = useState(group.name);
  const [cash, setCash] = useState(group.traits.find((t) => t.id === group.cashTraitId)?.name ?? '');
  const [base, setBase] = useState<string>(group.base);
  const [rows, setRows] = useState(
    group.traits.map((t) => ({ id: t.id as string | undefined, name: t.name, color: t.color, target: t.targetWeight === null ? '' : String(+(t.targetWeight * 100).toFixed(2)), description: t.description ?? '' })),
  );
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const sum = rows.reduce((a, r) => a + (Number(r.target) || 0), 0);
  return (
    <div className="card tight stack" style={{ gap: 10 }}>
      <label className="field">
        분류 이름
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {rows.map((r, i) => (
        <div key={r.id ?? `new-${i}`} className="trait-edit-row">
          <input type="color" aria-label="색" value={r.color} onChange={(e) => set(i, { color: e.target.value })} />
          <input aria-label="성질 이름" value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
          <span className="inline" style={{ flexWrap: 'nowrap', gap: 4 }}>
            <input aria-label="목표 비중 %" inputMode="decimal" placeholder="목표 %" value={r.target} onChange={(e) => set(i, { target: e.target.value.replace(/[^\d.]/g, '') })} style={{ width: 90 }} />
            <span className="muted">%</span>
          </span>
          <input aria-label="설명" placeholder="설명 (선택)" value={r.description} onChange={(e) => set(i, { description: e.target.value })} />
          <button type="button" className="btn small danger" aria-label="삭제" onClick={() => setRows(rows.filter((_, k) => k !== i))}>✕</button>
        </div>
      ))}
      <div className="inline">
        <button type="button" className="btn small" onClick={() => setRows([...rows, { id: undefined, name: '', color: '#2a78d6', target: '', description: '' }])}>+ 성질 추가</button>
        <span className={`sub ${sum > 100.0001 ? 'down' : ''}`}>목표 합계 {+sum.toFixed(2)}%{sum > 100.0001 ? ' — 100%를 넘을 수 없습니다' : ''}</span>
      </div>
      <label className="field" style={{ maxWidth: 420 }}>
        비중 기준
        <select value={base} onChange={(e) => setBase(e.target.value)}>
          <option value="all">전체 자산 대비 (지정 안 한 종목·현금은 미지정으로)</option>
          <option value="tagged">이 분류를 지정한 종목끼리 (예: 주식 스타일은 주식끼리)</option>
        </select>
      </label>
      <label className="field" style={{ maxWidth: 320 }}>
        포트폴리오 현금은
        <select value={cash} onChange={(e) => setCash(e.target.value)}>
          <option value="">미지정으로 셈</option>
          {rows.filter((r) => r.name.trim()).map((r) => (
            <option key={r.id ?? r.name} value={r.name}>{r.name}(으)로 셈</option>
          ))}
        </select>
      </label>
      <Msg msg={msg} />
      <div>
        <button type="button" className="btn primary" disabled={pending} onClick={() => act(() => saveGroupAction(group.id, { name, cashTrait: cash, base, traits: rows }), onSaved)}>
          저장
        </button>
      </div>
    </div>
  );
}

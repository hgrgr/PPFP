'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import {
  createAlertAction,
  deleteAlertAction,
  markReadAction,
  rearmAlertAction,
  savePortfolioTargetsAction,
  testPushAction,
  type AlertResult,
} from '@/app/alert-actions';
import type { DriftReport } from '@/domain/alerts';
import { krwShort, money, pct } from '@/lib/format';

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<AlertResult>({});
  const act = (fn: () => Promise<AlertResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r);
      if (!r.error) {
        after?.();
        router.refresh();
      }
    });
  return { pending, msg, act };
}

function Msg({ msg }: { msg: AlertResult }) {
  if (!msg.error && !msg.ok) return null;
  return <p className={`msg ${msg.error ? 'err' : 'ok'}`} role={msg.error ? 'alert' : 'status'}>{msg.error ?? msg.ok}</p>;
}

// ── price alerts ────────────────────────────────────

export interface AssetChoice {
  id: string;
  name: string;
  symbol: string | null;
  currency: string;
}

export function AlertForm({ assets, prices }: { assets: AssetChoice[]; prices: Record<string, string | null> }) {
  const { pending, msg, act } = useAct();
  const [assetId, setAssetId] = useState('');
  const [price, setPrice] = useState('');
  const [direction, setDirection] = useState('');
  const [note, setNote] = useState('');
  const asset = assets.find((a) => a.id === assetId);
  const cur = assetId ? prices[assetId] : null;
  const auto = cur && price ? (Number(price) >= Number(cur) ? '오르면' : '내리면') : null;
  return (
    <form
      className="grid"
      onSubmit={(e) => {
        e.preventDefault();
        act(() => createAlertAction({ assetId, price, direction, note }), () => {
          setPrice('');
          setNote('');
        });
      }}
    >
      <label className="field">
        종목
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} required>
          <option value="">종목 고르기</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.name}{a.symbol ? ` (${a.symbol})` : ''}</option>
          ))}
        </select>
      </label>
      <label className="field">
        알림 가격 {asset && <span className="sub">({asset.currency}{cur ? ` · 현재 ${money(cur, asset.currency)}` : ''})</span>}
        <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} placeholder="예: 80000" required />
      </label>
      <label className="field">
        언제
        <select value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="">{auto ? `자동: 지금보다 ${auto} (가격에 닿으면)` : '자동 (현재가 기준)'}</option>
          <option value="ABOVE">이 가격 이상이 되면</option>
          <option value="BELOW">이 가격 이하가 되면</option>
        </select>
      </label>
      <label className="field">
        메모 (선택)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 분할 매수 2차" maxLength={200} />
      </label>
      <button className="btn primary" type="submit" disabled={pending}>알림 만들기</button>
      <div className="full"><Msg msg={msg} /></div>
    </form>
  );
}

export function AlertRowActions({ id, active }: { id: string; active: boolean }) {
  const { pending, msg, act } = useAct();
  return (
    <span className="inline" style={{ gap: 4, flexWrap: 'nowrap' }}>
      {!active && <button type="button" className="btn small" disabled={pending} onClick={() => act(() => rearmAlertAction(id))}>다시 켜기</button>}
      <button type="button" className="btn small danger" disabled={pending} onClick={() => confirm('이 알림을 지울까요?') && act(() => deleteAlertAction(id))}>지우기</button>
      {msg.error && <span className="sub down">{msg.error}</span>}
    </span>
  );
}

export function MarkReadButton() {
  const { pending, act } = useAct();
  return <button type="button" className="btn small" disabled={pending} onClick={() => act(() => markReadAction())}>모두 읽음</button>;
}

// ── Web Push ────────────────────────────────────────

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type PushState = 'loading' | 'unsupported' | 'insecure' | 'ios-install' | 'denied' | 'off' | 'on';

/** Turn push notifications on or off for this browser or phone. */
export function PushSettings({ devices }: { devices: number }) {
  const { pending, msg, act } = useAct();
  const [state, setState] = useState<PushState>('loading');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      if (!window.isSecureContext) return setState('insecure');
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return setState(ios && !standalone ? 'ios-install' : 'unsupported');
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off');
      } catch {
        setState('unsupported');
      }
    })();
  }, []);

  const enable = async () => {
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return setState('denied');
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await (await fetch('/api/push/key')).json();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '저장하지 못했습니다.');
      setState('on');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '알림을 켜지 못했습니다.');
    }
  };
  const disable = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/push/subscribe', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState('off');
    router.refresh();
  };

  const text: Record<PushState, string> = {
    loading: '확인 중…',
    unsupported: '이 브라우저는 푸시 알림을 지원하지 않습니다. 알림은 이 앱의 알림함에서 볼 수 있습니다.',
    insecure: '푸시 알림은 HTTPS로 접속했을 때만 켤 수 있습니다(내 컴퓨터의 localhost는 예외).',
    'ios-install': '아이폰·아이패드는 Safari 공유 메뉴의 ‘홈 화면에 추가’로 앱을 설치한 뒤, 설치한 앱에서 켤 수 있습니다(iOS 16.4 이상).',
    denied: '이 브라우저에서 알림이 차단돼 있습니다. 브라우저 설정의 사이트 권한에서 알림을 허용한 뒤 다시 시도하세요.',
    off: '이 기기에서 아직 푸시 알림을 받지 않습니다.',
    on: '이 기기에서 푸시 알림을 받습니다.',
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="inline" style={{ gap: 8 }}>
        <span className={`badge ${state === 'on' ? 'ok' : ''}`}>{state === 'on' ? '켜짐' : state === 'loading' ? '…' : '꺼짐'}</span>
        <span className="sub" style={{ color: 'var(--ink-2)' }}>{text[state]}</span>
      </p>
      <div className="inline" style={{ gap: 6 }}>
        {(state === 'off' || state === 'denied') && <button type="button" className="btn primary small" onClick={() => void enable()}>이 기기에서 알림 받기</button>}
        {state === 'on' && <button type="button" className="btn small" onClick={() => void disable()}>이 기기 알림 끄기</button>}
        <button type="button" className="btn small" disabled={pending || !devices} onClick={() => act(() => testPushAction())}>테스트 알림 보내기</button>
        <span className="sub">알림 받는 기기 {devices}대</span>
      </div>
      {error && <p className="msg err">{error}</p>}
      <Msg msg={msg} />
    </div>
  );
}

// ── portfolio target weights ────────────────────────

/** Target weight per part of a portfolio, with the drift band and the notification switch. */
export function PortfolioTargets({ portfolioId, report, tolerance, alert }: { portfolioId: string; report: DriftReport; tolerance: number; alert: boolean }) {
  const { pending, msg, act } = useAct();
  const [targets, setTargets] = useState<Record<string, string>>(() => Object.fromEntries(report.rows.map((r) => [r.key, r.target === null ? '' : String(+(r.target * 100).toFixed(2))])));
  const [tol, setTol] = useState(String(+(tolerance * 100).toFixed(2)));
  const [on, setOn] = useState(alert);
  const sum = Object.values(targets).reduce((a, v) => a + (Number(v) || 0), 0);
  const band = (Number(tol) || 0) / 100;
  const total = report.total;
  const kind = (key: string) => (key === 'CASH' ? '현금' : key.startsWith('P:') ? '하위 포트폴리오' : '종목');

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">구성</th>
              <th scope="col">평가액</th>
              <th scope="col">지금</th>
              <th scope="col">목표</th>
              <th scope="col">차이</th>
              <th scope="col">목표대로 맞추려면</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => {
              const t = targets[r.key] === '' || targets[r.key] === undefined ? null : Number(targets[r.key]) / 100;
              const diff = t === null ? null : r.share - t;
              const out = diff !== null && total > 0 && Math.abs(diff) > band + 1e-12;
              const trade = t === null ? null : t * total - r.value;
              return (
                <tr key={r.key} className={out ? 'drift-out' : undefined}>
                  <td>
                    <span className="strong">{r.label}</span>
                    <span className="sub">{kind(r.key)}</span>
                  </td>
                  <td className="money">{krwShort(r.value)}</td>
                  <td className="strong">{pct(r.share, 1, false)}</td>
                  <td>
                    <span className="inline" style={{ flexWrap: 'nowrap', gap: 4, justifyContent: 'flex-end' }}>
                      <input
                        aria-label={`${r.label} 목표 비중 %`}
                        inputMode="decimal"
                        value={targets[r.key] ?? ''}
                        placeholder="—"
                        onChange={(e) => setTargets({ ...targets, [r.key]: e.target.value.replace(/[^\d.]/g, '') })}
                        style={{ width: 76, textAlign: 'right' }}
                      />
                      <span className="muted">%</span>
                    </span>
                  </td>
                  <td>
                    {diff === null ? (
                      <span className="muted">—</span>
                    ) : out ? (
                      <span className="badge warn">{diff > 0 ? '+' : '−'}{pct(Math.abs(diff), 1, false)}p</span>
                    ) : (
                      <span className="sub">{diff > 0 ? '+' : diff < 0 ? '−' : ''}{pct(Math.abs(diff), 1, false)}p</span>
                    )}
                  </td>
                  <td className="money">{trade === null || Math.abs(trade) < 1 ? <span className="muted">—</span> : <span className={trade > 0 ? 'up' : 'down'}>{r.key === 'CASH' ? (trade > 0 ? '현금 늘리기 ' : '현금 쓰기 ') : trade > 0 ? '사기 ' : '팔기 '}{krwShort(Math.abs(trade))}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="inline" style={{ gap: 16, alignItems: 'flex-end' }}>
        <span className={`sub ${sum > 100.0001 ? 'down' : ''}`}>목표 합계 {+sum.toFixed(2)}%{sum > 100.0001 ? ' — 100%를 넘을 수 없습니다' : sum > 0 && sum < 99.9999 ? ' (나머지는 목표 없음)' : ''}</span>
        <label className="field" style={{ maxWidth: 200 }}>
          허용 오차 (±%p)
          <input inputMode="decimal" value={tol} onChange={(e) => setTol(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
        <label className="inline" style={{ gap: 6 }}>
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          벗어나면 알림 받기
        </label>
        <button type="button" className="btn primary" disabled={pending} onClick={() => act(() => savePortfolioTargetsAction(portfolioId, { targets, tolerance: tol, alert: on }))}>
          저장
        </button>
      </div>
      <p className="sub">
        목표와 지금 비중의 차이가 허용 오차보다 크면(예: 목표 40%, 오차 5%p → 35% 미만이나 45% 초과) 알림을 보냅니다. 같은 항목은 범위 안으로 돌아왔다가 다시 벗어날 때 다시 알립니다. 비중은 지금 시세로 약 10분마다 확인합니다.
      </p>
      <Msg msg={msg} />
    </div>
  );
}

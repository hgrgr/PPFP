'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Confetti, FunToggle, useFun } from '@/components/fun';

export interface BasketItem {
  id: string;
  name: string;
  type: string;
  value: number;
  /** unrealized return, fraction */
  ret: number | null;
  portfolioId: string;
}
export interface BasketData {
  baskets: { id: string; name: string; color: string }[];
  virtual: { id: string; name: string }[];
  items: BasketItem[];
}

const ICON: Record<string, string> = { KR_STOCK: '📈', US_STOCK: '🗽', FUND: '🧺', BOND: '📜', CRYPTO: '🪙', CASH: '💵', REAL_ESTATE: '🏠', ALTERNATIVE: '🥇', LIABILITY: '🧾' };
const face = (r: number | null) => (r === null ? '🙂' : r >= 0.2 ? '😄' : r >= 0.03 ? '😊' : r > -0.03 ? '😐' : r > -0.2 ? '😟' : '😱');
const won = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(v >= 1e9 ? 1 : 2)}억` : v >= 1e4 ? `${Math.round(v / 1e4).toLocaleString('ko-KR')}만` : `${Math.round(v).toLocaleString('ko-KR')}`);

/** Item diameter from its value: area ∝ value, between 44 and 132 px */
const sizeOf = (v: number, max: number) => Math.round(44 + 88 * Math.sqrt(Math.max(0, v) / (max || 1)));

interface Drag {
  item: BasketItem;
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;
  over: string | null;
}

export function Basket({ data }: { data: BasketData }) {
  const router = useRouter();
  const [fun] = useFun();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [wobble, setWobble] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const [party, setParty] = useState(false);
  const max = Math.max(...data.items.map((i) => i.value), 1);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  // A short message that fades on its own
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const basketAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-basket]') as HTMLElement | null;
    return el?.dataset.basket ?? null;
  };

  const start = (e: React.PointerEvent, item: BasketItem) => {
    if (busy) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Some pointers cannot be captured; moves still reach the wrapper by bubbling
    }
    setDrag({ item, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, size: r.width, over: null });
  };
  const move = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setDrag({ ...d, x: e.clientX, y: e.clientY, over: basketAt(e.clientX, e.clientY) });
  };
  const end = async (e: React.PointerEvent) => {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    const to = basketAt(e.clientX, e.clientY);
    if (!to || to === d.item.portfolioId) return;
    const virtual = to.startsWith('v:');
    const target = virtual ? data.virtual.find((v) => `v:${v.id}` === to)?.name : data.baskets.find((b) => b.id === to)?.name;
    const ok = window.confirm(
      virtual
        ? `${d.item.name}(${won(d.item.value)}원)을 가상 포트폴리오 '${target}'에 오늘 가격으로 담을까요?\n실제 자산은 그대로 두고, 연습용으로 복사만 합니다.`
        : `${d.item.name}을(를) '${target}' 바구니로 옮길까요?\n실제로 옮겨집니다. 거래 기록과 Lot이 함께 옮겨 가 처음부터 그 포트폴리오에서 산 것처럼 되고, 두 포트폴리오의 현금은 그대로 둡니다.`,
    );
    if (!ok) return;
    setBusy(d.item.id);
    const res = await fetch('/api/basket', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ holdingId: d.item.id, to }) });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setToast({ text: j.error ?? '담지 못했습니다.', bad: true });
    setToast({ text: j.message ?? '담았습니다.' });
    setWobble(to);
    setLanded(d.item.id);
    if (virtual) setParty(true);
    setTimeout(() => setWobble(null), 900);
    setTimeout(() => setLanded(null), 1400);
    router.refresh();
  };

  if (!fun) {
    return (
      <section className="card stack" style={{ gap: 10 }}>
        <h3>놀이 모드가 꺼져 있습니다</h3>
        <p className="sub">바구니 담기는 놀이 모드에서 쓰는 화면입니다. 켜면 내 종목이 금액만큼 커다란 물건이 되어, 끌어다 포트폴리오 바구니에 담을 수 있습니다. 놀이 모드는 이 브라우저에만 저장되고 언제든 끌 수 있습니다.</p>
        <FunToggle label="놀이 모드 켜기" />
      </section>
    );
  }

  const total = (pid: string) => data.items.filter((i) => i.portfolioId === pid).reduce((a, i) => a + i.value, 0);
  return (
    <div className="stack" style={{ gap: 16 }} onPointerMove={move} onPointerUp={end}>
      {party && <Confetti pieces={60} onDone={() => setParty(false)} />}
      <section className="card stack" style={{ gap: 8 }}>
        <div className="inline spread" style={{ gap: 8 }}>
          <span className="sub">물건 크기는 평가액, 표정은 수익률(😄 +20% 넘음 · 😊 · 😐 · 😟 · 😱 −20% 밑)입니다. 물건을 끌어 다른 바구니에 떨어뜨리세요. 실제 바구니로 옮기면 정말로 옮겨지고(확인 후), 점선의 가상 바구니에 넣으면 연습용으로 복사됩니다.</span>
          <FunToggle />
        </div>
      </section>
      <div className="basket-grid">
        {data.baskets.map((b) => (
          <BasketBox key={b.id} id={b.id} name={b.name} color={b.color} total={total(b.id)} over={drag?.over === b.id && drag.item.portfolioId !== b.id} wobble={wobble === b.id}>
            {data.items.filter((i) => i.portfolioId === b.id).sort((a, c) => c.value - a.value).map((i) => (
              <Thing key={i.id} item={i} size={sizeOf(i.value, max)} dragging={drag?.item.id === i.id} busy={busy === i.id} landed={landed === i.id} onDown={start} />
            ))}
          </BasketBox>
        ))}
        {data.virtual.map((v) => (
          <BasketBox key={v.id} id={`v:${v.id}`} name={v.name} color="var(--muted)" virtual over={drag?.over === `v:${v.id}`} wobble={wobble === `v:${v.id}`}>
            <p className="sub" style={{ textAlign: 'center', width: '100%' }}>여기 떨어뜨리면 오늘 가격으로 복사 🫧</p>
          </BasketBox>
        ))}
      </div>
      {drag && (
        <div className="thing thing-ghost" style={{ width: drag.size, height: drag.size, left: drag.x - drag.dx, top: drag.y - drag.dy }}>
          <span className="thing-icon">{ICON[drag.item.type] ?? '📦'}</span>
          <span className="thing-face">{face(drag.item.ret)}</span>
        </div>
      )}
      {toast && (
        <div className={`fun-toast ${toast.bad ? 'bad' : ''}`} role="status">
          {toast.bad ? '⚠️ ' : '🧺 '}
          {toast.text}
        </div>
      )}
    </div>
  );
}

function BasketBox({ id, name, color, total, virtual, over, wobble, children }: { id: string; name: string; color: string; total?: number; virtual?: boolean; over: boolean; wobble: boolean; children: React.ReactNode }) {
  return (
    <section data-basket={id} className={`basket ${virtual ? 'virtual' : ''} ${over ? 'over' : ''} ${wobble ? 'wobble' : ''}`} aria-label={`${name} 바구니`}>
      <div className="basket-items">{children}</div>
      <div className="basket-body" style={{ ['--basket' as string]: color }}>
        <svg viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
          <path d="M6 4 H194 L178 56 H22 Z" className="basket-shape" />
          {[30, 60, 90, 120, 150, 170].map((x) => (
            <line key={x} x1={x} y1="6" x2={x - 6 + (x - 100) * 0.05} y2="54" className="basket-weave" />
          ))}
          <line x1="12" y1="22" x2="188" y2="22" className="basket-weave" />
          <line x1="16" y1="38" x2="184" y2="38" className="basket-weave" />
        </svg>
        <div className="basket-label">
          {virtual && <span className="badge">가상</span>} <b>{name}</b>
          {total !== undefined && <span className="sub"> · {won(total)}원</span>}
        </div>
      </div>
    </section>
  );
}

function Thing({ item, size, dragging, busy, landed, onDown }: { item: BasketItem; size: number; dragging: boolean; busy: boolean; landed: boolean; onDown: (e: React.PointerEvent, i: BasketItem) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  // Each thing bobs at its own pace
  useLayoutEffect(() => {
    ref.current?.style.setProperty('--bob', `${2.4 + (item.id.charCodeAt(0) % 7) * 0.3}s`);
  }, [item.id]);
  return (
    <button
      ref={ref}
      type="button"
      className={`thing ${dragging ? 'lifted' : ''} ${busy ? 'busy' : ''} ${landed ? 'landed' : ''}`}
      style={{ width: size, height: size }}
      onPointerDown={(e) => onDown(e, item)}
      title={`${item.name} · ${won(item.value)}원${item.ret !== null ? ` · ${item.ret >= 0 ? '+' : ''}${(item.ret * 100).toFixed(1)}%` : ''}`}
      aria-label={`${item.name}, ${won(item.value)}원. 끌어서 다른 바구니로`}
    >
      <span className="thing-icon" style={{ fontSize: size * 0.32 }}>{ICON[item.type] ?? '📦'}</span>
      <span className="thing-face" style={{ fontSize: Math.max(12, size * 0.2) }}>{face(item.ret)}</span>
      {size >= 64 && <span className="thing-name">{item.name}</span>}
      {size >= 84 && <span className="thing-value">{won(item.value)}</span>}
    </button>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
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
  virtual: { id: string; name: string; items: { id: string; name: string; type: string; value: number }[] }[];
  items: BasketItem[];
}

const ICON: Record<string, string> = { KR_STOCK: '📈', US_STOCK: '🗽', FUND: '🧺', BOND: '📜', CRYPTO: '🪙', CASH: '💵', REAL_ESTATE: '🏠', ALTERNATIVE: '🥇', LIABILITY: '🧾' };
/** Pastel skin and outline per asset type */
const SKIN: Record<string, [string, string]> = {
  KR_STOCK: ['#ffd6e0', '#ef9cb2'],
  US_STOCK: ['#d3e6ff', '#8fb6ec'],
  FUND: ['#d8f2cc', '#95cd80'],
  BOND: ['#fff1bd', '#e5c65a'],
  CRYPTO: ['#ffdfb3', '#efab58'],
  CASH: ['#ccf2e3', '#7ccdab'],
  REAL_ESTATE: ['#e6dbff', '#a993e8'],
  ALTERNATIVE: ['#f6e5c4', '#d6ad69'],
};
const skinOf = (type: string) => SKIN[type] ?? ['#eceff3', '#b8bec8'];

type Mood = 'great' | 'good' | 'meh' | 'sad' | 'awful' | 'wow';
const moodOf = (r: number | null): Mood => (r === null ? 'good' : r >= 0.2 ? 'great' : r >= 0.03 ? 'good' : r > -0.03 ? 'meh' : r > -0.2 ? 'sad' : 'awful');
const won = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(v >= 1e9 ? 1 : 2)}억` : v >= 1e4 ? `${Math.round(v / 1e4).toLocaleString('ko-KR')}만` : `${Math.round(v).toLocaleString('ko-KR')}`);
const pct = (r: number | null) => (r === null ? '' : `${r >= 0 ? '+' : ''}${(r * 100).toFixed(1)}%`);

/**
 * Item diameter from its value, 62 to 136 px. A power below ½ keeps small holdings recognizable
 * next to a house worth a hundred times more; bigger is still always bigger.
 */
const sizeOf = (v: number, max: number) => Math.round(62 + 74 * (Math.max(0, v) / (max || 1)) ** 0.35);

/** A soft round mochi with a face that follows the return */
export function Mochi({ type, mood, size, blink = 0 }: { type: string; mood: Mood; size: number; blink?: number }) {
  const [skin, line] = skinOf(type);
  const ink = '#4a3b47';
  return (
    <svg className="mochi" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <ellipse cx="50" cy="95" rx="34" ry="4" fill="#000" opacity=".08" />
      <path d="M50 10C79 10 95 33 95 60C95 83 76 94 50 94S5 83 5 60C5 33 21 10 50 10Z" fill={skin} stroke={line} strokeWidth="2.5" />
      <ellipse cx="33" cy="28" rx="11" ry="7" fill="#fff" opacity=".65" transform="rotate(-20 33 28)" />
      <circle cx="24" cy="38" r="2.5" fill="#fff" opacity=".8" />
      <ellipse cx="27" cy="66" rx="7" ry="4.5" fill="#ff8fab" opacity={mood === 'awful' ? 0.25 : 0.45} />
      <ellipse cx="73" cy="66" rx="7" ry="4.5" fill="#ff8fab" opacity={mood === 'awful' ? 0.25 : 0.45} />
      <g className="mochi-eyes" style={{ animationDelay: `${blink}s` }} stroke={ink} strokeWidth="3.2" strokeLinecap="round" fill="none">
        {mood === 'great' ? (
          <>
            <path d="M31 57Q37 49 43 57" />
            <path d="M57 57Q63 49 69 57" />
          </>
        ) : mood === 'awful' ? (
          <>
            <path d="M31 51L40 56L31 61" />
            <path d="M69 51L60 56L69 61" />
          </>
        ) : (
          <>
            <circle cx="37" cy="56" r="3.8" fill={ink} stroke="none" />
            <circle cx="63" cy="56" r="3.8" fill={ink} stroke="none" />
            <circle cx="38.4" cy="54.6" r="1.3" fill="#fff" stroke="none" />
            <circle cx="64.4" cy="54.6" r="1.3" fill="#fff" stroke="none" />
          </>
        )}
      </g>
      <g stroke={ink} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {mood === 'great' && <path d="M43 65Q50 75 57 65Z" fill="#e8607a" />}
        {mood === 'good' && <path d="M45 65Q50 70 55 65" />}
        {mood === 'meh' && <path d="M46 67H54" />}
        {mood === 'sad' && <path d="M45 69Q50 64 55 69" />}
        {mood === 'awful' && <path d="M42 69q2-3 4-0t4 0t4 0t4 0" />}
        {mood === 'wow' && <ellipse cx="50" cy="67" rx="3.6" ry="4.4" fill="#e8607a" />}
      </g>
      {mood === 'great' && <path className="mochi-spark" d="M84 18l2.2 5.8 5.8 2.2-5.8 2.2L84 34l-2.2-5.8-5.8-2.2 5.8-2.2Z" fill="#ffd34d" />}
      {mood === 'sad' && <path d="M80 36q-4 6 0 8q4-2 0-8Z" fill="#8ec5ff" />}
      {mood === 'awful' && (
        <>
          <path d="M33 63q-3 6 0 8q3-2 0-8Z" fill="#8ec5ff" />
          <path d="M67 63q-3 6 0 8q3-2 0-8Z" fill="#8ec5ff" />
        </>
      )}
    </svg>
  );
}

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
    const d = { item, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, size: r.width, over: null };
    // The ref goes first: a move or drop can arrive before React renders
    dragRef.current = d;
    setDrag(d);
  };
  const move = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const next = { ...d, x: e.clientX, y: e.clientY, over: basketAt(e.clientX, e.clientY) };
    dragRef.current = next;
    setDrag(next);
  };
  const end = async (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
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
    if (!res.ok) return setToast({ text: j.error ?? '담지 못했어요.', bad: true });
    setToast({ text: j.message ?? '담았어요.' });
    setWobble(to);
    setLanded(d.item.id);
    if (virtual) setParty(true);
    setTimeout(() => setWobble(null), 900);
    setTimeout(() => setLanded(null), 1400);
    router.refresh();
  };

  if (!fun) {
    return (
      <section className="picnic picnic-off">
        <div className="picnic-legend" aria-hidden="true">
          {(['great', 'good', 'meh', 'sad'] as Mood[]).map((m, i) => (
            <span key={m} className="legend-mochi" style={{ animationDelay: `${i * 0.25}s` }}>
              <Mochi type={['KR_STOCK', 'US_STOCK', 'FUND', 'REAL_ESTATE'][i]} mood={m} size={56} blink={i} />
            </span>
          ))}
        </div>
        <h3 className="cute">놀이 모드가 쉬는 중이에요 💤</h3>
        <p className="sub">켜면 내 종목이 금액만큼 커다란 말랑이가 되어, 끌어다 포트폴리오 바구니에 쏙 담을 수 있어요. 이 브라우저에만 저장되고 언제든 끌 수 있어요.</p>
        <FunToggle label="놀이 모드 켜기" />
      </section>
    );
  }

  const total = (pid: string) => data.items.filter((i) => i.portfolioId === pid).reduce((a, i) => a + i.value, 0);
  const count = (pid: string) => data.items.filter((i) => i.portfolioId === pid).length;
  return (
    <div className="stack" style={{ gap: 16 }} onPointerMove={move} onPointerUp={end}>
      {party && <Confetti pieces={70} onDone={() => setParty(false)} />}
      <section className="picnic-hint">
        <div className="picnic-legend" aria-label="표정은 수익률">
          {([['great', '+20% 넘게'], ['good', '+3%'], ['meh', '제자리'], ['sad', '−3%'], ['awful', '−20% 밑']] as [Mood, string][]).map(([m, t], i) => (
            <span key={m} className="legend-item">
              <Mochi type="FUND" mood={m} size={34} blink={i * 0.7} />
              <small>{t}</small>
            </span>
          ))}
        </div>
        <p className="cute-sub">
          말랑이 크기는 평가액, 표정은 수익률이에요. 끌어서 다른 바구니에 쏙! 실제 바구니로 옮기면 <b>정말로 옮겨지고</b>(확인 후), 반짝이는 <b>꿈 바구니</b>에 넣으면 연습용으로 복사돼요.
        </p>
        <FunToggle />
      </section>
      <div className="picnic">
        <div className="basket-grid">
          {data.baskets.map((b) => (
            <BasketBox key={b.id} id={b.id} name={b.name} color={b.color} total={total(b.id)} count={count(b.id)} over={drag?.over === b.id && drag.item.portfolioId !== b.id} wobble={wobble === b.id}>
              {data.items
                .filter((i) => i.portfolioId === b.id)
                .sort((a, c) => c.value - a.value)
                .map((i, n) => (
                  <Thing key={i.id} item={i} size={sizeOf(i.value, max)} n={n} dragging={drag?.item.id === i.id} busy={busy === i.id} landed={landed === i.id} onDown={start} />
                ))}
            </BasketBox>
          ))}
          {data.virtual.map((v) => (
            <BasketBox key={v.id} id={`v:${v.id}`} name={v.name} color="#b9a4f2" count={v.items.length} virtual over={drag?.over === `v:${v.id}`} wobble={wobble === `v:${v.id}`}>
              {v.items.map((p, n) => (
                <span key={p.id} className="thing dream" style={{ width: sizeOf(p.value, max) * 0.8, ['--bob' as string]: `${2.8 + (n % 5) * 0.35}s` }} tabIndex={0} aria-label={`${p.name} (가상)`}>
                  <span className="thing-bubble">
                    <b>{p.name}</b> {p.value > 0 ? `${won(p.value)}원 담음` : '가상'}
                  </span>
                  <Mochi type={p.type} mood="good" size={sizeOf(p.value, max) * 0.8} blink={n * 0.8} />
                </span>
              ))}
              {!v.items.length && <span className="dream-hint">여기 넣으면 오늘 가격으로 복사돼요 ✨</span>}
            </BasketBox>
          ))}
        </div>
      </div>
      {drag && (
        <div className="thing-ghost" style={{ width: drag.size, left: drag.x - drag.dx, top: drag.y - drag.dy }}>
          <span className="thing-bubble">{drag.over && drag.over !== drag.item.portfolioId ? '여기 쏙! 💕' : `${drag.item.name} 어디로 갈까요?`}</span>
          <Mochi type={drag.item.type} mood="wow" size={drag.size} />
          <span className="thing-badge" style={{ fontSize: drag.size * 0.22 }}>{ICON[drag.item.type] ?? '📦'}</span>
        </div>
      )}
      {toast && (
        <div className={`fun-toast ${toast.bad ? 'bad' : ''}`} role="status">
          {toast.bad ? '😵 ' : '🧺 '}
          {toast.text}
        </div>
      )}
    </div>
  );
}

function BasketBox({ id, name, color, total, count, virtual, over, wobble, children }: { id: string; name: string; color: string; total?: number; count?: number; virtual?: boolean; over: boolean; wobble: boolean; children: React.ReactNode }) {
  const pat = `gingham-${id.replace(/[^a-z0-9]/gi, '')}`;
  const empty = !virtual && !count;
  return (
    <section data-basket={id} className={`basket ${virtual ? 'virtual' : ''} ${over ? 'over' : ''} ${wobble ? 'wobble' : ''}`} style={{ ['--cloth' as string]: color }} aria-label={`${name} 바구니`}>
      <div className="basket-stage">
        <svg className="basket-handle" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M8 100V60C8 18 92 18 92 60V100" vectorEffect="non-scaling-stroke" className="handle-base" />
          <path d="M8 100V60C8 18 92 18 92 60V100" vectorEffect="non-scaling-stroke" className="handle-wrap" />
        </svg>
        <div className="basket-items">
          {children}
          {empty && <span className="basket-empty">텅~ 비었어요</span>}
        </div>
        <div className="basket-front">
          <svg viewBox="0 0 300 96" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <pattern id={pat} width="16" height="16" patternUnits="userSpaceOnUse">
                <rect width="16" height="16" fill="#fff" />
                <rect width="8" height="16" fill={color} opacity=".45" />
                <rect width="16" height="8" fill={color} opacity=".45" />
              </pattern>
            </defs>
            <path d="M16 26H284L264 88Q262 94 254 94H46Q38 94 36 88Z" className="basket-body" />
            {[44, 58, 72, 86].map((y, i) => (
              <line key={y} x1={30 + (y - 26) * 0.3} y1={y} x2={270 - (y - 26) * 0.3} y2={y} className="basket-weave" strokeDashoffset={i % 2 ? 10 : 0} />
            ))}
            <path d={`M10 22${Array.from({ length: 14 }, () => 'a10 12 0 0 0 20 0').join('')}V14H10Z`} fill={`url(#${pat})`} className="basket-cloth" />
            <rect x="4" y="8" width="292" height="15" rx="7.5" className="basket-rim" />
          </svg>
          <div className="basket-tag">
            <b>
              {virtual && '✨ '}
              {name}
            </b>
            <span>{virtual ? `꿈 바구니 · 가상${count ? ` ${count}개` : ''}` : `${count}개 · ${won(total ?? 0)}원`}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Thing({ item, size, n, dragging, busy, landed, onDown }: { item: BasketItem; size: number; n: number; dragging: boolean; busy: boolean; landed: boolean; onDown: (e: React.PointerEvent, i: BasketItem) => void }) {
  // Each mochi bobs and blinks at its own pace
  const seed = (item.id.charCodeAt(0) + item.id.charCodeAt(item.id.length - 1) + n * 3) % 7;
  return (
    <button
      type="button"
      className={`thing ${dragging ? 'lifted' : ''} ${busy ? 'busy' : ''} ${landed ? 'landed' : ''}`}
      style={{ width: size, ['--bob' as string]: `${2.6 + seed * 0.3}s`, ['--tilt' as string]: `${(seed - 3) * 1.5}deg` }}
      onPointerDown={(e) => onDown(e, item)}
      aria-label={`${item.name}, ${won(item.value)}원${item.ret !== null ? `, ${pct(item.ret)}` : ''}. 끌어서 다른 바구니로`}
    >
      <span className="thing-bubble">
        <b>{item.name}</b> {won(item.value)}원 {item.ret !== null && <span className={item.ret >= 0 ? 'up' : 'down'}>{pct(item.ret)}</span>}
      </span>
      <Mochi type={item.type} mood={moodOf(item.ret)} size={size} blink={seed * 0.6} />
      <span className="thing-badge" style={{ fontSize: Math.max(13, size * 0.22) }}>{ICON[item.type] ?? '📦'}</span>
    </button>
  );
}

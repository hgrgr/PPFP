'use client';

import { useEffect, useState } from 'react';

/**
 * 놀이 모드: playful extras (the 바구니 담기 screen, celebrations) that each viewer turns on or off
 * in this browser. Purely front-end: nothing is stored on the server.
 */
const KEY = 'ppfp:fun';
const EVENT = 'ppfp:fun';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setFun(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // storage blocked: the switch only lasts for this page
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

/** Whether 놀이 모드 is on, following changes made anywhere on the page or in other tabs */
export function useFun(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(read());
    const local = (e: Event) => setOn(Boolean((e as CustomEvent<boolean>).detail));
    const other = (e: StorageEvent) => e.key === KEY && setOn(e.newValue === '1');
    window.addEventListener(EVENT, local);
    window.addEventListener('storage', other);
    return () => {
      window.removeEventListener(EVENT, local);
      window.removeEventListener('storage', other);
    };
  }, []);
  return [on, setFun];
}

export function FunToggle({ label = '놀이 모드' }: { label?: string }) {
  const [on, set] = useFun();
  return (
    <label className="check fun-toggle">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> {label} {on ? '🎈' : ''}
    </label>
  );
}

/** A link shown only while 놀이 모드 is on */
export function FunLink({ href, children, className = 'btn' }: { href: string; children: React.ReactNode; className?: string }) {
  const [on] = useFun();
  if (!on) return null;
  return (
    <a className={`${className} fun-link`} href={href}>
      {children}
    </a>
  );
}

const COLORS = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ff924c'];

/** A burst of confetti (CSS only), removed after it falls */
export function Confetti({ pieces = 90, onDone }: { pieces?: number; onDone?: () => void }) {
  const [bits] = useState(() =>
    Array.from({ length: pieces }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      dur: 2.2 + Math.random() * 1.6,
      rot: Math.random() * 720 - 360,
      drift: Math.random() * 160 - 80,
      color: COLORS[i % COLORS.length],
      w: 6 + Math.random() * 6,
      round: Math.random() < 0.3,
    })),
  );
  useEffect(() => {
    const t = setTimeout(() => onDone?.(), 4200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <span
          key={i}
          style={{
            left: `${b.left}%`,
            width: b.w,
            height: b.round ? b.w : b.w * 0.45,
            borderRadius: b.round ? '50%' : 2,
            background: b.color,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.dur}s`,
            ['--rot' as string]: `${b.rot}deg`,
            ['--drift' as string]: `${b.drift}px`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * On the dashboard: when the value on the last day is the highest of the period, throw confetti
 * once a day per scope (놀이 모드 only).
 */
export function NewHighCelebration({ scope, values }: { scope: string; values: number[] }) {
  const [on] = useFun();
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState(false);
  useEffect(() => {
    if (!on || values.length < 20) return;
    const last = values.at(-1)!;
    if (!(last > 0) || last < Math.max(...values)) return;
    const key = `ppfp:fun:high:${scope}`;
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (localStorage.getItem(key) === today) return;
      localStorage.setItem(key, today);
    } catch {
      return;
    }
    setShow(true);
    setMsg(true);
    const t = setTimeout(() => setMsg(false), 5000);
    return () => clearTimeout(t);
  }, [on, scope, values]);
  return (
    <>
      {show && <Confetti onDone={() => setShow(false)} />}
      {msg && (
        <div className="fun-toast" role="status">
          🎉 기간 최고 평가액이에요!
        </div>
      )}
    </>
  );
}

/** Today's move as weather, next to the dashboard title (놀이 모드 only) */
export function FunWeather({ ret }: { ret: number | null }) {
  const [on] = useFun();
  if (!on || ret === null || !Number.isFinite(ret)) return null;
  const [icon, word] = ret >= 0.015 ? ['☀️', '맑음'] : ret >= 0.003 ? ['🌤️', '구름 조금'] : ret > -0.003 ? ['☁️', '흐림'] : ret > -0.015 ? ['🌧️', '비'] : ['⛈️', '폭풍우'];
  return (
    <span className="fun-weather" title={`직전 거래일 대비 ${(ret * 100).toFixed(2)}% (시간가중)`}>
      {icon} 오늘 날씨 {word} <span className="sub">{Math.abs(ret) < 0.00005 ? '0.00' : `${ret > 0 ? '+' : ''}${(ret * 100).toFixed(2)}`}%</span>
    </span>
  );
}

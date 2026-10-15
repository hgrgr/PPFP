'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Milliseconds per step at 1× */
const STEP_MS = 650;
const SPEEDS = [0.5, 1, 2, 4] as const;

export interface Timeline {
  /** Index of the frame shown */
  i: number;
  playing: boolean;
  speed: number;
  set: (i: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (s: number) => void;
}

/**
 * A frame index that steps forward on its own while playing, for charts that show how things
 * moved over time. Starts on the last frame (today); pressing play from there starts over.
 * Respects prefers-reduced-motion by not playing on its own.
 */
export function useTimeline(frames: number, opts: { start?: 'first' | 'last' } = {}): Timeline {
  const [i, setI] = useState(opts.start === 'first' ? 0 : Math.max(0, frames - 1));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const last = Math.max(0, frames - 1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => setI((x) => Math.min(x, last)), [last]);
  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setI((x) => {
        if (x >= last) {
          setPlaying(false);
          return x;
        }
        return x + 1;
      });
    }, STEP_MS / speed);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, speed, last]);
  const play = useCallback(() => {
    setI((x) => (x >= last ? 0 : x));
    setPlaying(true);
  }, [last]);
  const pause = useCallback(() => setPlaying(false), []);
  return {
    i,
    playing,
    speed,
    set: (n: number) => {
      setPlaying(false);
      setI(Math.max(0, Math.min(last, n)));
    },
    play,
    pause,
    toggle: () => (playing ? pause() : play()),
    setSpeed,
  };
}

/** "2026-08-01" → "2026.08" */
export const frameLabel = (d: string | undefined) => (d ? d.slice(0, 7).replace('-', '.') : '—');

/** Play/pause, a slider over the frames, the date shown and the speed */
export function TimelineControl({ t, dates, label = '시점' }: { t: Timeline; dates: string[]; label?: string }) {
  if (dates.length < 2) return null;
  return (
    <div className="timeline" role="group" aria-label={`${label} 재생`}>
      <button type="button" className="btn small timeline-play" onClick={t.toggle} aria-label={t.playing ? '일시정지' : '재생'}>
        {t.playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        min={0}
        max={dates.length - 1}
        value={t.i}
        onChange={(e) => t.set(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={frameLabel(dates[t.i])}
      />
      <span className="timeline-date">{frameLabel(dates[t.i])}</span>
      <div className="seg timeline-speed" role="group" aria-label="재생 속도">
        {SPEEDS.map((s) => (
          <button key={s} type="button" aria-current={t.speed === s ? 'true' : undefined} onClick={() => t.setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}

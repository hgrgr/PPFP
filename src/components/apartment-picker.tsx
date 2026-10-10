'use client';

import { useState, useTransition } from 'react';
import { apartmentOptionsAction, searchApartmentsAction } from '@/app/real-estate-actions';
import { areaLabel, eok, periodLabel, PICK_PERIODS, type ApartmentMeta, type PlaceHit } from '@/domain/real-estate';
import type { ApartmentOptions } from '@/server/services/real-estate';

/** A name for the asset: "래미안대치팰리스 34평형" */
export const apartmentName = (m: ApartmentMeta) => `${m.aptNm ?? m.placeName}${m.area ? ` ${areaLabel(m.area).match(/약 (\d+평형)/)?.[1] ?? ''}` : ''}`.trim();

/**
 * Find an apartment on the map, then pick its complex and 전용면적 from the deals reported
 * around it. Lives inside other forms, so it has no <form> of its own: Enter searches.
 */
export function ApartmentPicker({ onChange }: { onChange: (meta: ApartmentMeta | null) => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PlaceHit[] | null>(null);
  const [opts, setOpts] = useState<ApartmentOptions | null>(null);
  const [complex, setComplex] = useState('');
  const [area, setArea] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [widening, startWiden] = useTransition();
  const [wideningTo, setWideningTo] = useState<number | null>(null);

  const emit = (o: ApartmentOptions, key: string, a: string) => {
    const c = o.complexes.find((x) => x.key === key);
    onChange({
      kind: 'apartment',
      address: o.place.address,
      roadAddress: o.place.roadAddress,
      placeName: o.place.name,
      lat: o.place.lat,
      lng: o.place.lng,
      lawdCd: o.lawdCd,
      umdCd: o.umdCd,
      umdNm: o.umdNm,
      aptNm: c?.aptNm ?? null,
      jibun: c?.jibun ?? null,
      aptSeq: c?.aptSeq ?? null,
      area: c && a ? Number(a) : null,
    });
  };

  const search = () => {
    if (query.trim().length < 2) return;
    setError(null);
    setOpts(null);
    onChange(null);
    start(async () => {
      const r = await searchApartmentsAction(query);
      if ('error' in r) {
        setError(r.error);
        setHits(null);
      } else setHits(r.hits);
    });
  };

  const pickPlace = (p: PlaceHit) => {
    setError(null);
    start(async () => {
      const r = await apartmentOptionsAction(p);
      if ('error' in r) {
        setError(r.error);
        return;
      }
      setHits(null);
      setOpts(r);
      const key = r.suggested ?? '';
      const a = r.complexes.find((c) => c.key === key)?.areas[0]?.area;
      setComplex(key);
      setArea(a ? String(a) : '');
      emit(r, key, a ? String(a) : '');
    });
  };

  /** Read further back; the picked complex and area stay picked when they are still there. */
  const widen = (months: number) => {
    if (!opts) return;
    setError(null);
    setWideningTo(months);
    startWiden(async () => {
      const r = await apartmentOptionsAction(opts.place, months);
      setWideningTo(null);
      if ('error' in r) {
        setError(r.error);
        return;
      }
      const key = r.complexes.some((c) => c.key === complex) ? complex : r.suggested ?? '';
      const areas = r.complexes.find((c) => c.key === key)?.areas ?? [];
      const a = areas.some((x) => String(x.area) === area) ? area : areas[0] ? String(areas[0].area) : '';
      setOpts(r);
      setComplex(key);
      setArea(a);
      emit(r, key, a);
    });
  };
  // Longer periods than the one shown; none once everything since 2006 is read
  const wider = opts && opts.months !== 0 ? PICK_PERIODS.filter((p) => p.months === 0 || p.months > opts.months) : [];

  const current = opts?.complexes.find((c) => c.key === complex);
  return (
    <div className="apt-picker full">
      <label className="field">
        아파트 찾기
        <span className="inline">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                search();
              }
            }}
            placeholder="아파트 이름 또는 주소 (예: 래미안대치팰리스)"
            maxLength={80}
            aria-describedby="apt-help"
          />
          <button type="button" className="btn" onClick={search} disabled={pending || query.trim().length < 2}>
            {pending ? '찾는 중…' : '찾기'}
          </button>
        </span>
        <span className="sub" id="apt-help">고르면 실거래가에 나온 단지와 전용면적을 고를 수 있습니다. 아파트가 아니면 비워 두고 이름만 적으세요.</span>
      </label>
      {error && <p className="msg err">{error}</p>}
      {hits && (
        <div className="book-hits" role="region" aria-label="아파트 검색 결과">
          {hits.length ? (
            <ul>
              {hits.map((h, i) => (
                <li key={`${h.name}:${i}`}>
                  <button type="button" onClick={() => pickPlace(h)} disabled={pending}>
                    <span className="strong">{h.name}</span>
                    <span className="sub">{h.roadAddress ?? h.address} · {h.category.split(' > ').at(-1) || '장소'}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sub">찾은 곳이 없습니다. 단지 이름을 줄이거나 동 이름을 함께 넣어 보세요.</p>
          )}
        </div>
      )}
      {opts && (
        <div className="apt-picked">
          <p className="sub">
            <span className="strong">{opts.place.name}</span> · {opts.place.roadAddress ?? opts.place.address}{' '}
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setOpts(null);
                onChange(null);
              }}
            >
              다시 찾기
            </button>
          </p>
          {opts.complexes.length ? (
            <div className="grid">
              <label className="field">
                실거래가 단지 ({opts.umdNm} {periodLabel(opts.months)})
                <select
                  value={complex}
                  onChange={(e) => {
                    const c = opts.complexes.find((x) => x.key === e.target.value);
                    const a = c?.areas[0]?.area ? String(c.areas[0].area) : '';
                    setComplex(e.target.value);
                    setArea(a);
                    emit(opts, e.target.value, a);
                  }}
                >
                  <option value="">고르지 않음 (주소만 저장)</option>
                  {opts.complexes.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.aptNm}{c.jibun ? ` (${c.jibun})` : ''} · 거래 {c.deals}건 · 마지막 {c.lastDate.slice(0, 7)}{c.buildYear ? ` · ${c.buildYear}년 준공` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                전용면적
                <select
                  value={area}
                  disabled={!current}
                  onChange={(e) => {
                    setArea(e.target.value);
                    emit(opts, complex, e.target.value);
                  }}
                >
                  {current?.areas.map((a) => (
                    <option key={a.area} value={a.area}>
                      {areaLabel(a.area)} · 최근 {eok(a.lastPrice)} ({a.lastDate})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <p className="sub">{opts.umdNm}에서 {periodLabel(opts.months)} 동안 신고된 아파트 거래가 없습니다. 주소만 저장합니다.</p>
          )}
          {wider.length > 0 && (
            <div className="inline apt-widen" role="group" aria-label="더 이전 거래까지 찾기">
              <span className="sub">찾는 단지나 면적이 없나요? 더 이전 거래까지 찾기:</span>
              {wider.map((p) => (
                <button key={p.months} type="button" className="btn small" disabled={widening} onClick={() => widen(p.months)}>
                  {wideningTo === p.months ? '읽는 중…' : p.label}
                </button>
              ))}
            </div>
          )}
          {widening && <p className="sub">{wideningTo === 0 ? '2006년부터' : `최근 ${(wideningTo ?? 12) / 12}년`} 거래를 읽고 있습니다. 처음 읽는 기간은 시간이 걸립니다(전체는 1분 가까이).</p>}
        </div>
      )}
    </div>
  );
}

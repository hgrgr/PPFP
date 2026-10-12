'use client';

import { useState, useTransition } from 'react';
import { lotOptionsAction } from '@/app/real-estate-actions';
import { LOT_AREA_LABEL, LOT_USE_LABEL, propertyKindShort, type LotKind, type LotMeta, type PlaceHit } from '@/domain/real-estate';
import type { LotOptions } from '@/server/services/real-estate';
import { PlaceSearch } from './apartment-picker';

/** A name for the asset: "연희동 130-12 단독" */
export const lotName = (m: LotMeta) => [m.umdNm.split(' ').at(-1), m.jibun, m.use ?? propertyKindShort(m.kind)].filter(Boolean).join(' ');

/**
 * Find a house, a piece of land or a shop on the map, then say which of its 동's deals to
 * compare with (주택 유형, 지목, 건물 용도) and its area. Their deals hide the 지번, so there
 * is no building to pick.
 */
export function LotPicker({ kind, onChange }: { kind: LotKind; onChange: (meta: LotMeta | null) => void }) {
  const [opts, setOpts] = useState<LotOptions | null>(null);
  const [use, setUse] = useState('');
  const [area, setArea] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const emit = (o: LotOptions, u: string, a: string) => {
    const n = Number(a);
    onChange({
      kind,
      address: o.place.address,
      roadAddress: o.place.roadAddress,
      placeName: o.place.name,
      lat: o.place.lat,
      lng: o.place.lng,
      lawdCd: o.lawdCd,
      umdCd: o.umdCd,
      umdNm: o.umdNm,
      jibun: o.jibun,
      area: a && Number.isFinite(n) && n > 0 ? n : null,
      use: u || null,
    });
  };

  const pickPlace = (p: PlaceHit) => {
    setError(null);
    start(async () => {
      const r = await lotOptionsAction(p, kind);
      if ('error' in r) {
        setError(r.error);
        return;
      }
      setOpts(r);
      setUse('');
      emit(r, '', area);
    });
  };

  return (
    <div className="apt-picker full">
      {!opts && (
        <PlaceSearch
          kind={kind}
          busy={pending}
          help={`고르면 같은 동의 ${propertyKindShort(kind)} 실거래가와 비교합니다. 실거래가에는 지번이 가려져 나와 내 ${propertyKindShort(kind)} 거래를 집어낼 수는 없습니다.`}
          onPick={pickPlace}
          onReset={() => {
            setError(null);
            onChange(null);
          }}
        />
      )}
      {pending && <p className="sub">실거래가를 읽는 중…</p>}
      {error && <p className="msg err">{error}</p>}
      {opts && (
        <div className="apt-picked">
          <p className="sub">
            <span className="strong">{opts.place.name}</span> · {opts.place.roadAddress ?? opts.place.address} · {opts.umdNm} 최근 2년 거래 {opts.deals}건{' '}
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
          <div className="grid">
            <label className="field">
              {`비교할 ${LOT_USE_LABEL[kind]}`}
              <select
                value={use}
                onChange={(e) => {
                  setUse(e.target.value);
                  emit(opts, e.target.value, area);
                }}
              >
                <option value="">모두</option>
                {opts.uses.map((u) => (
                  <option key={u.use} value={u.use}>
                    {u.use} · 거래 {u.deals}건
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {`${LOT_AREA_LABEL[kind]} ㎡`}
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={area}
                placeholder="참고 시세 계산에 씁니다"
                onChange={(e) => {
                  setArea(e.target.value);
                  emit(opts, use, e.target.value);
                }}
              />
            </label>
          </div>
          {!opts.deals && <p className="sub">{opts.umdNm}에서 최근 2년 동안 신고된 {propertyKindShort(kind)} 거래가 없습니다. 주소만 저장하고, 거래가 생기면 자산 화면에 나옵니다.</p>}
        </div>
      )}
    </div>
  );
}

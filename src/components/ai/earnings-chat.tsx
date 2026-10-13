'use client';

import { useState } from 'react';
import { EARNINGS_LENS_PRESETS } from '@/domain/ai';
import { AiChat, type SageOption } from './chat';

/**
 * A new 실적·공시 분석가 conversation: before the first question the user sets the lens it judges
 * results by, a guideline of their own (from a ready-made one or the last one used) and/or an
 * investor from their 투자 노트. Both are fixed once the conversation starts.
 */
export function EarningsChat({ saved, sages, modelLabel }: { saved: string | null; sages: SageOption[]; modelLabel?: string }) {
  const [lens, setLens] = useState(saved ?? '');
  const [sageId, setSageId] = useState('');
  const [started, setStarted] = useState(false);
  const sageName = sages.find((s) => s.id === sageId)?.name;

  return (
    <div className="stack" style={{ gap: 10 }}>
      {started ? (
        <LensSummary lens={lens.trim() || null} sage={sageName ?? null} />
      ) : (
        <details className="earnings-lens" open>
          <summary className="strong">분석 관점 {lens.trim() || sageId ? <span className="badge ok">정함</span> : <span className="sub">(선택)</span>}</summary>
          <div className="stack" style={{ gap: 8 }}>
            <p className="sub">실적을 어떤 기준으로 평가할지 정합니다. 요약 끝에 기준마다 충족·미흡·판단 불가를 따져 줍니다. 첫 질문을 보내면 이 대화에서는 고정되고, 다음 대화에 다시 채워집니다.</p>
            <div className="inline" style={{ gap: 6 }} role="group" aria-label="가이드라인 예시">
              {EARNINGS_LENS_PRESETS.map((p) => (
                <button key={p.label} type="button" className="btn small" onClick={() => setLens(p.text)}>
                  {p.label}
                </button>
              ))}
              {lens && (
                <button type="button" className="btn small" onClick={() => setLens('')}>
                  비우기
                </button>
              )}
            </div>
            <textarea value={lens} rows={5} maxLength={4000} onChange={(e) => setLens(e.target.value)} placeholder="내 가이드라인, 예: 매출 성장률 20% 이상 유지, 영업현금흐름이 순이익보다 클 것, 가이던스 상향 여부" aria-label="분석 가이드라인" />
            <label className="inline" style={{ gap: 8 }}>
              <span className="sub">투자 거장 관점</span>
              <select value={sageId} onChange={(e) => setSageId(e.target.value)} aria-label="투자 거장 관점">
                <option value="">없음</option>
                {sages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (내 투자 노트 정리)
                  </option>
                ))}
              </select>
              {!sages.length && (
                <a className="sub" href="/sages">
                  투자 노트에 거장을 정리하면 고를 수 있습니다 ›
                </a>
              )}
            </label>
          </div>
        </details>
      )}
      <AiChat initial={null} agent="EARNINGS" sageId={sageId || null} lens={lens} path="/ai" urlOnStart modelLabel={modelLabel} onConversation={() => setStarted(true)} />
    </div>
  );
}

export function LensSummary({ lens, sage }: { lens: string | null; sage: string | null }) {
  if (!lens && !sage) return <p className="sub">분석 관점: 정하지 않음</p>;
  return (
    <details className="earnings-lens">
      <summary>
        <span className="strong">분석 관점</span> <span className="sub">{[lens ? '내 가이드라인' : null, sage ? `${sage}의 관점` : null].filter(Boolean).join(' + ')}</span>
      </summary>
      {lens && <p className="sub" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{lens}</p>}
    </details>
  );
}

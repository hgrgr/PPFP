'use client';

import { useState } from 'react';
import { AGENT_ORDER, AGENTS, type AgentKind } from '@/domain/ai';
import { DEFAULT_CHOICE, PROVIDER_ORDER, PROVIDERS, type ModelChoice, type ProviderId } from '@/domain/ai-providers';

type Keys = Record<ProviderId, { source: 'user' | 'server' | null; hint: string | null }>;

/** API keys for each AI company, inside the AI settings form (fields key.<provider>, clear.<provider>). */
export function AiKeyFields({ keys }: { keys: Keys }) {
  return (
    <fieldset className="full ai-box">
      <legend className="sub strong">AI 회사별 API 키</legend>
      <p className="sub">쓰려는 회사의 키만 넣으면 됩니다. 키는 암호화해 저장하고 다시 보여 주지 않습니다. 사용료는 각 회사의 키 계정으로 청구됩니다.</p>
      <div className="table-wrap">
        <table className="ai-key-table">
          <tbody>
            {PROVIDER_ORDER.map((p) => {
              const k = keys[p];
              const info = PROVIDERS[p];
              return (
                <tr key={p}>
                  <th scope="row">
                    <span className="strong">{info.name}</span>
                    <br />
                    <a className="sub" href={info.consoleUrl} target="_blank" rel="noreferrer">
                      키 만들기 ↗
                    </a>
                  </th>
                  <td>
                    {k.source === 'user' ? <span className="badge ok">내 키 {k.hint}</span> : k.source === 'server' ? <span className="badge">서버 기본 키</span> : <span className="badge muted">없음</span>}
                  </td>
                  <td>
                    <input name={`key.${p}`} type="password" autoComplete="off" aria-label={`${info.name} API 키`} placeholder={k.source === 'user' ? '바꾸려면 새 키' : info.keyPlaceholder} />
                  </td>
                  <td>
                    {k.source === 'user' && (
                      <label className="check">
                        <input type="checkbox" name={`clear.${p}`} /> 지우기
                      </label>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </fieldset>
  );
}

/**
 * Which company and model each agent answers with (fields provider.<agent>, model.<agent>).
 * The model box suggests the usual models and, once the company has a key, every model the
 * key can use. "한 번에 바꾸기" sets every agent at once.
 */
export function AgentModelFields({ keys, picks }: { keys: Keys; picks: Partial<Record<AgentKind, ModelChoice>> }) {
  const [rows, setRows] = useState<Record<AgentKind, ModelChoice>>(() => Object.fromEntries(AGENT_ORDER.map((a) => [a, picks[a] ?? DEFAULT_CHOICE])) as Record<AgentKind, ModelChoice>);
  const [all, setAll] = useState<ModelChoice>(DEFAULT_CHOICE);
  const [listed, setListed] = useState<Partial<Record<ProviderId, string[] | 'loading' | { error: string }>>>({});

  const load = async (p: ProviderId) => {
    if (!keys[p].source || listed[p]) return;
    setListed((x) => ({ ...x, [p]: 'loading' }));
    try {
      const r = await (await fetch(`/api/ai/models?provider=${p}`, { cache: 'no-store' })).json();
      setListed((x) => ({ ...x, [p]: Array.isArray(r.models) ? r.models : { error: String(r.error ?? '목록을 받지 못했습니다') } }));
    } catch {
      setListed((x) => ({ ...x, [p]: { error: '목록을 받지 못했습니다' } }));
    }
  };
  const switchTo = (cur: ModelChoice, provider: ProviderId): ModelChoice => (cur.provider === provider ? cur : { provider, model: PROVIDERS[provider].models[0].id });
  const fallback = PROVIDER_ORDER.find((p) => keys[p].source);

  const note = (agent: AgentKind, c: ModelChoice) => {
    const out: string[] = [];
    if (!keys[c.provider].source) out.push(fallback ? `키가 없어 지금은 ${keys.anthropic.source ? 'Claude' : PROVIDERS[fallback].name}로 답합니다` : '키를 넣어야 쓸 수 있습니다');
    if (!PROVIDERS[c.provider].webSearch) out.push(agent === 'RESEARCH' ? '웹 검색 없이 답합니다 · 리서치는 Claude를 권합니다' : '웹 검색 없이 답합니다');
    const l = listed[c.provider];
    if (l && typeof l === 'object' && !Array.isArray(l)) out.push(l.error);
    return out.join(' · ');
  };

  const ModelInput = ({ value, onChange, label, name }: { value: ModelChoice; onChange: (m: string) => void; label: string; name?: string }) => (
    <input name={name} value={value.model} list={`ai-models-${value.provider}`} aria-label={label} spellCheck={false} autoComplete="off" onFocus={() => load(value.provider)} onChange={(e) => onChange(e.target.value.trim())} />
  );

  return (
    <fieldset className="full ai-box">
      <legend className="sub strong">에이전트별 모델</legend>
      <p className="sub">새 대화를 시작할 때 이 모델로 답합니다. 이미 시작한 대화는 처음 모델로 이어 갑니다. 웹 검색(최신 뉴스·실적 확인)은 Claude 모델에서만 됩니다.</p>
      <input type="hidden" name="picks" value="1" />
      <div className="inline ai-model-all">
        <span className="sub strong">한 번에 바꾸기</span>
        <select aria-label="모든 에이전트의 AI 회사" value={all.provider} onChange={(e) => setAll(switchTo(all, e.target.value as ProviderId))}>
          {PROVIDER_ORDER.map((p) => (
            <option key={p} value={p}>
              {PROVIDERS[p].name}
            </option>
          ))}
        </select>
        {ModelInput({ value: all, label: '모든 에이전트의 모델', onChange: (m) => setAll({ ...all, model: m }) })}
        <button type="button" className="btn small" onClick={() => setRows(Object.fromEntries(AGENT_ORDER.map((a) => [a, all])) as Record<AgentKind, ModelChoice>)}>
          모든 에이전트에 적용
        </button>
      </div>
      <div className="table-wrap">
        <table className="ai-model-table">
          <thead>
            <tr>
              <th scope="col">에이전트</th>
              <th scope="col">AI 회사</th>
              <th scope="col">모델</th>
            </tr>
          </thead>
          <tbody>
            {AGENT_ORDER.map((a) => {
              const c = rows[a];
              const n = note(a, c);
              return (
                <tr key={a}>
                  <th scope="row" className="strong">
                    {AGENTS[a].name}
                  </th>
                  <td>
                    <select name={`provider.${a}`} aria-label={`${AGENTS[a].name} AI 회사`} value={c.provider} onChange={(e) => setRows({ ...rows, [a]: switchTo(c, e.target.value as ProviderId) })}>
                      {PROVIDER_ORDER.map((p) => (
                        <option key={p} value={p}>
                          {PROVIDERS[p].name}
                          {keys[p].source ? '' : ' (키 없음)'}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {ModelInput({ value: c, name: `model.${a}`, label: `${AGENTS[a].name} 모델`, onChange: (m) => setRows({ ...rows, [a]: { ...c, model: m } }) })}
                    {n && <div className="sub">{n}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {PROVIDER_ORDER.map((p) => {
        const l = listed[p];
        const extra = Array.isArray(l) ? l.filter((id) => !PROVIDERS[p].models.some((m) => m.id === id)) : [];
        return (
          <datalist key={p} id={`ai-models-${p}`}>
            {PROVIDERS[p].models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {extra.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        );
      })}
    </fieldset>
  );
}

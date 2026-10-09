'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { communitySkillAction, deleteSkillAction, installSkillAction, refreshSkillAction, saveSkillAction, updateSkillUseAction } from '@/app/ai-actions';
import { AGENT_ORDER, AGENTS, type AgentKind } from '@/domain/ai';
import { CATEGORIES, categoriesOf, parseSkillMd, SKILL_STARTERS, suggestAgents, type CatalogEntry } from '@/domain/ai-skills';
import type { CommunitySkill, SkillView } from '@/server/services/ai/skills';
import { Md } from './chat';

const SHORT: Record<AgentKind, string> = { MANAGER: '매니저', RESEARCH: '리서치', COACH: '코치', LIBRARIAN: '큐레이터', SAGE: '거장 관점' };
const fmt = (n: number) => n.toLocaleString('ko-KR');

function AgentChecks({ value, onChange, disabled, name }: { value: AgentKind[]; onChange: (v: AgentKind[]) => void; disabled?: boolean; name: string }) {
  return (
    <span className="inline skill-agents" role="group" aria-label={`${name}을(를) 쓰는 에이전트`}>
      {AGENT_ORDER.map((a) => (
        <label key={a} className="check" title={AGENTS[a].name}>
          <input type="checkbox" disabled={disabled} checked={value.includes(a)} onChange={(e) => onChange(e.target.checked ? [...value, a] : value.filter((x) => x !== a))} />
          {SHORT[a]}
        </label>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- my skills

interface Draft {
  id: string | null;
  name: string;
  description: string;
  instructions: string;
  agents: AgentKind[];
}

function SkillEditor({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState(draft);
  const [paste, setPaste] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const save = () =>
    start(async () => {
      const r = await saveSkillAction(f.id, f);
      setMsg(r);
      if (!r.error) {
        router.refresh();
        onClose();
      }
    });
  return (
    <section className="card skill-editor" aria-label={f.id ? '스킬 고치기' : '새 스킬'}>
      <div className="spread">
        <h2>{f.id ? `‘${draft.name}’ 고치기` : '새 스킬'}</h2>
        <span className="inline" style={{ gap: 6 }}>
          {!f.id && (
            <button type="button" className="btn small" onClick={() => setPaste(paste === null ? '' : null)}>
              SKILL.md 붙여넣기
            </button>
          )}
          <button type="button" className="btn small" onClick={onClose}>
            닫기
          </button>
        </span>
      </div>
      {paste !== null && (
        <div className="stack" style={{ gap: 6 }}>
          <textarea rows={6} value={paste} placeholder={'---\nname: my-skill\ndescription: 언제 쓰는지\n---\n\n# 지침…'} aria-label="SKILL.md 내용" onChange={(e) => setPaste(e.target.value)} className="mono" />
          <div>
            <button
              type="button"
              className="btn small primary"
              disabled={!paste.trim()}
              onClick={() => {
                const p = parseSkillMd(paste);
                setF((x) => ({ ...x, name: p.name, description: p.description, instructions: p.instructions, agents: x.agents.length ? x.agents : suggestAgents(`${p.name} ${p.description}`) }));
                setPaste(null);
              }}
            >
              칸에 채우기
            </button>
          </div>
        </div>
      )}
      <div className="grid skill-fields">
        <label className="field">
          이름
          <input value={f.name} placeholder="my-buy-checklist" spellCheck={false} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <span className="sub">영문 소문자·숫자·하이픈으로 바뀌어 저장됩니다. 에이전트가 이 이름으로 스킬을 부릅니다.</span>
        </label>
        <label className="field full">
          언제 쓰는지
          <input value={f.description} placeholder="예: 매수를 검토할 때 내 원칙으로 점검합니다" onChange={(e) => setF({ ...f, description: e.target.value })} />
          <span className="sub">에이전트는 이 설명만 보고 스킬을 읽을지 정합니다. 어떤 질문에 쓰는지 구체적으로 적으세요.</span>
        </label>
        <div className="field full">
          쓰는 에이전트
          <AgentChecks name="이 스킬" value={f.agents} onChange={(agents) => setF({ ...f, agents })} />
        </div>
        <label className="field full">
          지침 (마크다운)
          <textarea rows={16} className="mono" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />
          <span className="sub">순서, 확인할 것, 답의 형식을 적습니다. 앱의 도구 이름(get_holding, get_price_history 등)을 적어 두면 그 도구로 확인합니다.</span>
        </label>
      </div>
      {msg?.error && <p className="msg err">{msg.error}</p>}
      <div className="inline">
        <button type="button" className="btn primary" disabled={pending} onClick={save}>
          {pending ? '저장 중…' : '저장'}
        </button>
      </div>
    </section>
  );
}

function SkillRow({ s, onEdit }: { s: SkillView; onEdit: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.error ?? null);
      router.refresh();
    });
  return (
    <tr aria-busy={pending} className={s.enabled ? undefined : 'off'}>
      <td>
        <label className="check" title={s.enabled ? '켜짐' : '꺼짐'}>
          <input type="checkbox" checked={s.enabled} aria-label={`${s.name} 켜기`} onChange={(e) => act(() => updateSkillUseAction(s.id, { enabled: e.target.checked }))} />
        </label>
      </td>
      <td className="skill-main">
        <span className="strong mono">{s.name}</span>{' '}
        {s.source === 'custom' ? (
          <span className="badge">직접 만듦</span>
        ) : (
          <a className="badge" href={s.sourceUrl ?? '#'} target="_blank" rel="noreferrer">
            커뮤니티 ↗
          </a>
        )}
        <span className="sub skill-desc">{s.description}</span>
        {s.skipped.length > 0 && <span className="sub">원본의 파일 {s.skipped.length}개(스크립트 등)는 가져오지 않았습니다</span>}
        {error && <span className="sub down">{error}</span>}
      </td>
      <td>
        <AgentChecks name={s.name} value={s.agents} disabled={pending} onChange={(agents) => act(() => updateSkillUseAction(s.id, { agents }))} />
      </td>
      <td>
        <span className="inline" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <button type="button" className="btn small" onClick={onEdit}>
            고치기
          </button>
          {s.sourceId && (
            <button type="button" className="btn small" disabled={pending} title="원본 저장소에서 지침을 다시 읽습니다. 직접 고친 내용은 덮어씁니다." onClick={() => confirm('원본에서 다시 가져오면 직접 고친 지침이 덮어써집니다. 계속할까요?') && act(() => refreshSkillAction(s.id))}>
              다시 가져오기
            </button>
          )}
          <button type="button" className="btn small danger" disabled={pending} onClick={() => confirm(`‘${s.name}’ 스킬을 지울까요?`) && act(() => deleteSkillAction(s.id))}>
            지우기
          </button>
        </span>
      </td>
    </tr>
  );
}

export function MySkills({ skills }: { skills: SkillView[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const counts = AGENT_ORDER.map((a) => [a, skills.filter((s) => s.enabled && s.agents.includes(a)).length] as const);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="inline" style={{ gap: 8 }}>
        <button type="button" className="btn primary" onClick={() => setDraft({ id: null, name: '', description: '', instructions: '', agents: ['MANAGER'] })}>
          + 새 스킬
        </button>
        <span className="sub">예시로 시작:</span>
        {SKILL_STARTERS.map((t) => (
          <button key={t.name} type="button" className="btn small" onClick={() => setDraft({ id: null, ...t })}>
            {t.name}
          </button>
        ))}
      </div>
      {draft && <SkillEditor key={draft.id ?? draft.name} draft={draft} onClose={() => setDraft(null)} />}
      {skills.length ? (
        <section className="card">
          <div className="spread">
            <h2>내 스킬</h2>
            <span className="sub">{counts.map(([a, n]) => `${SHORT[a]} ${n}`).join(' · ')}</span>
          </div>
          <div className="table-wrap">
            <table className="skill-table">
              <thead>
                <tr>
                  <th scope="col">켜기</th>
                  <th scope="col">스킬</th>
                  <th scope="col">쓰는 에이전트</th>
                  <th scope="col">
                    <span className="sr-only">작업</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {skills.map((s) => (
                  <SkillRow key={s.id} s={s} onEdit={() => setDraft({ id: s.id, name: s.name, description: s.description, instructions: s.instructions, agents: s.agents })} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        !draft && (
          <p className="empty">
            아직 스킬이 없습니다. 새로 만들거나 <a href="/ai/skills?tab=community">커뮤니티 스킬</a>에서 가져오세요.
          </p>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------- community

function Preview({ id, installed, onDone }: { id: string; installed?: { agents: AgentKind[] }; onDone: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<{ skill?: CommunitySkill; error?: string } | null>(null);
  const [agents, setAgents] = useState<AgentKind[] | null>(installed?.agents ?? null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  useEffect(() => {
    let live = true;
    void communitySkillAction(id).then((r) => {
      if (!live) return;
      setState(r);
      // A skill applied before keeps its agents; a new one starts from a guess
      setAgents((cur) => cur ?? (r.skill ? suggestAgents(`${r.skill.name} ${r.skill.description}`) : null));
    });
    return () => {
      live = false;
    };
  }, [id]);
  const s = state?.skill;
  return (
    <aside className="card skill-preview" aria-label="스킬 미리 보기" aria-busy={!state}>
      <div className="spread">
        <span className="sub mono">{id}</span>
        <button type="button" className="btn small" aria-label="미리 보기 닫기" onClick={onDone}>
          ✕
        </button>
      </div>
      {!state && <p className="sub">GitHub에서 SKILL.md를 읽는 중…</p>}
      {state?.error && <p className="msg err">{state.error}</p>}
      {s && (
        <>
          <h2 className="mono">{s.name}</h2>
          <p style={{ margin: 0 }}>{s.description || '설명이 없습니다.'}</p>
          <div className="inline sub" style={{ gap: 10 }}>
            {s.installs !== null && <span>설치 {fmt(s.installs)}회 (skills.sh)</span>}
            <span>라이선스 {s.license ?? '표기 없음'}</span>
            <a href={s.url} target="_blank" rel="noreferrer">
              GitHub에서 보기 ↗
            </a>
          </div>
          <div className="msg skill-warn">
            커뮤니티가 만든 글입니다. 적용하기 전에 아래 지침을 읽어 보세요. 지침만 가져오고{s.skipped.length ? ` 같은 폴더의 파일 ${s.skipped.length}개(스크립트 등)는 가져오지 않으며` : ''} 앱은 어떤 코드도 실행하지 않습니다.
            스킬이 데이터 수집 스크립트나 외부 API를 쓰라고 하면 에이전트는 앱의 도구로 대신합니다. 데이터를 바꾸는 일은 여전히 확인 카드로만 제안합니다.
          </div>
          <div className="field">
            <span className="sub strong">적용할 에이전트</span>
            <AgentChecks name={s.name} value={agents ?? []} onChange={setAgents} />
          </div>
          <div className="inline">
            <button
              type="button"
              className="btn primary"
              disabled={pending || !agents?.length}
              onClick={() =>
                start(async () => {
                  const r = await installSkillAction(id, agents ?? []);
                  setMsg(r);
                  router.refresh();
                })
              }
            >
              {pending ? '적용 중…' : installed ? '다시 가져와 적용' : '내 어드바이저에 적용'}
            </button>
            {msg && <span className={`msg ${msg.error ? 'err' : 'ok'}`}>{msg.error ?? msg.ok}</span>}
          </div>
          <details className="skill-body" open>
            <summary className="sub strong">지침 ({fmt(s.instructions.length)}자)</summary>
            <Md text={s.instructions} />
          </details>
          {s.resources.length > 0 && <p className="sub">함께 가져오는 참고 파일: {s.resources.map((r) => r.path).join(', ')}</p>}
        </>
      )}
    </aside>
  );
}

export function CommunitySkills({ items, fetchedAt, installed }: { items: CatalogEntry[]; fetchedAt: string; installed: Record<string, { agents: AgentKind[] }> }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [shown, setShown] = useState(50);
  const [open, setOpen] = useState<string | null>(null);
  const ranked = useMemo(() => items.map((e, i) => ({ ...e, rank: i + 1, cats: categoriesOf(e) })), [items]);
  const list = ranked.filter((e) => (!cat || e.cats.includes(cat)) && (!q.trim() || e.id.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <div className={`skill-community${open ? ' with-preview' : ''}`}>
      <section className="card">
        <div className="spread">
          <h2>투자 스킬 랭킹</h2>
          <span className="sub">
            <a href="https://skills.sh" target="_blank" rel="noreferrer">
              skills.sh
            </a>{' '}
            설치 수 순 · {new Date(fetchedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 기준
          </span>
        </div>
        <div className="inline" style={{ gap: 8 }}>
          <input value={q} placeholder="이름·저장소로 찾기 (예: dividend, buffett)" aria-label="커뮤니티 스킬 찾기" onChange={(e) => (setQ(e.target.value), setShown(50))} style={{ maxWidth: 320 }} />
          <div className="seg" role="group" aria-label="분류">
            <button type="button" aria-pressed={!cat} onClick={() => (setCat(null), setShown(50))}>
              전체
            </button>
            {CATEGORIES.map((c) => (
              <button key={c.key} type="button" aria-pressed={cat === c.key} onClick={() => (setCat(c.key), setShown(50))}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table className="skill-rank">
            <thead>
              <tr>
                <th scope="col">순위</th>
                <th scope="col">스킬</th>
                <th scope="col">설치</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, shown).map((e) => (
                <tr key={e.id} aria-current={open === e.id ? 'true' : undefined}>
                  <td className="num">{e.rank}</td>
                  <td>
                    <button type="button" className="skill-pick" onClick={() => setOpen(e.id)}>
                      <span className="strong mono">{e.name}</span>
                      {installed[e.id] && <span className="badge ok">적용됨</span>}
                      <span className="sub">{e.source}</span>
                    </button>
                  </td>
                  <td className="num">{fmt(e.installs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.length && <p className="empty">맞는 스킬이 없습니다.</p>}
        {list.length > shown && (
          <button type="button" className="btn" onClick={() => setShown((n) => n + 50)}>
            더 보기 ({fmt(list.length - shown)}개 남음)
          </button>
        )}
        <p className="sub">
          skills.sh에 올라온 스킬 가운데 이름과 저장소로 투자 관련만 골랐습니다. 설치 수는 skills CLI가 모은 익명 통계라 인기의 참고일 뿐, 품질이나 안전을 보장하지 않습니다. 코인 거래소 주문·지갑 스킬은 뺐습니다.
        </p>
      </section>
      {open && <Preview key={open} id={open} installed={installed[open]} onDone={() => setOpen(null)} />}
    </div>
  );
}

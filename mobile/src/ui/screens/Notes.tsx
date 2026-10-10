/** 메모, 매매일지, 알림함, AI 어드바이저 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { askAdvisor, type ChatTurn } from '~/core/ai';
import { db, getSetting } from '~/core/db';
import { saveJournal, saveNote } from '~/core/store';
import { ASSET_TYPE_LABEL, type Journal } from '~/core/types';
import { useBook, useLive } from '../hooks';
import { kstDate, kstDateTime, price, qty, shortWon } from '../format';
import { Msg, Topbar, useAction } from '../kit';

export function Notes() {
  const notes = useLive(() => db.notes.toArray());
  const act = useAction();
  const [body, setBody] = useState('');
  const [q, setQ] = useState('');
  if (!notes) return <Topbar title="메모" back />;
  const list = notes.filter((n) => !q || n.body.includes(q)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.createdAt < b.createdAt ? 1 : -1));
  return (
    <>
      <Topbar title="메모" back />
      <div className="page">
        <section className="card form">
          <label className="field">
            새 메모
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="#가치투자 같은 키워드를 함께 쓰면 찾기 쉽습니다." />
          </label>
          <button className="btn primary" disabled={act.busy} onClick={() => act.run(async () => { await saveNote({ body }); setBody(''); })}>저장</button>
          <Msg {...act.msg} />
        </section>
        <input className="input" placeholder="메모 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="메모 찾기" />
        {list.map((n) => (
          <section key={n.id} className="card">
            <p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>
            <div className="card-head">
              <span className="sub">{kstDate(n.createdAt)}{n.pinned ? ' · 고정' : ''}</span>
              <div className="actions">
                <button className="btn small" onClick={() => db.notes.update(n.id, { pinned: !n.pinned })}>{n.pinned ? '고정 풀기' : '고정'}</button>
                <button className="btn small danger" onClick={() => window.confirm('이 메모를 지울까요?') && db.notes.delete(n.id)}>지우기</button>
              </div>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

export function Journals() {
  const data = useBook();
  const journals = useLive(() => db.journals.orderBy('createdAt').reverse().toArray());
  if (!data || !journals) return <Topbar title="매매일지" back />;
  const assets = new Map(data.assets.map((a) => [a.id, a]));
  return (
    <>
      <Topbar title="매매일지" back right={<Link to="/journals/new" className="btn small">+ 새 일지</Link>} />
      <div className="page">
        {!journals.length && <div className="card empty">종목을 사기 전에 목표가와 근거를 적어 두면, 나중에 맞았는지 돌아볼 수 있습니다.</div>}
        {journals.length > 0 && (
          <section className="card flush">
            <div className="list">
              {journals.map((j) => {
                const a = j.assetId ? assets.get(j.assetId) : undefined;
                const now = a?.price ? Number(a.price) : null;
                const progress = now && j.basePrice ? (now - Number(j.basePrice)) / (Number(j.targetPrice) - Number(j.basePrice)) : null;
                return (
                  <Link key={j.id} to={`/journals/${j.id}`} className="row">
                    <div className="grow">
                      <span className="name">{j.title}</span>
                      <span className="sub">
                        {a?.name ?? '자산 없음'} · 목표 {price(j.targetPrice, a?.currency ?? 'KRW')}
                        {progress !== null ? ` · 진행 ${(progress * 100).toFixed(0)}%` : ''}
                      </span>
                    </div>
                    <span className={`badge ${j.status === 'OPEN' ? 'ok' : ''}`}>{j.status === 'OPEN' ? '진행 중' : '종료'}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

export function JournalEdit() {
  const { id = 'new' } = useParams();
  const nav = useNavigate();
  const data = useBook();
  const existing = useLive<Journal | null | undefined>(async () => (id === 'new' ? null : ((await db.journals.get(id)) ?? null)), [id]);
  const act = useAction();
  const [f, setF] = useState<null | { assetId: string; title: string; status: 'OPEN' | 'CLOSED'; targetPrice: string; basePrice: string; stopPrice: string; dueDate: string; body: string }>(null);
  if (!data || existing === undefined) return <Topbar title="매매일지" back />;
  const form = f ?? {
    assetId: existing?.assetId ?? data.assets[0]?.id ?? '',
    title: existing?.title ?? '',
    status: existing?.status ?? 'OPEN',
    targetPrice: existing?.targetPrice ?? '',
    basePrice: existing?.basePrice ?? '',
    stopPrice: existing?.stopPrice ?? '',
    dueDate: existing?.dueDate ?? '',
    body: existing?.body ?? '## 왜 사는가\n\n## 틀렸다고 볼 신호\n',
  };
  const set = (k: keyof typeof form, v: string) => setF({ ...form, [k]: v });
  return (
    <>
      <Topbar title={existing ? '매매일지 고치기' : '새 매매일지'} back />
      <div className="page">
        <section className="card form">
          <label className="field">
            종목
            <select value={form.assetId} onChange={(e) => set('assetId', e.target.value)}>
              {data.assets.map((a) => (
                <option key={a.id} value={a.id}>{a.name} · {ASSET_TYPE_LABEL[a.type]}</option>
              ))}
            </select>
          </label>
          <label className="field">제목<input value={form.title} onChange={(e) => set('title', e.target.value)} /></label>
          <div className="grid2">
            <label className="field">목표 예상 가격<input inputMode="decimal" value={form.targetPrice} onChange={(e) => set('targetPrice', e.target.value)} /></label>
            <label className="field">기준 가격<input inputMode="decimal" value={form.basePrice} onChange={(e) => set('basePrice', e.target.value)} /></label>
            <label className="field">손절가<input inputMode="decimal" value={form.stopPrice} onChange={(e) => set('stopPrice', e.target.value)} /></label>
            <label className="field">목표 기한<input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></label>
          </div>
          <label className="field">상태
            <select value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="OPEN">진행 중</option>
              <option value="CLOSED">종료</option>
            </select>
          </label>
          <label className="field">본문 (마크다운)<textarea rows={10} value={form.body} onChange={(e) => set('body', e.target.value)} /></label>
          <button className="btn primary" disabled={act.busy || !form.assetId} onClick={() => act.run(async () => {
            await saveJournal({ id: existing?.id, assetId: form.assetId, title: form.title, status: form.status, targetPrice: form.targetPrice, basePrice: form.basePrice || null, stopPrice: form.stopPrice || null, dueDate: form.dueDate || null, body: form.body });
            nav('/journals');
          })}>저장</button>
          {existing && <button className="btn danger" onClick={() => window.confirm('이 일지를 지울까요?') && db.journals.delete(existing.id).then(() => nav('/journals'))}>지우기</button>}
          <Msg {...act.msg} />
        </section>
      </div>
    </>
  );
}

export function Notices() {
  const notices = useLive(() => db.notices.orderBy('at').reverse().limit(100).toArray());
  if (!notices) return <Topbar title="알림함" back />;
  return (
    <>
      <Topbar title="알림함" back right={<button className="btn small" onClick={() => db.notices.toCollection().modify({ read: true })}>모두 읽음</button>} />
      <div className="page">
        {!notices.length && <div className="card empty">알림이 없습니다. 자산 화면에서 가격 알림을 만들거나, 서버를 연동하면 서버의 알림이 여기에 옵니다.</div>}
        {notices.map((n) => (
          <section key={n.id} className="card" style={n.read ? {} : { borderColor: 'var(--focus)' }} onClick={() => !n.read && db.notices.update(n.id, { read: true })}>
            <div className="card-head">
              <span className="strong">{n.title}</span>
              <span className="badge">{n.kind === 'SERVER' ? '서버' : n.kind === 'PRICE' ? '가격' : '안내'}</span>
            </div>
            <p className="sub" style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>
            <span className="sub">{kstDateTime(n.at)}</span>
          </section>
        ))}
      </div>
    </>
  );
}

export function Advisor() {
  const data = useBook();
  const act = useAction();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [q, setQ] = useState('');
  if (!data) return <Topbar title="AI 어드바이저" back />;
  const summary = [
    `순자산 ${shortWon(data.book.valueKrw)}, 총자산 ${shortWon(data.book.assetsKrw)}, 부채 ${shortWon(data.book.liabilitiesKrw)}, 현금 ${shortWon(data.book.cashKrw)}, 넣은 돈 ${shortWon(data.book.investedKrw)}.`,
    ...data.book.holdings.slice(0, 40).map((h) => `- ${h.asset.name}${h.asset.symbol ? `(${h.asset.symbol})` : ''} ${ASSET_TYPE_LABEL[h.asset.type]}: ${qty(h.qty)}, 평가 ${shortWon(h.valueKrw)}, 손익 ${shortWon(h.pnlKrw)}`),
  ].join('\n');
  const ask = () =>
    act.run(async () => {
      const question = q.trim();
      if (!question) return;
      const key = await getSetting<string>('anthropicKey', '');
      setTurns((t) => [...t, { role: 'user', text: question }]);
      setQ('');
      try {
        const answer = await askAdvisor(key, summary, turns, question);
        setTurns((t) => [...t, { role: 'assistant', text: answer }]);
      } catch (e) {
        setTurns((t) => t.slice(0, -1));
        setQ(question);
        throw e;
      }
    });
  return (
    <>
      <Topbar title="AI 어드바이저" back />
      <div className="page">
        <p className="sub">내 Anthropic API 키로 이 폰에서 바로 묻습니다(비용은 키 주인에게). 보유 자산 요약을 함께 보냅니다. 서버를 연동하면 리서치·코치·아침 브리핑이 있는 서버의 어드바이저를 쓸 수 있습니다.</p>
        <div className="chat">
          {turns.map((t, i) => (
            <div key={i} className={`bubble ${t.role === 'user' ? 'me' : 'ai'}`}>{t.text}</div>
          ))}
          {act.busy && <div className="bubble ai sub">생각하는 중…</div>}
        </div>
        <Msg {...act.msg} />
        <section className="card form">
          <textarea className="input" rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 내 자산 배분에서 가장 위험한 부분은?" aria-label="질문" />
          <button className="btn primary" disabled={act.busy || !q.trim()} onClick={ask}>묻기</button>
        </section>
      </div>
    </>
  );
}

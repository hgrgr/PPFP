import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ServerLink } from '~/core/server';
import { useSetting } from '../hooks';
import { Icon, Topbar } from '../kit';

function Item({ to, icon, title, sub, badge }: { to: string; icon: ReactNode; title: string; sub: string; badge?: ReactNode }) {
  return (
    <Link to={to} className="row">
      {icon}
      <div className="grow">
        <span className="name">
          {title} {badge}
        </span>
        <span className="sub">{sub}</span>
      </div>
      <span className="chev">›</span>
    </Link>
  );
}

export function More() {
  const link = useSetting<ServerLink | null>('server', null);
  return (
    <>
      <Topbar title="더보기" />
      <div className="page">
        <section className="card flush menu">
          <div className="list">
            <Item to="/net-worth" icon={Icon.scale} title="순자산 · 대출" sub="재무상태표, 대출 상환 일정" />
            <Item to="/goals" icon={Icon.target} title="목표" sub="은퇴·주택 자금 시뮬레이션" />
            <Item to="/tax" icon={Icon.receipt} title="세금 · 배당" sub="올해 양도소득, 금융소득 추정" />
            <Item to="/txns" icon={Icon.list} title="거래 내역" sub="모든 거래, 지우기" />
            <Item to="/portfolios" icon={Icon.folder} title="포트폴리오" sub="만들기, 이름, 보관" />
          </div>
        </section>
        <section className="card flush menu">
          <div className="list">
            <Item to="/notes" icon={Icon.note} title="메모" sub="투자 아이디어, #키워드" />
            <Item to="/journals" icon={Icon.book} title="매매일지" sub="목표가·손절가와 근거" />
            <Item to="/notices" icon={Icon.bell} title="알림함" sub="가격 알림, 서버 알림" />
            <Item to="/advisor" icon={Icon.spark} title="AI 어드바이저" sub="내 API 키로 묻기" />
          </div>
        </section>
        <section className="card flush menu">
          <div className="list">
            <Item to="/backup" icon={Icon.lock} title="백업 · 복원" sub="암호로 잠근 파일을 구글 드라이브 등에" />
            <Item to="/files" icon={Icon.file} title="파일로 내보내기 · 가져오기" sub="웹 앱과 같은 CSV 형식" />
            <Item to="/keys" icon={Icon.key} title="시세 연결 · API 키" sub="한국투자증권, Anthropic" />
            <Item to="/server" icon={Icon.server} title="서버 연동" sub={link ? link.url : '연결하면 실시간 알림 등이 열립니다'} badge={link ? <span className="badge ok">연결됨</span> : null} />
            <Item to="/about" icon={Icon.info} title="앱 정보 · 데이터 지우기" sub="되는 일과 안 되는 일" />
          </div>
        </section>
      </div>
    </>
  );
}

import type { ReactElement } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { Icon } from './kit';
import { Home } from './screens/Home';
import { AssetDetail, Holdings } from './screens/Holdings';
import { Record } from './screens/Record';
import { More } from './screens/More';
import { Portfolios, Txns } from './screens/Portfolios';
import { Goals, NetWorth, Tax } from './screens/Money';
import { Advisor, JournalEdit, Journals, Notes, Notices } from './screens/Notes';
import { About, Backup, Files, Keys, Server } from './screens/Settings';

function Tabs() {
  const tab = (to: string, icon: ReactElement, label: string, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
      {icon}
      {label}
    </NavLink>
  );
  return (
    <nav className="tabs" aria-label="주요 화면">
      {tab('/', Icon.home, '홈', true)}
      {tab('/holdings', Icon.pie, '자산')}
      {tab('/record', Icon.plus, '기록')}
      {tab('/more', Icon.more, '더보기')}
    </nav>
  );
}

export function App() {
  return (
    <HashRouter>
      <div className="app">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/holdings" element={<Holdings />} />
          <Route path="/asset/:id" element={<AssetDetail />} />
          <Route path="/record" element={<Record />} />
          <Route path="/txns" element={<Txns />} />
          <Route path="/portfolios" element={<Portfolios />} />
          <Route path="/more" element={<More />} />
          <Route path="/net-worth" element={<NetWorth />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/tax" element={<Tax />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/journals" element={<Journals />} />
          <Route path="/journals/:id" element={<JournalEdit />} />
          <Route path="/notices" element={<Notices />} />
          <Route path="/advisor" element={<Advisor />} />
          <Route path="/backup" element={<Backup />} />
          <Route path="/files" element={<Files />} />
          <Route path="/keys" element={<Keys />} />
          <Route path="/server" element={<Server />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<Home />} />
        </Routes>
        <Tabs />
      </div>
    </HashRouter>
  );
}

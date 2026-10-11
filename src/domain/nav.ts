/**
 * The left menu: every screen, in order, and which of them a user has hidden. Hidden screens
 * stay one click away under 숨긴 메뉴 at the bottom of the menu, and keep working by address.
 */
export interface NavItem {
  href: string;
  label: string;
  /** Always shown: the way back to settings must not be hidden */
  locked?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: '대시보드', locked: true },
  { href: '/performance', label: '성과 분석' },
  { href: '/market', label: '실시간 시세' },
  { href: '/portfolios', label: '포트폴리오' },
  { href: '/assets', label: '보유 자산' },
  { href: '/import', label: '보유종목 가져오기' },
  { href: '/transactions', label: '거래 내역' },
  { href: '/tax', label: '세금' },
  { href: '/dividends', label: '배당' },
  { href: '/goals', label: '목표' },
  { href: '/journal', label: '매매일지' },
  { href: '/traits', label: '자산 성질' },
  { href: '/notes', label: '투자 노트' },
  { href: '/ai', label: 'AI 어드바이저' },
  { href: '/alerts', label: '알림' },
  { href: '/data', label: '가져오기 · 내보내기' },
  { href: '/usage', label: '사용량 · 비용' },
  { href: '/help', label: '사용설명서' },
  { href: '/settings', label: '연동 · 설정', locked: true },
];

/** Only known, hideable hrefs, each once */
export function cleanHidden(hrefs: Iterable<string>): string[] {
  const hideable = new Set(NAV_ITEMS.filter((i) => !i.locked).map((i) => i.href));
  return [...new Set([...hrefs].filter((h) => hideable.has(h)))];
}

/** The menu split into what shows and what waits under 숨긴 메뉴, both in menu order. */
export function splitNav(hidden: readonly string[]): { shown: NavItem[]; hidden: NavItem[] } {
  const set = new Set(cleanHidden(hidden));
  return { shown: NAV_ITEMS.filter((i) => !set.has(i.href)), hidden: NAV_ITEMS.filter((i) => set.has(i.href)) };
}

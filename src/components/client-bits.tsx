'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function PrivacyToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(document.documentElement.dataset.privacy === 'on'), []);
  return (
    <button
      type="button"
      className="btn"
      aria-pressed={on}
      onClick={() => {
        const next = !on;
        setOn(next);
        if (next) document.documentElement.dataset.privacy = 'on';
        else delete document.documentElement.dataset.privacy;
        try {
          localStorage.setItem('ppfp-privacy', next ? 'on' : 'off');
        } catch {}
      }}
    >
      {on ? '금액 보이기' : '금액 가리기'}
    </button>
  );
}

/** Re-render server data periodically while the tab is visible (prices are cached server-side). */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = path === href || (href !== '/' && path.startsWith(href + '/'));
  return (
    <a className="nav" href={href} aria-current={active ? 'page' : undefined}>
      {children}
    </a>
  );
}

/** Portfolio scope selector that keeps the other query params. */
export function ScopeSelect({ options, value }: { options: { id: string; label: string }[]; value: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  return (
    <label className="field" style={{ minWidth: 220 }}>
      <span className="sub">보기 범위</span>
      <select
        value={value}
        onChange={(e) => {
          const q = new URLSearchParams(params.toString());
          if (e.target.value) q.set('p', e.target.value);
          else q.delete('p');
          router.push(`${path}?${q.toString()}`);
        }}
      >
        <option value="">순자산 전체</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

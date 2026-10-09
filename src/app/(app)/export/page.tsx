import { redirect } from 'next/navigation';

/** Moved to 가져오기 · 내보내기; old links (and bookmarks) keep their scope. */
export default async function ExportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries({ p: sp.p, from: sp.from, to: sp.to }).filter(([, v]) => v) as [string, string][]);
  redirect(`/data${q.toString() ? `?${q}` : ''}`);
}

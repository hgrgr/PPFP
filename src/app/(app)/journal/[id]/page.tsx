import { readPrefs } from '@/domain/indicators';
import { notFound } from 'next/navigation';
import { JournalEntryForm } from '@/components/journal/entry-form';
import { requireUser } from '@/server/auth';
import { getJournal, journalAssets, journalFormats } from '@/server/services/journal';

export const metadata = { title: '매매일지' };
export const dynamic = 'force-dynamic';

export default async function JournalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [entry, formats] = await Promise.all([getJournal(user.id, id), journalFormats(user.id)]);
  if (!entry) notFound();
  // The entry's own asset stays pickable even if it was taken out of every portfolio
  const assets = await journalAssets(user.id, { include: [entry.assetId] });
  const ap = readPrefs(user.analysisPrefs);
  return <JournalEntryForm entry={entry} assets={assets} formats={formats} indicatorPrefs={{ region: ap.region, incomeBase: ap.incomeBase, years: ap.years }} />;
}

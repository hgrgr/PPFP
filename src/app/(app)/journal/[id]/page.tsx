import { notFound } from 'next/navigation';
import { JournalEntryForm } from '@/components/journal/entry-form';
import { requireUser } from '@/server/auth';
import { getJournal, journalAssets, journalFormats } from '@/server/services/journal';

export const metadata = { title: '매매일지' };
export const dynamic = 'force-dynamic';

export default async function JournalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [entry, assets, formats] = await Promise.all([getJournal(user.id, id), journalAssets(user.id), journalFormats(user.id)]);
  if (!entry) notFound();
  return <JournalEntryForm entry={entry} assets={assets} formats={formats} />;
}

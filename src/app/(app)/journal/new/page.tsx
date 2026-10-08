import { JournalEntryForm, type Prefill } from '@/components/journal/entry-form';
import { requireUser } from '@/server/auth';
import { journalAssets, journalFormats, txnContext } from '@/server/services/journal';

export const metadata = { title: '새 매매일지' };
export const dynamic = 'force-dynamic';

export default async function NewJournalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [assets, formats, txn] = await Promise.all([journalAssets(user.id), journalFormats(user.id), sp.txn ? txnContext(user.id, sp.txn) : null]);
  const prefill: Prefill = txn
    ? { assetId: txn.assetId, txnId: txn.txnId, txnType: txn.type, price: txn.price, date: txn.date, format: sp.format }
    : { assetId: assets.some((a) => a.id === sp.asset) ? sp.asset : undefined, format: sp.format };
  if (!assets.length) {
    return (
      <div className="card">
        <h1>매매일지</h1>
        <p>일지는 종목에 대해 씁니다. 먼저 포트폴리오에 종목을 추가하거나 보유종목을 가져오세요.</p>
        <div className="inline">
          <a className="btn primary" href="/portfolios">포트폴리오</a>
          <a className="btn" href="/import">보유종목 가져오기</a>
        </div>
      </div>
    );
  }
  return <JournalEntryForm entry={null} assets={assets} formats={formats} prefill={prefill} />;
}

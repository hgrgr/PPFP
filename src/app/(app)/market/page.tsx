import { addWatchAction, removeWatchAction } from '@/app/actions';
import { MarketBoard } from '@/components/market-board';
import { cleanSymbol } from '@/domain/broker-format';
import { requireUser } from '@/server/auth';

export const metadata = { title: '실시간 시세' };
export const dynamic = 'force-dynamic';

export default async function MarketPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await requireUser();
  const { s } = await searchParams;
  return <MarketBoard initialSymbol={s ? cleanSymbol(s) : null} watchAction={addWatchAction} unwatchAction={removeWatchAction} />;
}

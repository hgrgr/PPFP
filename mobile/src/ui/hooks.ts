import { liveQuery } from 'dexie';
import { useEffect, useMemo, useState } from 'react';
import { Dec } from '@/domain/decimal';
import { replayBook, type BookView } from '~/core/book';
import { db } from '~/core/db';
import { DEFAULT_USDKRW, type FxSetting } from '~/core/prices';
import type { Asset, Portfolio, Txn } from '~/core/types';

/** A Dexie query that re-runs when the tables it reads change. Undefined while loading. */
export function useLive<T>(query: () => Promise<T> | T, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: (e) => console.error('[live]', e) });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export interface BookData {
  book: BookView;
  portfolios: Portfolio[];
  assets: Asset[];
  txns: Txn[];
  fx: FxSetting | null;
  usdKrw: Dec;
}

/** Everything replayed: what most screens read. */
export function useBook(): BookData | undefined {
  const raw = useLive(async () => {
    const [portfolios, assets, txns, fx] = await Promise.all([db.portfolios.toArray(), db.assets.toArray(), db.txns.toArray(), db.settings.get('usdkrw')]);
    return { portfolios, assets, txns, fx: (fx?.value as FxSetting | undefined) ?? null };
  });
  return useMemo(() => {
    if (!raw) return undefined;
    const usdKrw = Dec.of(raw.fx?.rate ?? DEFAULT_USDKRW);
    return { ...raw, usdKrw, book: replayBook(raw.portfolios, raw.assets, raw.txns, usdKrw) };
  }, [raw]);
}

export function useSetting<T>(key: string, fallback: T): T {
  const row = useLive(() => db.settings.get(key), [key]);
  return row === undefined ? fallback : (row.value as T);
}

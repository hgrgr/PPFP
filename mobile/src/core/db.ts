/**
 * The phone's database: IndexedDB through Dexie. It lives in the app's private storage,
 * which Android keeps away from other apps; the backup file (backup.ts) is how it leaves.
 */
import Dexie, { type Table } from 'dexie';
import type { Asset, DayValue, Goal, Journal, Loan, Note, Notice, Portfolio, PriceAlert, Setting, Txn } from './types';

export class PpfpDb extends Dexie {
  portfolios!: Table<Portfolio, string>;
  assets!: Table<Asset, string>;
  txns!: Table<Txn, string>;
  notes!: Table<Note, string>;
  journals!: Table<Journal, string>;
  loans!: Table<Loan, string>;
  goals!: Table<Goal, string>;
  alerts!: Table<PriceAlert, string>;
  notices!: Table<Notice, string>;
  days!: Table<DayValue, string>;
  settings!: Table<Setting, string>;

  constructor(name = 'ppfp') {
    super(name);
    this.version(1).stores({
      portfolios: 'id, name',
      assets: 'id, symbol, type',
      txns: 'id, portfolioId, assetId, tradeAt, serverId',
      notes: 'id, createdAt',
      journals: 'id, assetId, createdAt',
      loans: 'id, assetId',
      goals: 'id',
      alerts: 'id, assetId',
      notices: 'id, at',
      days: 'date',
      settings: 'key',
    });
  }
}

export const db = new PpfpDb();

/** Every table, in the order a restore writes them */
export const TABLES = ['portfolios', 'assets', 'txns', 'notes', 'journals', 'loans', 'goals', 'alerts', 'notices', 'days', 'settings'] as const;
export type TableName = (typeof TABLES)[number];

export const newId = () => {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

export const nowIso = () => new Date().toISOString();

/** Today in Korea, YYYY-MM-DD */
export const kstToday = (d = new Date()) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

export async function getSetting<T>(key: string, fallback: T, store: PpfpDb = db): Promise<T> {
  const row = await store.settings.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown, store: PpfpDb = db) {
  await store.settings.put({ key, value });
}

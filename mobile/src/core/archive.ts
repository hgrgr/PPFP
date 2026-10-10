/** The whole phone database in and out: the backup payload, and CSV sheets. */
import { csvCell, parseCsv } from '@/domain/csv';
import { detectSheet, headersOf, SHEETS, type Row, type SheetKey } from '@/domain/data-format';
import { db, TABLES, type TableName } from './db';
import { fromSheets, toSheets, type Sheets } from './sheets';
import { localData } from './sync';

/** Settings that are not carried to another phone: a short-lived token, and the server sign-in (sign in again there) */
const NOT_BACKED_UP = new Set(['kisToken', 'server', 'serverNoticeAfter']);

export interface Payload {
  app: 'ppfp-mobile';
  schema: 1;
  tables: Partial<Record<TableName, unknown[]>>;
}

export async function backupPayload(): Promise<Payload> {
  const tables: Payload['tables'] = {};
  for (const t of TABLES) {
    const rows = await db.table(t).toArray();
    tables[t] = t === 'settings' ? rows.filter((r: { key: string }) => !NOT_BACKED_UP.has(r.key)) : rows;
  }
  return { app: 'ppfp-mobile', schema: 1, tables };
}

/** Replaces everything on the phone with the backup (the server link stays). */
export async function restorePayload(p: Payload) {
  if (p?.app !== 'ppfp-mobile' || !p.tables) throw new Error('PPFP 앱 백업이 아닙니다.');
  const keep = await db.settings.where('key').anyOf([...NOT_BACKED_UP]).toArray();
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      const rows = (p.tables[t] ?? []) as object[];
      if (rows.length) await db.table(t).bulkAdd(rows);
    }
    await db.settings.bulkPut(keep);
  });
  return Object.fromEntries(TABLES.map((t) => [t, (p.tables[t] ?? []).length])) as Record<TableName, number>;
}

export async function wipeAll() {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) await db.table(t).clear();
  });
}

const toCsvText = (key: SheetKey, rows: Row[]) => {
  const headers = headersOf(key);
  // UTF-8 BOM so Excel reads Korean
  return '﻿' + [headers.map(csvCell).join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h] ?? '')).join(','))].join('\r\n') + '\r\n';
};

/** One CSV per sheet, named as the web app names them */
export async function exportCsvs(): Promise<{ key: SheetKey; name: string; text: string; rows: number }[]> {
  const s = toSheets(await localData());
  return (Object.keys(s) as SheetKey[]).map((key) => ({ key, name: `ppfp-${SHEETS[key].name}.csv`, text: toCsvText(key, s[key] ?? []), rows: (s[key] ?? []).length }));
}

/** A CSV from the app, the web app or a spreadsheet: its kind is found from the header. */
export async function importCsv(text: string) {
  const table = parseCsv(text.replace(/^﻿/, ''));
  const [head = [], ...body] = table;
  const headers = head.map((h) => h.trim());
  const key = detectSheet(headers);
  if (!key) throw new Error('알 수 없는 표입니다. 첫 줄이 PPFP 형식의 열 이름이어야 합니다.');
  const rows: Row[] = body.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  const sheets: Sheets = { [key]: rows };
  const r = fromSheets(sheets, await localData());
  await db.transaction('rw', [db.portfolios, db.assets, db.txns, db.notes, db.journals], async () => {
    await db.portfolios.bulkPut(r.data.portfolios);
    await db.assets.bulkAdd(r.data.assets);
    await db.txns.bulkAdd(r.data.txns);
    await db.notes.bulkAdd(r.data.notes);
    await db.journals.bulkAdd(r.data.journals);
  });
  return { key, name: SHEETS[key].name, added: r.data.txns.length + r.data.notes.length + r.data.journals.length + r.data.portfolios.length, problems: r.problems, skipped: r.skipped };
}

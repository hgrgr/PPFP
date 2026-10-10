/**
 * Moving data between the phone and a linked PPFP server, without making doubles:
 * - 보내기: trades the server has not seen (no server id) go up through its import; then the
 *   server's export is read back and each sent trade learns its server id.
 * - 가져오기: the server's trades the phone has not seen come down with their ids.
 * Notes and journals are sent once each (remembered by id).
 */
import { Dec } from '@/domain/decimal';
import type { Row } from '@/domain/data-format';
import { db, getSetting, setSetting } from './db';
import { exportFromServer, importToServer, type ImportSheetReport, type ServerLink } from './server';
import { fromSheets, toSheets, type LocalData, type Sheets } from './sheets';

const norm = (v: string | undefined) => {
  const t = (v ?? '').replace(/,/g, '').trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Dec.of(t).toString() : t;
};

/** What identifies a trade in both the phone's rows and the server's export */
export const rowKey = (r: Row) =>
  [(r['일시'] ?? '').slice(0, 16), r['포트폴리오'], r['유형'], r['종목코드'] || r['자산 이름'], norm(r['수량']), norm(r['단가']), norm(r['금액'])].join('|');

export async function localData(): Promise<LocalData> {
  const [portfolios, assets, txns, notes, journals] = await Promise.all([db.portfolios.toArray(), db.assets.toArray(), db.txns.toArray(), db.notes.toArray(), db.journals.toArray()]);
  return { portfolios, assets, txns, notes, journals };
}

export interface SendPlan {
  sheets: Sheets;
  txns: number;
  notes: number;
  journals: number;
}

/** What 보내기 would send. */
export async function planSend(): Promise<SendPlan> {
  const d = await localData();
  const sentNotes = new Set(await getSetting<string[]>('sentNotes', []));
  const sentJournals = new Set(await getSetting<string[]>('sentJournals', []));
  const unsent: LocalData = {
    ...d,
    txns: d.txns.filter((t) => !t.serverId),
    notes: d.notes.filter((n) => !sentNotes.has(n.id)),
    journals: d.journals.filter((j) => !sentJournals.has(j.id)),
  };
  const sheets = toSheets(unsent);
  return { sheets, txns: sheets.transactions?.length ?? 0, notes: sheets.notes?.length ?? 0, journals: sheets.journals?.length ?? 0 };
}

export async function send(link: ServerLink, commit: boolean): Promise<{ reports: ImportSheetReport[]; matched: number }> {
  const plan = await planSend();
  const { report } = await importToServer(link, plan.sheets, commit);
  if (!commit) return { reports: report.sheets, matched: 0 };
  const d = await localData();
  // Learn the server's ids for what was just sent
  const server = await exportFromServer(link);
  const idByKey = new Map<string, string[]>();
  for (const r of server.sheets.transactions ?? []) {
    const id = r['거래 ID'];
    if (!id) continue;
    const k = rowKey(r);
    idByKey.set(k, [...(idByKey.get(k) ?? []), id]);
  }
  const taken = new Set(d.txns.map((t) => t.serverId).filter(Boolean) as string[]);
  const mine = toSheets({ ...d, txns: d.txns.filter((t) => !t.serverId) }).transactions ?? [];
  const unsent = d.txns.filter((t) => !t.serverId).sort((a, b) => (a.tradeAt < b.tradeAt ? -1 : a.tradeAt > b.tradeAt ? 1 : a.createdAt < b.createdAt ? -1 : 1));
  let matched = 0;
  await db.transaction('rw', db.txns, async () => {
    for (let i = 0; i < unsent.length; i++) {
      const ids = idByKey.get(rowKey(mine[i])) ?? [];
      const id = ids.find((x) => !taken.has(x));
      if (!id) continue;
      taken.add(id);
      await db.txns.update(unsent[i].id, { serverId: id });
      matched++;
    }
  });
  await setSetting('sentNotes', d.notes.map((n) => n.id));
  await setSetting('sentJournals', d.journals.map((j) => j.id));
  await setSetting('lastSentAt', new Date().toISOString());
  return { reports: report.sheets, matched };
}

/** Takes the server's data the phone does not have yet. */
export async function receive(link: ServerLink): Promise<{ portfolios: number; assets: number; txns: number; notes: number; journals: number; skipped: number; problems: number }> {
  const server = await exportFromServer(link);
  const d = await localData();
  const r = fromSheets(server.sheets, d);
  await db.transaction('rw', [db.portfolios, db.assets, db.txns, db.notes, db.journals], async () => {
    await db.portfolios.bulkPut([...r.data.portfolios, ...d.portfolios.filter((p) => r.data.portfolios.every((x) => x.id !== p.id))]);
    await db.assets.bulkAdd(r.data.assets);
    await db.txns.bulkAdd(r.data.txns);
    await db.notes.bulkAdd(r.data.notes);
    await db.journals.bulkAdd(r.data.journals);
  });
  // What came from the server is not sent back
  await setSetting('sentNotes', [...(await getSetting<string[]>('sentNotes', [])), ...r.data.notes.map((n) => n.id)]);
  await setSetting('sentJournals', [...(await getSetting<string[]>('sentJournals', [])), ...r.data.journals.map((j) => j.id)]);
  await setSetting('lastReceivedAt', new Date().toISOString());
  return { portfolios: r.data.portfolios.length, assets: r.data.assets.length, txns: r.data.txns.length, notes: r.data.notes.length, journals: r.data.journals.length, skipped: r.skipped, problems: r.problems.length };
}

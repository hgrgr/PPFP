import { NextResponse } from 'next/server';
import { SHEET_KEYS, type SheetKey } from '@/domain/data-format';
import { isDate } from '@/domain/period';
import { currentUser } from '@/server/auth';
import { kstDate, prisma } from '@/server/db';
import { exportSheet, guideTable } from '@/server/services/data-io';
import { buildTable, DATASETS, tablesToXlsx, tableToCsv, type Dataset, type Table } from '@/server/services/export';
import { audit } from '@/server/services/portfolios';

export const dynamic = 'force-dynamic';

/**
 * Downloads. A data sheet (portfolios, transactions, journals, notes…) in the import format,
 * `all` for every one of them in one XLSX with the 안내 sheet, a report (holdings, lots,
 * realized, snapshots), or `reports` for all reports.
 */
export async function GET(req: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { dataset } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  const p = url.searchParams.get('p');
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  const opts = {
    portfolioId: p && (await prisma.portfolio.count({ where: { id: p, userId: user.id } })) ? p : null,
    from: isDate(from) ? from : undefined,
    to: isDate(to) ? to : undefined,
  };

  const sheets: SheetKey[] = dataset === 'all' ? [...SHEET_KEYS] : (SHEET_KEYS as readonly string[]).includes(dataset) ? [dataset as SheetKey] : [];
  const reports: Dataset[] = dataset === 'reports' ? (Object.keys(DATASETS) as Dataset[]) : dataset in DATASETS ? [dataset as Dataset] : [];
  if (!sheets.length && !reports.length) return NextResponse.json({ error: 'unknown dataset' }, { status: 404 });
  if ((dataset === 'all' || dataset === 'reports') && format === 'csv') return NextResponse.json({ error: 'use xlsx for several datasets' }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tables: Table<any>[] = dataset === 'all' ? [guideTable()] : [];
  for (const k of sheets) tables.push(await exportSheet(user.id, k, opts));
  for (const k of reports) tables.push(await buildTable(user.id, k, opts));
  await audit(prisma, user.id, 'export', dataset, 'download', undefined, { format, ...opts });

  const base = `ppfp-${dataset}-${kstDate()}`;
  if (format === 'csv') {
    return new NextResponse(tableToCsv(tables[0]), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${base}.csv"`, 'Cache-Control': 'no-store' },
    });
  }
  const buf = await tablesToXlsx(tables);
  return new NextResponse(new Uint8Array(buf), {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${base}.xlsx"`, 'Cache-Control': 'no-store' },
  });
}

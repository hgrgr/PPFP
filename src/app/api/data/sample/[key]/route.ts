import { NextResponse } from 'next/server';
import { SHEET_KEYS, type SheetKey } from '@/domain/data-format';
import { guideTable, sampleTable } from '@/server/services/data-io';
import { tablesToXlsx, tableToCsv } from '@/server/services/export';

export const dynamic = 'force-dynamic';

/** Sample files for the import format: one sheet as CSV / XLSX, or `all` as an XLSX with the 안내 sheet. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const format = new URL(req.url).searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
  const keys: SheetKey[] = key === 'all' ? [...SHEET_KEYS] : (SHEET_KEYS as readonly string[]).includes(key) ? [key as SheetKey] : [];
  if (!keys.length) return NextResponse.json({ error: 'unknown sample' }, { status: 404 });
  if (key === 'all' && format === 'csv') return NextResponse.json({ error: 'use xlsx for all sheets' }, { status: 400 });
  const name = `ppfp-sample-${key}`;
  if (format === 'csv') {
    return new NextResponse(tableToCsv(sampleTable(keys[0])), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` } });
  }
  const buf = await tablesToXlsx([guideTable(), ...keys.map(sampleTable)]);
  return new NextResponse(new Uint8Array(buf), {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}.xlsx"` },
  });
}

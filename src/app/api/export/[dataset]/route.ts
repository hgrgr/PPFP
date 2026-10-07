import { NextResponse } from 'next/server';
import { isDate } from '@/domain/period';
import { currentUser } from '@/server/auth';
import { kstDate, prisma } from '@/server/db';
import { audit } from '@/server/services/portfolios';
import { buildTable, DATASETS, tablesToXlsx, tableToCsv, type Dataset } from '@/server/services/export';

export const dynamic = 'force-dynamic';

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

  const keys: Dataset[] = dataset === 'all' ? (Object.keys(DATASETS) as Dataset[]) : dataset in DATASETS ? [dataset as Dataset] : [];
  if (!keys.length) return NextResponse.json({ error: 'unknown dataset' }, { status: 404 });
  if (dataset === 'all' && format === 'csv') return NextResponse.json({ error: 'use xlsx for all datasets' }, { status: 400 });

  const tables = [];
  for (const k of keys) tables.push(await buildTable(user.id, k, opts));
  await audit(prisma, user.id, 'export', dataset, 'download', undefined, { format, ...opts });

  const stamp = kstDate();
  const base = `ppfp-${dataset}-${stamp}`;
  if (format === 'csv') {
    return new NextResponse(tableToCsv(tables[0]), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${base}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  const buf = await tablesToXlsx(tables);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${base}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}

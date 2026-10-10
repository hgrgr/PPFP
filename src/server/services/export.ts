/**
 * Report exports (holdings, lots, realized gains, daily snapshots) as CSV (Excel-compatible,
 * UTF-8 BOM) or XLSX, honouring the scope portfolio and date range. The data that can be
 * imported again (portfolios, transactions, journals, notes) is exported by data-io.
 */
import { toCsv, type Column } from '@/domain/csv';
import { TXN_LABEL } from '@/domain/ledger';
import { LOT_METHOD_LABEL } from '@/domain/lots';
import { effectiveWeights } from '@/domain/portfolio-graph';
import { dec, kstDate, kstIso, prisma } from '../db';
import { ASSET_TYPE_LABEL } from './assets';
import { userGraph } from './portfolios';

export const DATASETS = {
  holdings: '보유 종목',
  lots: 'Lot',
  realized: '실현손익',
  snapshots: '일별 스냅샷',
} as const;
export type Dataset = keyof typeof DATASETS;

type Row = Record<string, string | number | null>;

export interface Table<R = Row> {
  name: string;
  columns: Column<R>[];
  rows: R[];
  /** Headers of long-text columns: wider and wrapped in XLSX */
  wide?: string[];
}

const col = (header: string, key: string): Column<Row> => ({ header, value: (r) => r[key] });
const kst = (d: Date) => kstIso(d).slice(0, 19).replace('T', ' ');

export async function buildTable(
  userId: string,
  dataset: Dataset,
  opts: { portfolioId?: string | null; from?: string; to?: string },
): Promise<Table> {
  const { portfolios, edges } = await userGraph(userId);
  const ids = opts.portfolioId ? [...effectiveWeights(edges, opts.portfolioId).keys()] : portfolios.map((p) => p.id);
  const names = new Map(portfolios.map((p) => [p.id, p.name]));
  const fromD = opts.from ? new Date(Date.parse(opts.from + 'T00:00:00+09:00')) : undefined;
  const toD = opts.to ? new Date(Date.parse(opts.to + 'T23:59:59.999+09:00')) : undefined;
  const between = fromD || toD ? { gte: fromD, lte: toD } : undefined;

  switch (dataset) {
    case 'holdings':
    case 'lots': {
      const holdings = await prisma.holding.findMany({
        where: { portfolioId: { in: ids } },
        include: { asset: true, lots: { orderBy: { acquiredAt: 'asc' } } },
      });
      if (dataset === 'holdings') {
        const rows: Row[] = holdings.map((h) => {
          const open = h.lots.filter((l) => dec(l.qtyRemaining).isPos());
          const qty = open.reduce((a, l) => a.add(dec(l.qtyRemaining)), dec(0));
          const cost = open.reduce((a, l) => a.add(dec(l.qtyRemaining).mul(dec(l.unitCost))), dec(0));
          return {
            portfolio: names.get(h.portfolioId) ?? '',
            asset: h.asset.name,
            symbol: h.asset.symbol,
            type: ASSET_TYPE_LABEL[h.asset.type],
            currency: h.asset.currency,
            qty: qty.toString(),
            avgCost: qty.isZero() ? '' : cost.div(qty).toFixed(4),
            costTotal: cost.toFixed(2),
            openLots: open.length,
          };
        });
        return {
          name: DATASETS.holdings,
          rows,
          columns: [
            col('포트폴리오', 'portfolio'), col('자산', 'asset'), col('종목코드', 'symbol'), col('유형', 'type'), col('통화', 'currency'),
            col('수량', 'qty'), col('평균단가(수수료 포함)', 'avgCost'), col('취득원가', 'costTotal'), col('보유 Lot 수', 'openLots'),
          ],
        };
      }
      const rows: Row[] = holdings.flatMap((h) =>
        h.lots
          .filter((l) => (!fromD || l.acquiredAt >= fromD) && (!toD || l.acquiredAt <= toD))
          .map((l) => ({
            lotId: l.id,
            portfolio: names.get(h.portfolioId) ?? '',
            asset: h.asset.name,
            symbol: h.asset.symbol,
            acquiredAt: kst(l.acquiredAt),
            qtyOriginal: dec(l.qtyOriginal).toString(),
            qtyRemaining: dec(l.qtyRemaining).toString(),
            unitCost: dec(l.unitCost).toString(),
            currency: h.asset.currency,
            fxRate: dec(l.fxRate).toString(),
          })),
      );
      return {
        name: DATASETS.lots,
        rows,
        columns: [
          col('Lot ID', 'lotId'), col('포트폴리오', 'portfolio'), col('자산', 'asset'), col('종목코드', 'symbol'), col('취득일시(KST)', 'acquiredAt'),
          col('취득수량', 'qtyOriginal'), col('잔여수량', 'qtyRemaining'), col('단가(수수료 포함)', 'unitCost'), col('통화', 'currency'), col('취득 환율', 'fxRate'),
        ],
      };
    }
    case 'realized': {
      const cons = await prisma.lotConsumption.findMany({
        where: { txn: { portfolioId: { in: ids }, tradeAt: between } },
        include: { txn: { include: { holding: { include: { asset: true } } } }, lot: true },
        orderBy: { txn: { tradeAt: 'asc' } },
      });
      const rows: Row[] = cons.map((c) => ({
        soldAt: kst(c.txn.tradeAt),
        portfolio: names.get(c.txn.portfolioId) ?? '',
        asset: c.txn.holding?.asset.name ?? '',
        symbol: c.txn.holding?.asset.symbol ?? '',
        lotId: c.lotId,
        acquiredAt: kst(c.lot.acquiredAt),
        holdingDays: c.holdingDays,
        qty: dec(c.qty).toString(),
        cost: dec(c.cost).toString(),
        proceeds: dec(c.proceeds).toString(),
        pnl: dec(c.pnl).toString(),
        currency: c.txn.currency,
        pnlKrw: dec(c.pnlBase).toFixed(0),
        method: c.txn.lotMethod ? LOT_METHOD_LABEL[c.txn.lotMethod] : '',
      }));
      return {
        name: DATASETS.realized,
        rows,
        columns: [
          col('매도일시(KST)', 'soldAt'), col('포트폴리오', 'portfolio'), col('자산', 'asset'), col('종목코드', 'symbol'), col('Lot ID', 'lotId'),
          col('취득일시', 'acquiredAt'), col('보유일수', 'holdingDays'), col('수량', 'qty'), col('취득원가', 'cost'), col('순매도금액', 'proceeds'),
          col('실현손익', 'pnl'), col('통화', 'currency'), col('실현손익(원화, 환차 포함)', 'pnlKrw'), col('Lot 방식', 'method'),
        ],
      };
    }
    case 'snapshots': {
      const snaps = await prisma.snapshot.findMany({
        where: {
          portfolioId: { in: ids },
          date: opts.from || opts.to ? { gte: opts.from ? new Date(opts.from) : undefined, lte: opts.to ? new Date(opts.to) : undefined } : undefined,
        },
        orderBy: [{ date: 'asc' }, { portfolioId: 'asc' }],
      });
      const rows: Row[] = snaps.map((s) => ({
        date: kstDate(s.date),
        portfolio: names.get(s.portfolioId) ?? '',
        value: dec(s.value).toFixed(0),
        cash: dec(s.cash).toFixed(0),
        flow: dec(s.flow).toFixed(0),
      }));
      return {
        name: DATASETS.snapshots,
        rows,
        columns: [col('날짜', 'date'), col('포트폴리오', 'portfolio'), col('직접 보유 평가액(원)', 'value'), col('현금(원)', 'cash'), col('외부 입출금(원)', 'flow')],
      };
    }
  }
}

export function tableToCsv<R>(t: Table<R>): string {
  return toCsv(t.rows, t.columns);
}

/** Tables of any row shape, one sheet each. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function tablesToXlsx(tables: Table<any>[]): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PPFP';
  for (const t of tables) {
    const ws = wb.addWorksheet(t.name.slice(0, 31));
    ws.addRow(t.columns.map((c) => c.header));
    ws.getRow(1).font = { bold: true };
    for (const r of t.rows) {
      ws.addRow(
        t.columns.map((c) => {
          const v = c.value(r);
          if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && !/^-?0\d/.test(v) && v.replace(/[-.]/g, '').length <= 15) return Number(v);
          return v as string | number | null;
        }),
      );
    }
    ws.columns.forEach((c, i) => {
      const wide = t.wide?.includes(t.columns[i]?.header ?? '');
      c.width = wide ? 48 : 16;
      if (wide) c.alignment = { wrapText: true, vertical: 'top' };
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

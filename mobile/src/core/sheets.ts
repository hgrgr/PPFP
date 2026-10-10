/**
 * The phone's records as the web app's import sheets (src/domain/data-format), and back.
 * The same rows go to a PPFP server's import, come from its export, and fill the CSV files
 * the 더보기 › 파일 screen writes, so data moves between the app, a server and a spreadsheet.
 */
import { ASSET_TYPES as SHEET_ASSET_TYPES, parseSheet, type Row, type SheetKey } from '@/domain/data-format';
import { LOT_METHOD_LABEL } from '@/domain/lots';
import { TXN_LABEL } from '@/domain/ledger';
import { newId, nowIso } from './db';
import type { Asset, AssetType, Journal, Note, Portfolio, Txn } from './types';

/** "2026-03-02 10:30" in Korean time */
export const kstText = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
};

export interface LocalData {
  portfolios: Portfolio[];
  assets: Asset[];
  txns: Txn[];
  notes: Note[];
  journals: Journal[];
}

export type Sheets = Partial<Record<SheetKey, Row[]>>;

export function toSheets(d: LocalData): Sheets {
  const assets = new Map(d.assets.map((a) => [a.id, a]));
  const pname = new Map(d.portfolios.map((p) => [p.id, p.name]));
  const portfolios: Row[] = d.portfolios.map((p) => ({ 이름: p.name, 'Lot 방식': LOT_METHOD_LABEL[p.lotMethod], 보관: p.archived ? 'Y' : 'N' }));
  const transactions: Row[] = [...d.txns]
    .sort((a, b) => (a.tradeAt < b.tradeAt ? -1 : a.tradeAt > b.tradeAt ? 1 : a.createdAt < b.createdAt ? -1 : 1))
    .filter((t) => t.type !== 'REPAY')
    .map((t) => {
      const a = t.assetId ? assets.get(t.assetId) : undefined;
      const hasQty = t.type === 'BUY' || t.type === 'SELL';
      return {
        일시: kstText(t.tradeAt),
        포트폴리오: pname.get(t.portfolioId) ?? '',
        유형: TXN_LABEL[t.type],
        종목코드: a?.symbol ?? '',
        '자산 이름': a?.name ?? '',
        '자산 유형': a && !a.symbol ? SHEET_ASSET_TYPES[a.type] : '',
        통화: t.currency,
        수량: hasQty ? (t.qty ?? '') : t.type === 'SPLIT' ? (t.ratio ?? '') : '',
        단가: hasQty || t.type === 'VALUATION' ? (t.price ?? '') : '',
        금액: !hasQty && t.type !== 'SPLIT' && t.type !== 'VALUATION' ? (t.amount ?? '') : '',
        수수료: hasQty && t.fee !== '0' ? t.fee : '',
        세금: hasQty && t.tax !== '0' ? t.tax : '',
        환율: t.currency === 'USD' ? (t.fxRate ?? '') : '',
        '현금 사용': hasQty ? (t.useCash ? 'Y' : 'N') : '',
        'Lot 방식': t.type === 'SELL' && t.lotMethod ? LOT_METHOD_LABEL[t.lotMethod] : '',
        메모: t.memo,
        '거래 ID': t.serverId ?? '',
      };
    });
  const notes: Row[] = d.notes.map((n) => ({ 작성일: kstText(n.createdAt).slice(0, 10), 본문: n.body, 고정: n.pinned ? 'Y' : 'N' }));
  const journals: Row[] = d.journals
    .filter((j) => j.assetId && assets.get(j.assetId))
    .map((j) => {
      const a = assets.get(j.assetId!)!;
      return {
        제목: j.title,
        종목코드: a.symbol ?? '',
        '자산 이름': a.name,
        '자산 유형': a.symbol ? '' : SHEET_ASSET_TYPES[a.type],
        통화: a.currency,
        작성일: kstText(j.createdAt).slice(0, 10),
        상태: j.status === 'CLOSED' ? '종료' : '진행 중',
        '목표 예상 가격': j.targetPrice,
        '기준 가격': j.basePrice ?? '',
        손절가: j.stopPrice ?? '',
        '목표 기한': j.dueDate ?? '',
        본문: j.body,
      };
    });
  return { portfolios, transactions, notes, journals };
}

export interface SheetProblem {
  sheet: SheetKey;
  line: number;
  message: string;
}

/** Guesses the asset type of a listed symbol the way the server does. */
const listedType = (symbol: string): AssetType => (/^KRW-/.test(symbol) ? 'CRYPTO' : /^[0-9][0-9A-Z]{5}$/.test(symbol) ? 'KR_STOCK' : 'US_STOCK');

/**
 * Sheets (from a server export or a CSV) as new local records. Assets are matched by symbol,
 * or by name for hand-valued ones; trades whose 거래 ID is already on the phone are skipped.
 */
export function fromSheets(sheets: Sheets, existing: LocalData): { data: LocalData; problems: SheetProblem[]; skipped: number } {
  const problems: SheetProblem[] = [];
  const now = nowIso();
  const portfolios = new Map(existing.portfolios.map((p) => [p.name, p]));
  const assetKey = (a: { symbol: string | null; name: string }) => (a.symbol ? `s:${a.symbol}` : `n:${a.name}`);
  const assets = new Map(existing.assets.map((a) => [assetKey(a), a]));
  const knownServerIds = new Set(existing.txns.map((t) => t.serverId).filter(Boolean));
  const out: LocalData = { portfolios: [], assets: [], txns: [], notes: [], journals: [] };
  let skipped = 0;

  const portfolio = (name: string) => {
    let p = portfolios.get(name);
    if (!p) {
      p = { id: newId(), name, lotMethod: 'FIFO', archived: false, createdAt: now };
      portfolios.set(name, p);
      out.portfolios.push(p);
    }
    return p;
  };
  const asset = (ref: { symbol: string | null; name: string | null; type: string | null; currency: 'KRW' | 'USD' }) => {
    const name = ref.name ?? ref.symbol ?? '';
    const key = assetKey({ symbol: ref.symbol, name });
    let a = assets.get(key);
    if (!a) {
      a = { id: newId(), type: (ref.type as AssetType | null) ?? listedType(ref.symbol ?? ''), symbol: ref.symbol, name, currency: ref.currency, price: null, priceAt: null, priceSource: null, createdAt: now };
      assets.set(key, a);
      out.assets.push(a);
    }
    return a;
  };

  for (const r of parseSheet('portfolios', sheets.portfolios ?? [])) {
    if (r.error) problems.push({ sheet: 'portfolios', line: r.line, message: r.error });
    else if (r.record) {
      const p = portfolio(r.record.name);
      if (r.record.lotMethod) p.lotMethod = r.record.lotMethod;
      p.archived = r.record.archived;
    }
  }
  for (const r of parseSheet('transactions', sheets.transactions ?? [])) {
    if (r.error || !r.record) {
      problems.push({ sheet: 'transactions', line: r.line, message: r.error ?? '읽지 못했습니다.' });
      continue;
    }
    const t = r.record as typeof r.record & { id?: string | null };
    if (t.id && knownServerIds.has(t.id)) {
      skipped++;
      continue;
    }
    const a = t.asset ? asset(t.asset) : null;
    out.txns.push({
      id: newId(),
      portfolioId: portfolio(t.portfolio).id,
      assetId: a?.id ?? null,
      type: t.type,
      tradeAt: t.at.toISOString(),
      qty: t.type === 'SPLIT' ? null : (t.qty ?? null),
      price: t.price ?? null,
      amount: t.amount ?? null,
      fee: t.fee ?? '0',
      tax: t.tax ?? '0',
      currency: t.currency,
      fxRate: t.fxRate ?? null,
      useCash: t.useCash,
      ratio: t.type === 'SPLIT' ? (t.qty ?? null) : null,
      lotMethod: t.lotMethod,
      memo: t.memo,
      createdAt: now,
      serverId: t.id ?? null,
    });
  }
  for (const r of parseSheet('notes', sheets.notes ?? [])) {
    if (r.error || !r.record) problems.push({ sheet: 'notes', line: r.line, message: r.error ?? '읽지 못했습니다.' });
    else if (!existing.notes.some((n) => n.body === r.record!.body)) out.notes.push({ id: newId(), body: r.record.body, pinned: r.record.pinned, createdAt: r.record.date ? `${r.record.date}T00:00:00+09:00` : now });
  }
  for (const r of parseSheet('journals', sheets.journals ?? [])) {
    if (r.error || !r.record) {
      problems.push({ sheet: 'journals', line: r.line, message: r.error ?? '읽지 못했습니다.' });
      continue;
    }
    const j = r.record;
    if (existing.journals.some((x) => x.title === j.title)) {
      skipped++;
      continue;
    }
    out.journals.push({
      id: newId(),
      assetId: asset(j.asset).id,
      title: j.title,
      status: j.closed ? 'CLOSED' : 'OPEN',
      targetPrice: j.targetPrice,
      basePrice: j.basePrice ?? null,
      stopPrice: j.stopPrice ?? null,
      dueDate: j.targetDate ?? null,
      body: j.body,
      createdAt: j.entryDate ? `${j.entryDate}T00:00:00+09:00` : now,
    });
  }
  return { data: out, problems, skipped };
}

/**
 * Bringing brokerage holdings into portfolios.
 *
 * Each source (a linked account, or a pasted table labelled by the user) is
 * compared with the opening lots previously imported from that same source,
 * so importing again only suggests what is new. Imported positions become one
 * opening lot per stock at the broker's average price, funded from outside the
 * portfolio (a contribution, not a cash purchase). Nothing is written without
 * the user choosing rows and portfolios.
 */
import { Dec } from '@/domain/decimal';
import { cleanSymbol, isKrSymbol } from '@/domain/broker-format';
import { parseHoldingsText } from '@/domain/holdings-paste';
import { BROKERS, isCryptoBroker, type BrokerId } from '@/lib/brokers';
import { dec, prisma } from '../db';
import { fxRate } from '../market';
import { BrokerApiError, type BrokerHolding } from '../brokers';
import { ensureListedAsset } from './assets';
import { adapterFor, listConnections, markStatus, marketProviders, sourceKey } from './brokers';
import { ownedPortfolio, UserError } from './portfolios';
import { recordBuy } from './trading';

export interface ImportRow {
  symbol: string;
  name: string;
  currency: 'KRW' | 'USD';
  market: string | null;
  /** Quantity at the broker (or in the pasted table) */
  brokerQty: string;
  avgPrice: string;
  lastPrice: string | null;
  /** Still held from earlier imports of this source */
  importedQty: string;
  /** Held in the app overall, any source */
  ledgerQty: string;
  /** brokerQty - importedQty, floored at zero */
  suggestedQty: string;
}

export interface ImportSource {
  key: string;
  label: string;
  broker: BrokerId | null;
  connectionId: string | null;
  error: string | null;
  rows: ImportRow[];
}

interface RawRow {
  symbol: string;
  name: string;
  currency: 'KRW' | 'USD';
  market: string | null;
  qty: string;
  avgPrice: string;
  lastPrice: string | null;
}

/** Remaining quantity per symbol: from lots imported from `key`, and from all lots. */
async function heldQuantities(userId: string, key: string) {
  const lots = await prisma.lot.findMany({
    where: { qtyRemaining: { gt: 0 }, holding: { portfolio: { userId }, asset: { symbol: { not: null } } } },
    select: { qtyRemaining: true, holding: { select: { asset: { select: { symbol: true } } } }, sourceTxn: { select: { importSource: true } } },
  });
  const imported = new Map<string, Dec>();
  const ledger = new Map<string, Dec>();
  for (const l of lots) {
    const s = l.holding.asset.symbol!.toUpperCase();
    const q = dec(l.qtyRemaining);
    ledger.set(s, (ledger.get(s) ?? Dec.ZERO).add(q));
    if (l.sourceTxn.importSource === key) imported.set(s, (imported.get(s) ?? Dec.ZERO).add(q));
  }
  return { imported, ledger };
}

async function annotate(userId: string, key: string, raw: RawRow[]): Promise<ImportRow[]> {
  const { imported, ledger } = await heldQuantities(userId, key);
  return raw.map((r) => {
    const s = r.symbol.toUpperCase();
    const brokerQty = Dec.of(r.qty);
    const done = imported.get(s) ?? Dec.ZERO;
    const left = brokerQty.sub(done);
    return {
      symbol: s,
      name: r.name,
      currency: r.currency,
      market: r.market,
      brokerQty: brokerQty.toString(),
      avgPrice: r.avgPrice,
      lastPrice: r.lastPrice,
      importedQty: done.toString(),
      ledgerQty: (ledger.get(s) ?? Dec.ZERO).toString(),
      suggestedQty: left.isPos() ? left.toString() : '0',
    };
  });
}

const fromBroker = (h: BrokerHolding): RawRow => ({
  symbol: h.symbol,
  name: h.name,
  currency: h.currency,
  market: h.market,
  qty: h.quantity,
  avgPrice: h.averagePrice,
  lastPrice: h.lastPrice,
});

/** Current holdings of every linked account, side by side with what was already imported. */
export async function loadBrokerSources(userId: string): Promise<ImportSource[]> {
  // Crypto exchanges replay their full history instead (services/exchange-sync), so their holdings are not offered here.
  const conns = (await listConnections(userId)).filter((c) => !isCryptoBroker(c.broker));
  return Promise.all(
    conns.map(async (c) => {
      const key = sourceKey(c);
      const base = { key, label: c.label, broker: c.broker, connectionId: c.id };
      try {
        const holdings = await adapterFor(c).holdings();
        await markStatus(c.id, null);
        return { ...base, error: null, rows: await annotate(userId, key, holdings.map(fromBroker)) };
      } catch (e) {
        const msg = e instanceof BrokerApiError ? e.message : `${BROKERS[c.broker].label} 보유종목을 가져오지 못했습니다.`;
        if (!(e instanceof BrokerApiError)) console.error('[imports]', c.broker, e);
        await markStatus(c.id, msg);
        return { ...base, error: msg, rows: [] };
      }
    }),
  );
}

/**
 * Text of an uploaded balance file: .xlsx (first sheet, tab-separated) or CSV/TSV in
 * UTF-8 or EUC-KR, which is what most Korean trading apps export.
 */
export async function uploadedTableText(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip || /\.xlsx$/i.test(file.name)) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    } catch {
      throw new UserError('엑셀 파일을 읽지 못했습니다. .xlsx 형식인지 확인하거나 CSV로 저장해 올리세요.');
    }
    const sheet = wb.worksheets[0];
    if (!sheet) return '';
    const lines: string[] = [];
    sheet.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      lines.push(values.map((v) => (v && typeof v === 'object' && 'result' in v ? String(v.result ?? '') : v && typeof v === 'object' && 'text' in v ? String(v.text) : String(v ?? ''))).join('\t'));
    });
    return lines.join('\n');
  }
  if (/\.xls$/i.test(file.name)) throw new UserError('예전 엑셀(.xls) 형식은 읽지 못합니다. .xlsx나 CSV로 저장해 올리세요.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('euc-kr').decode(buf);
  }
}

export function pasteSourceKey(label: string) {
  return `paste:${label.trim().slice(0, 30)}`;
}

/** Parse a pasted table and fill in missing names from the linked brokers. */
export async function readPastedHoldings(userId: string, label: string, text: string): Promise<{ source: ImportSource; errors: string[] }> {
  const name = label.trim().slice(0, 30);
  if (!name) throw new UserError('어느 증권사 잔고인지 이름을 입력하세요. 같은 이름으로 다시 가져오면 이미 가져온 수량을 빼고 보여줍니다.');
  if (text.length > 200_000) throw new UserError('붙여넣은 내용이 너무 깁니다.');
  const { rows, errors } = parseHoldingsText(text);

  const known = await prisma.asset.findMany({ where: { userId, symbol: { in: rows.map((r) => r.symbol) } }, select: { symbol: true, name: true, market: true } });
  const byKnown = new Map(known.map((a) => [a.symbol!, a]));
  const providers = rows.some((r) => !r.name && !byKnown.has(r.symbol)) ? await marketProviders(userId) : [];
  let lookups = 0;
  const raw: RawRow[] = [];
  for (const r of rows) {
    let display = r.name ?? byKnown.get(r.symbol)?.name ?? null;
    let market = byKnown.get(r.symbol)?.market ?? (isKrSymbol(r.symbol) ? 'KRX' : null);
    if (!display && lookups < 40) {
      for (const { adapter } of providers) {
        if (!adapter.instrument) continue;
        lookups++;
        const info = await adapter.instrument(r.symbol).catch(() => null);
        if (info) {
          display = info.name;
          market = info.market;
          break;
        }
      }
    }
    raw.push({ symbol: r.symbol, name: display ?? r.symbol, currency: r.currency, market, qty: r.qty, avgPrice: r.avgPrice, lastPrice: null });
  }
  const key = pasteSourceKey(name);
  return { source: { key, label: name, broker: null, connectionId: null, error: null, rows: await annotate(userId, key, raw) }, errors };
}

export interface ImportSelection {
  symbol: string;
  name: string;
  currency: string;
  market: string | null;
  qty: string;
  price: string;
  portfolioId: string;
}

/** Create one opening lot per selected row. Returns how many were created. */
export async function importHoldings(
  userId: string,
  input: { sourceKey: string; sourceLabel: string; tradeAt: Date; rows: ImportSelection[] },
): Promise<number> {
  const key = input.sourceKey.trim();
  const fromApi = !key.startsWith('paste:');
  if (!key || key.length > 80) throw new UserError('가져올 출처가 올바르지 않습니다.');
  if (fromApi) {
    const conns = await listConnections(userId);
    if (!conns.some((c) => sourceKey(c) === key)) throw new UserError('연결된 계좌를 찾을 수 없습니다. 화면을 새로 고치세요.');
  }
  if (!input.rows.length) throw new UserError('가져올 종목을 하나 이상 선택하세요.');
  if (input.rows.length > 300) throw new UserError('한 번에 300종목까지 가져올 수 있습니다.');
  if (input.tradeAt.getTime() > Date.now() + 60_000) throw new UserError('취득 기준 일시는 미래일 수 없습니다.');

  // Validate everything before writing anything.
  const portfolios = new Set<string>();
  const clean = input.rows.map((r, i) => {
    const symbol = cleanSymbol(r.symbol);
    if (!symbol) throw new UserError(`${i + 1}번째 행: 종목 코드가 올바르지 않습니다.`);
    let qty: Dec;
    let price: Dec;
    try {
      qty = Dec.of(r.qty);
      price = Dec.of(r.price);
    } catch {
      throw new UserError(`${symbol}: 수량과 단가를 숫자로 입력하세요.`);
    }
    if (!qty.isPos()) throw new UserError(`${symbol}: 가져올 수량은 0보다 커야 합니다.`);
    if (price.isNeg()) throw new UserError(`${symbol}: 평균단가는 0 이상이어야 합니다.`);
    if (!r.portfolioId) throw new UserError(`${symbol}: 넣을 포트폴리오를 고르세요.`);
    const currency = r.currency === 'USD' ? 'USD' : 'KRW';
    portfolios.add(r.portfolioId);
    return { ...r, symbol, qty, price, currency: currency as 'KRW' | 'USD', name: (r.name || symbol).trim().slice(0, 80) };
  });
  for (const id of portfolios) await ownedPortfolio(userId, id);

  const usd = clean.some((r) => r.currency === 'USD') ? await fxRate(userId, 'USD') : Dec.ONE;
  const memo = `${input.sourceLabel.slice(0, 40)}에서 가져온 시작 Lot (증권사 평균단가)`;
  // Resolve every asset first so a bad symbol stops the import before any lot is written.
  const assets = [];
  for (const r of clean) {
    const asset = await ensureListedAsset(userId, r.symbol, { name: r.name, currency: r.currency, market: r.market });
    if (asset.currency !== r.currency) throw new UserError(`${r.symbol}: 이미 ${asset.currency} 종목으로 등록되어 있습니다.`);
    assets.push(asset);
  }
  let created = 0;
  for (const [i, r] of clean.entries()) {
    const asset = assets[i];
    await recordBuy(userId, {
      portfolioId: r.portfolioId,
      assetId: asset.id,
      tradeAt: input.tradeAt,
      qty: r.qty.toString(),
      price: r.price.toString(),
      fxRate: r.currency === 'USD' ? usd.toString() : undefined,
      fromCash: false,
      memo,
      importSource: key,
    });
    await prisma.holding.update({
      where: { portfolioId_assetId: { portfolioId: r.portfolioId, assetId: asset.id } },
      data: { qtySource: fromApi ? 'BROKER' : 'IMPORT' },
    });
    created++;
  }
  return created;
}

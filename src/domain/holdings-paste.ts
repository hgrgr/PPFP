/**
 * Reads a holdings table copied from a brokerage app (HTS/MTS/web) or saved
 * as CSV, for brokers without an OpenAPI. Tolerant of tabs, commas, quoted
 * cells, thousands separators and unit suffixes; needs a stock code column.
 */
import { Dec } from './decimal';
import { cleanSymbol, isKrSymbol, krSymbol } from './broker-format';

export interface PastedHolding {
  symbol: string;
  name: string | null;
  currency: 'KRW' | 'USD';
  qty: string;
  avgPrice: string;
}

export interface PasteResult {
  rows: PastedHolding[];
  errors: string[];
}

type Field = 'symbol' | 'name' | 'qty' | 'price' | 'amount' | 'currency';

/** Which column a header cell names. Order matters: "종목코드" must not be read as "종목". */
function headerField(cell: string): Field | null {
  const h = cell.toLowerCase().replace(/\(.*?\)|\[.*?\]|\s/g, '');
  if (!h) return null;
  if (/코드|종목번호|심볼|티커|^symbol$|^ticker$|^code$/.test(h)) return 'symbol';
  if (/통화|^currency$|^ccy$/.test(h)) return 'currency';
  if (/단가|평균가|평단|매입가|매수가|^avg|^average|^cost$|^price$/.test(h)) return 'price';
  if (/매입금액|매수금액|원금|^costbasis$|^amount$/.test(h)) return 'amount';
  if (/수량|잔고|보유량|주식수|^qty$|^quantity$|^shares$/.test(h)) return 'qty';
  if (/종목명|상품명|^종목$|^name$/.test(h)) return 'name';
  return null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function splitLine(line: string, delimiter: 'tab' | 'comma' | 'space'): string[] {
  const cells = delimiter === 'tab' ? line.split('\t') : delimiter === 'comma' ? splitCsvLine(line) : line.trim().split(/\s{2,}|\s+(?=\S)/);
  return cells.map((c) => c.trim());
}

/** "1,234주" / "$12.50" / "70,000원" -> "1234" / "12.5" / "70000"; null when not a number. */
export function pastedNumber(cell: string): string | null {
  const s = cell.replace(/[,\s원주$₩]|USD|KRW|株/gi, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  try {
    return Dec.of(s).toString();
  } catch {
    return null;
  }
}

function currencyOf(cell: string | undefined): 'KRW' | 'USD' | null {
  if (!cell) return null;
  const s = cell.trim().toUpperCase();
  if (/^(USD|\$|달러|미국달러|US)$/.test(s)) return 'USD';
  if (/^(KRW|₩|원|원화)$/.test(s)) return 'KRW';
  return null;
}

function symbolOf(cell: string): string | null {
  const kr = krSymbol(cell.replace(/\.(KS|KQ)$/i, ''));
  if (kr) return kr;
  const s = cleanSymbol(cell);
  // US tickers: letters, optionally one class suffix (BRK.B)
  return s && /^[A-Z]{1,6}([.-][A-Z]{1,2})?$/.test(s) ? s : null;
}

const SUMMARY_RE = /^(합계|총계|소계|계|total|sum)$/i;

export function parseHoldingsText(text: string): PasteResult {
  const errors: string[] = [];
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l, i) => ({ line: l, no: i + 1 }))
    .filter((l) => l.line.trim());
  if (!lines.length) return { rows: [], errors: ['붙여넣은 내용이 없습니다.'] };

  const sample = lines.slice(0, 5).map((l) => l.line).join('\n');
  const delimiter = sample.includes('\t') ? 'tab' : sample.includes(',') ? 'comma' : 'space';

  // Header: the first line in which at least two cells name known columns, one of them the code.
  let columns: (Field | null)[] | null = null;
  let start = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const fields = splitLine(lines[i].line, delimiter).map(headerField);
    if (fields.includes('symbol') && fields.filter(Boolean).length >= 2) {
      columns = fields;
      start = i + 1;
      break;
    }
  }

  const merged = new Map<string, { row: PastedHolding; cost: Dec }>();
  for (const { line, no } of lines.slice(start)) {
    const cells = splitLine(line, delimiter);
    let symbolCell: string | undefined;
    let name: string | null = null;
    let qty: string | null = null;
    let price: string | null = null;
    let amount: string | null = null;
    let currency: 'KRW' | 'USD' | null = null;

    if (columns) {
      for (let i = 0; i < columns.length; i++) {
        const f = columns[i];
        const c = cells[i] ?? '';
        if (f === 'symbol' && symbolCell === undefined) symbolCell = c;
        else if (f === 'name' && !name) name = c || null;
        else if (f === 'qty' && qty === null) qty = pastedNumber(c);
        else if (f === 'price' && price === null) price = pastedNumber(c);
        else if (f === 'amount' && amount === null) amount = pastedNumber(c);
        else if (f === 'currency' && !currency) currency = currencyOf(c);
      }
    } else {
      // No header: code first, then the first two numbers are quantity and average price.
      symbolCell = cells.find((c) => symbolOf(c)) ?? cells[0];
      const rest = cells.filter((c) => c !== symbolCell);
      const nums = rest.map(pastedNumber).filter((n): n is string => n !== null);
      [qty = null, price = null] = nums;
      name = rest.find((c) => pastedNumber(c) === null && !currencyOf(c)) ?? null;
      currency = rest.map(currencyOf).find(Boolean) ?? null;
    }

    const firstText = (symbolCell ?? cells[0] ?? '').trim();
    if (SUMMARY_RE.test(firstText) || (name && SUMMARY_RE.test(name))) continue;
    const symbol = symbolOf(symbolCell ?? '');
    if (!symbol) {
      errors.push(`${no}행: 종목코드를 읽지 못했습니다 (${firstText || '빈 칸'}). 국내는 6자리 코드, 해외는 티커가 필요합니다.`);
      continue;
    }
    const q = qty ? Dec.of(qty) : null;
    if (!q || !q.isPos()) {
      errors.push(`${no}행 ${symbol}: 보유수량을 읽지 못했습니다.`);
      continue;
    }
    let avg = price ? Dec.of(price) : null;
    if (!avg && amount) avg = Dec.of(amount).div(q);
    if (!avg || avg.isNeg()) {
      errors.push(`${no}행 ${symbol}: 평균단가(또는 매입금액)를 읽지 못했습니다.`);
      continue;
    }
    const ccy = currency ?? (isKrSymbol(symbol) ? 'KRW' : 'USD');
    const key = `${symbol}:${ccy}`;
    const prev = merged.get(key);
    if (prev) {
      // Same stock on two lines (e.g. cash and margin): one row, weighted average price.
      const totalQty = Dec.of(prev.row.qty).add(q);
      const cost = prev.cost.add(avg.mul(q));
      prev.row.qty = totalQty.toString();
      prev.row.avgPrice = cost.div(totalQty).round(6).toString();
      prev.cost = cost;
    } else {
      merged.set(key, { row: { symbol, name, currency: ccy, qty: q.toString(), avgPrice: avg.round(6).toString() }, cost: avg.mul(q) });
    }
  }
  const rows = [...merged.values()].map((m) => m.row);
  if (!rows.length && !errors.length) errors.push('읽을 수 있는 보유종목이 없습니다. 종목코드·수량·평균단가 열이 있는지 확인하세요.');
  return { rows, errors };
}

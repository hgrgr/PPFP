/**
 * Refreshing prices on the phone: coins from Upbit, stocks from 한국투자증권 with the user's
 * keys, the dollar rate from a free source. Afterwards the day's total is recorded for the
 * trend chart and price alerts are checked.
 */
import { Dec } from '@/domain/decimal';
import { replayBook } from './book';
import { db, getSetting, kstToday, nowIso, setSetting } from './db';
import { isCoin, kisQuotes, kisToken, upbitQuotes, usdKrw, type KisKeys, type KisToken, type Quote } from './market';
import { pushNotice } from './notify';

export interface FxSetting {
  rate: string;
  at: string;
  source: string;
}

export const DEFAULT_USDKRW = '1390';

export async function currentFx(): Promise<Dec> {
  const fx = await getSetting<FxSetting | null>('usdkrw', null);
  return Dec.of(fx?.rate ?? DEFAULT_USDKRW);
}

export interface RefreshResult {
  updated: number;
  failed: string[];
  notes: string[];
}

export async function refreshPrices(): Promise<RefreshResult> {
  const assets = await db.assets.toArray();
  const listed = assets.filter((a) => a.symbol && ['KR_STOCK', 'US_STOCK', 'CRYPTO'].includes(a.type));
  const notes: string[] = [];
  const failed: string[] = [];
  const quotes: Quote[] = [];

  const fx = await usdKrw().catch(() => null);
  if (fx) await setSetting('usdkrw', { rate: fx.rate, at: nowIso(), source: fx.source } satisfies FxSetting);
  else notes.push('환율을 받지 못해 지난 값을 씁니다.');

  const coins = listed.filter((a) => isCoin(a.symbol!)).map((a) => a.symbol!);
  if (coins.length) {
    try {
      quotes.push(...(await upbitQuotes(coins)));
    } catch (e) {
      notes.push(e instanceof Error ? e.message : '업비트 시세를 받지 못했습니다.');
    }
  }

  const stocks = listed.filter((a) => !isCoin(a.symbol!)).map((a) => a.symbol!);
  if (stocks.length) {
    const keys = await getSetting<KisKeys | null>('kis', null);
    if (!keys) notes.push('주식 시세를 받으려면 더보기 › 시세 연결에서 한국투자증권 키를 넣으세요. 그 전에는 직접 넣은 평가 가격을 씁니다.');
    else {
      try {
        const token = await kisToken(keys, await getSetting<KisToken | null>('kisToken', null));
        await setSetting('kisToken', token);
        const r = await kisQuotes(keys, token, stocks);
        quotes.push(...r.quotes);
        failed.push(...r.failed);
      } catch (e) {
        notes.push(e instanceof Error ? e.message : '한국투자증권 시세를 받지 못했습니다.');
      }
    }
  }

  const now = nowIso();
  const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
  let updated = 0;
  await db.transaction('rw', db.assets, async () => {
    for (const a of listed) {
      const q = bySymbol.get(a.symbol!);
      if (!q) continue;
      await db.assets.update(a.id, { price: q.price, priceAt: now, priceSource: q.source });
      updated++;
    }
  });
  await setSetting('pricesAt', now);
  await recordDay();
  await checkAlerts();
  return { updated, failed, notes };
}

/** Today's total for the trend chart (one row per day, the latest wins). */
export async function recordDay() {
  const [portfolios, assets, txns] = await Promise.all([db.portfolios.toArray(), db.assets.toArray(), db.txns.toArray()]);
  if (!txns.length) return;
  const book = replayBook(portfolios, assets, txns, await currentFx());
  await db.days.put({ date: kstToday(), value: book.valueKrw.toNumber(), invested: book.investedKrw.toNumber() });
}

/** Fires each active alert whose asset crossed its price, once, and turns it off. */
export async function checkAlerts() {
  const alerts = (await db.alerts.toArray()).filter((a) => a.active);
  if (!alerts.length) return 0;
  const assets = new Map((await db.assets.toArray()).map((a) => [a.id, a]));
  let fired = 0;
  for (const al of alerts) {
    const a = assets.get(al.assetId);
    if (!a?.price) continue;
    const p = Dec.of(a.price);
    const hit = al.direction === 'ABOVE' ? p.gte(al.price) : p.lte(al.price);
    if (!hit) continue;
    await db.alerts.update(al.id, { active: false, firedAt: nowIso() });
    await pushNotice({ kind: 'PRICE', title: `${a.name} ${al.direction === 'ABOVE' ? '이상' : '이하'} 도달`, body: `현재가 ${Number(a.price).toLocaleString('ko-KR')} ${a.currency === 'USD' ? '달러' : '원'} (알림 가격 ${Number(al.price).toLocaleString('ko-KR')})` });
    fired++;
  }
  return fired;
}

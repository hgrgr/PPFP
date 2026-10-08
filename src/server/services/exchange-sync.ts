/**
 * Replays a crypto exchange account into one portfolio: filled buys and sells
 * as BUY/SELL with their fees, KRW deposits and withdrawals as cash flows,
 * coin transfers in/out at that day's close. Whatever the account held before
 * the history starts becomes opening lots at the exchange's average price
 * (and an opening KRW deposit). Every record carries an external reference, so
 * syncing again only adds what is new.
 */
import type { LotMethod } from '@prisma/client';
import { Dec } from '@/domain/decimal';
import { cryptoSymbol } from '@/domain/broker-format';
import { coinDelta, openingBalances, sortEvents, type ExchangeBalance, type ExchangeEvent } from '@/domain/exchange-replay';
import { BROKERS, isCryptoBroker } from '@/lib/brokers';
import { dec, kstDate, prisma } from '../db';
import { BrokerApiError } from '../brokers';
import { ensureListedAsset } from './assets';
import { adapterFor, markStatus, sourceKey } from './brokers';
import { ownedPortfolio, UserError } from './portfolios';
import { rebuildSnapshots } from './snapshots';
import { recordBuy, recordCash, recordSell } from './trading';

const DUST = Dec.of('0.00000001');

export interface SyncSummary {
  since: string;
  until: string;
  trades: number;
  transfers: number;
  openings: number;
  skipped: number;
}

export async function syncExchangeHistory(userId: string, connectionId: string, opts: { portfolioId?: string; since?: Date } = {}): Promise<SyncSummary> {
  const conn = await prisma.brokerConnection.findFirst({ where: { id: connectionId, userId } });
  if (!conn) throw new UserError('연결을 찾을 수 없습니다.');
  if (!isCryptoBroker(conn.broker)) throw new UserError('거래내역 동기화는 코인 거래소 연결에서만 쓸 수 있습니다.');
  const portfolioId = conn.historyPortfolioId ?? opts.portfolioId;
  if (!portfolioId) throw new UserError('거래내역을 넣을 포트폴리오를 고르세요.');
  if (conn.historyPortfolioId && opts.portfolioId && opts.portfolioId !== conn.historyPortfolioId)
    throw new UserError('이 거래소는 이미 다른 포트폴리오로 동기화하고 있습니다. 같은 포트폴리오로만 이어서 가져올 수 있습니다.');
  const portfolio = await ownedPortfolio(userId, portfolioId);
  const method: LotMethod = portfolio.lotMethod === 'SPECIFIC' ? 'FIFO' : portfolio.lotMethod;

  const first = !conn.historySyncedTo;
  const until = new Date();
  // Later syncs overlap the last two hours; duplicates are skipped by reference.
  const requested = first ? (opts.since ?? new Date(until.getTime() - 365 * 86_400_000)) : new Date(conn.historySyncedTo!.getTime() - 2 * 3_600_000);
  if (requested >= until) throw new UserError('시작일은 오늘 이전이어야 합니다.');

  const adapter = adapterFor(conn);
  if (!adapter.balances || !adapter.history) throw new UserError('이 거래소는 거래내역 조회를 지원하지 않습니다.');
  let balances: ExchangeBalance[];
  let history: { since: Date; events: ExchangeEvent[] };
  try {
    balances = await adapter.balances();
    history = await adapter.history(requested, until);
  } catch (e) {
    const msg = e instanceof BrokerApiError ? e.message : `${BROKERS[conn.broker].label} 거래내역을 가져오지 못했습니다.`;
    await markStatus(conn.id, msg);
    throw new UserError(msg);
  }
  const events = sortEvents(history.events);
  const since = history.since;
  const prefix = conn.broker;
  const source = sourceKey(conn);
  const refOf = (e: ExchangeEvent) => `${prefix}:${e.kind}:${e.id}`;

  const existing = new Set(
    (await prisma.transaction.findMany({ where: { portfolioId, externalRef: { startsWith: `${prefix}:` } }, select: { externalRef: true } })).map((t) => t.externalRef!),
  );
  const avg = new Map(balances.map((b) => [b.currency.toUpperCase(), b.avgPrice]));

  // Names and asset rows per coin, resolved once
  const assets = new Map<string, Awaited<ReturnType<typeof ensureListedAsset>>>();
  const assetOf = async (coin: string) => {
    const c = coin.toUpperCase();
    if (!assets.has(c)) {
      const symbol = cryptoSymbol(c);
      const info = await adapter.instrument?.(symbol).catch(() => null);
      assets.set(c, await ensureListedAsset(userId, symbol, { name: info?.name ?? c, currency: 'KRW', market: 'CRYPTO' }));
    }
    return assets.get(c)!;
  };

  // Daily closes for valuing coin transfers, fetched once per coin
  const closes = new Map<string, Map<string, string>>();
  const closeOn = async (coin: string, at: string): Promise<string> => {
    const c = coin.toUpperCase();
    if (!closes.has(c)) {
      const list = await adapter.dailyCloses?.({ symbol: cryptoSymbol(c), market: 'CRYPTO' }, kstDate(since)).catch(() => []);
      closes.set(c, new Map((list ?? []).map((x) => [x.date, x.close])));
    }
    const day = kstDate(new Date(at));
    const series = closes.get(c)!;
    const onOrBefore = [...series.keys()].filter((d) => d <= day).sort().at(-1);
    return (onOrBefore && series.get(onOrBefore)) || avg.get(c) || '0';
  };

  const heldQty = async (assetId: string) => {
    const lots = await prisma.lot.findMany({ where: { holding: { portfolioId, assetId }, qtyRemaining: { gt: 0 } }, select: { qtyRemaining: true } });
    return Dec.sum(lots.map((l) => dec(l.qtyRemaining)));
  };

  /** Sell (or transfer out) more than the ledger holds: the gap was bought before the history starts. */
  const coverShortfall = async (coin: string, qty: Dec, at: string, price: string, ref: string) => {
    const asset = await assetOf(coin);
    const gap = qty.sub(await heldQty(asset.id));
    if (!gap.gt(DUST) || existing.has(`${ref}:fill`)) return;
    await recordBuy(userId, {
      portfolioId,
      assetId: asset.id,
      tradeAt: new Date(Date.parse(at) - 1000),
      qty: gap.round(8).toString(),
      price: avg.get(coin.toUpperCase()) ?? price,
      fromCash: false,
      memo: `${BROKERS[conn.broker].label}: 조회 기간 이전 보유분 보충`,
      externalRef: `${ref}:fill`,
      importSource: source,
    });
  };

  const summary: SyncSummary = { since: since.toISOString(), until: until.toISOString(), trades: 0, transfers: 0, openings: 0, skipped: 0 };
  const label = BROKERS[conn.broker].label;

  if (first) {
    const openAt = new Date(since.getTime() - 1000);
    for (const [currency, qty] of openingBalances(balances, events)) {
      if (!qty.gt(DUST)) continue;
      const ref = `${prefix}:open:${currency}`;
      if (existing.has(ref)) continue;
      if (currency === 'KRW') {
        if (!qty.round(0).isPos()) continue;
        await recordCash(userId, { portfolioId, type: 'DEPOSIT', amount: qty.round(0).toString(), currency: 'KRW', tradeAt: openAt, memo: `${label}: 시작 원화 잔고`, externalRef: ref, importSource: source });
      } else {
        const asset = await assetOf(currency);
        const price = avg.get(currency) ?? events.find((e) => e.currency === currency && e.price)?.price ?? '0';
        await recordBuy(userId, {
          portfolioId,
          assetId: asset.id,
          tradeAt: openAt,
          qty: qty.round(8).toString(),
          price,
          fromCash: false,
          memo: `${label}: 시작 보유분 (거래소 평균단가)`,
          externalRef: ref,
          importSource: source,
        });
      }
      summary.openings++;
    }
  }

  for (const e of events) {
    const ref = refOf(e);
    if (existing.has(ref)) {
      summary.skipped++;
      continue;
    }
    const at = new Date(e.at);
    const coin = e.currency.toUpperCase();
    if (e.kind === 'BUY') {
      const asset = await assetOf(coin);
      const net = coinDelta(e);
      if (!net.isPos()) continue;
      // A fee taken in coins is already reflected in the smaller quantity received
      const price = e.feeInCoin ? Dec.of(e.qty).mul(e.price!).div(net).round(8) : Dec.of(e.price!);
      await recordBuy(userId, {
        portfolioId,
        assetId: asset.id,
        tradeAt: at,
        qty: net.round(8).toString(),
        price: price.toString(),
        fee: e.feeInCoin ? '0' : e.fee,
        fromCash: true,
        memo: `${label} 매수`,
        externalRef: ref,
        importSource: source,
      });
      summary.trades++;
    } else if (e.kind === 'SELL') {
      const out = coinDelta(e).neg();
      await coverShortfall(coin, out, e.at, e.price!, ref);
      const asset = await assetOf(coin);
      const holding = await prisma.holding.findUnique({ where: { portfolioId_assetId: { portfolioId, assetId: asset.id } } });
      const price = e.feeInCoin ? Dec.of(e.qty).mul(e.price!).div(out).round(8) : Dec.of(e.price!);
      await recordSell(userId, {
        holdingId: holding!.id,
        tradeAt: at,
        qty: out.round(8).toString(),
        price: price.toString(),
        fee: e.feeInCoin ? '0' : e.fee,
        method,
        toCash: true,
        memo: `${label} 매도`,
        externalRef: ref,
      });
      summary.trades++;
    } else if (coin === 'KRW') {
      const amount = e.kind === 'DEPOSIT' ? Dec.of(e.qty).sub(e.fee) : Dec.of(e.qty);
      if (amount.isPos())
        await recordCash(userId, { portfolioId, type: e.kind, amount: amount.toString(), currency: 'KRW', tradeAt: at, memo: `${label} 원화 ${e.kind === 'DEPOSIT' ? '입금' : '출금'}`, externalRef: ref, importSource: source });
      if (e.kind === 'WITHDRAW' && Dec.of(e.fee).isPos())
        await recordCash(userId, { portfolioId, type: 'FEE', amount: e.fee, currency: 'KRW', tradeAt: at, memo: `${label} 출금 수수료`, externalRef: `${ref}:fee`, importSource: source });
      summary.transfers++;
    } else if (e.kind === 'DEPOSIT') {
      const qty = Dec.of(e.qty).sub(e.fee);
      if (!qty.isPos()) continue;
      const asset = await assetOf(coin);
      await recordBuy(userId, {
        portfolioId,
        assetId: asset.id,
        tradeAt: at,
        qty: qty.round(8).toString(),
        price: await closeOn(coin, e.at),
        fromCash: false,
        memo: `${label}: 외부에서 입고 (당일 종가 평가)`,
        externalRef: ref,
        importSource: source,
      });
      summary.transfers++;
    } else {
      // Coins sent out leave the portfolio at the day's value; the network fee goes with them
      const out = Dec.of(e.qty).add(e.fee);
      const price = await closeOn(coin, e.at);
      await coverShortfall(coin, out, e.at, price, ref);
      const asset = await assetOf(coin);
      const holding = await prisma.holding.findUnique({ where: { portfolioId_assetId: { portfolioId, assetId: asset.id } } });
      await recordSell(userId, { holdingId: holding!.id, tradeAt: at, qty: out.round(8).toString(), price, method, toCash: false, memo: `${label}: 외부로 출고 (당일 종가 평가)`, externalRef: ref });
      summary.transfers++;
    }
  }

  await prisma.brokerConnection.update({
    where: { id: conn.id },
    data: { historyPortfolioId: portfolioId, historySince: conn.historySince ?? since, historySyncedTo: until, lastSyncAt: new Date(), lastError: null },
  });
  const firstDay = [since.toISOString(), ...events.map((e) => e.at)].sort()[0];
  await rebuildSnapshots(userId, kstDate(new Date(firstDay)));
  return summary;
}

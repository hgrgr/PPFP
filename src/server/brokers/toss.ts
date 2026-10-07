/** 토스증권 Open API, adapted to the common broker interface. The HTTP client lives in ../toss/client. */
import { cleanSymbol, isKrSymbol, num, usMarketOf } from '@/domain/broker-format';
import { TossApiError, TossClient, type TossHoldingItem } from '../toss/client';
import { kstDate } from '../db';
import {
  BrokerApiError,
  type BrokerAdapter,
  type BrokerHolding,
  type ConnectionConfig,
  type DailyClose,
  type Instrument,
  type InstrumentRef,
  type PriceQuote,
  type TokenStore,
} from './types';

export function parseTossHoldings(items: TossHoldingItem[]): BrokerHolding[] {
  return items
    .filter((i) => num(i.quantity) !== '0')
    .map((i) => ({
      symbol: i.symbol.toUpperCase(),
      name: i.name || i.symbol,
      currency: i.currency,
      market: i.marketCountry === 'KR' ? 'KRX' : null,
      quantity: num(i.quantity),
      averagePrice: num(i.averagePurchasePrice),
      lastPrice: num(i.lastPrice),
    }));
}

function wrap(e: unknown): never {
  if (e instanceof TossApiError) throw new BrokerApiError(e.message, 'TOSS', e.status, e.code);
  throw e;
}

export class TossAdapter implements BrokerAdapter {
  readonly broker = 'TOSS' as const;
  private readonly client: TossClient;

  constructor(private readonly cfg: ConnectionConfig, store: TokenStore) {
    this.client = new TossClient({ clientId: cfg.appKey, clientSecret: cfg.secret }, store);
  }

  private async accountSeq(): Promise<number> {
    if (this.cfg.accountNo) return Number(this.cfg.accountNo);
    const accounts = await this.client.accounts();
    const seq = accounts.find((a) => a.accountType === 'BROKERAGE')?.accountSeq ?? accounts[0]?.accountSeq;
    if (seq === undefined) throw new BrokerApiError('토스증권에서 증권 계좌를 찾지 못했습니다.', 'TOSS', 404, 'no-account');
    return seq;
  }

  async verify() {
    try {
      await this.client.token(true);
      const accounts = await this.client.accounts();
      const seq = accounts.find((a) => a.accountType === 'BROKERAGE')?.accountSeq ?? accounts[0]?.accountSeq ?? null;
      return { accountNo: seq === null ? null : String(seq) };
    } catch (e) {
      wrap(e);
    }
  }

  async holdings(): Promise<BrokerHolding[]> {
    try {
      return parseTossHoldings((await this.client.holdings(await this.accountSeq())).items);
    } catch (e) {
      wrap(e);
    }
  }

  async quotes(refs: InstrumentRef[]): Promise<PriceQuote[]> {
    const symbols = refs.map((r) => cleanSymbol(r.symbol)).filter((s): s is string => !!s);
    if (!symbols.length) return [];
    try {
      const prices = await this.client.prices(symbols);
      return prices.map((p) => ({ symbol: p.symbol.toUpperCase(), price: num(p.lastPrice), currency: p.currency, market: null, asOf: p.timestamp }));
    } catch (e) {
      wrap(e);
    }
  }

  async instrument(symbol: string): Promise<Instrument | null> {
    try {
      const [info] = await this.client.stocks([symbol]);
      if (!info) return null;
      return {
        symbol,
        name: info.name,
        currency: info.currency,
        market: isKrSymbol(symbol) ? info.market : (usMarketOf(info.market) ?? info.market),
        englishName: info.englishName,
        delisted: info.status === 'DELISTED',
      };
    } catch (e) {
      wrap(e);
    }
  }

  async dailyCloses(ref: InstrumentRef, since: string): Promise<DailyClose[]> {
    try {
      const candles = await this.client.dailyCandles(ref.symbol, since);
      return candles.map((c) => ({ date: kstDate(new Date(c.timestamp)), close: num(c.closePrice) }));
    } catch (e) {
      wrap(e);
    }
  }

  async usdKrw(): Promise<string | null> {
    try {
      return num((await this.client.exchangeRate('USD', 'KRW')).midRate);
    } catch (e) {
      wrap(e);
    }
  }
}

import type { BrokerId } from '@/lib/brokers';
import { BithumbAdapter } from './bithumb';
import { CoinoneAdapter } from './coinone';
import { DbAdapter } from './db';
import { KisAdapter } from './kis';
import { KiwoomAdapter } from './kiwoom';
import { KorbitAdapter } from './korbit';
import { LsAdapter } from './ls';
import { MeritzAdapter } from './meritz';
import { TossAdapter } from './toss';
import { UpbitAdapter } from './upbit';
import type { BrokerAdapter, ConnectionConfig, TokenStore } from './types';

export * from './types';

/** Which linked broker to ask first for quotes, closes and FX: broadest coverage and most generous limits first. Exchanges only answer for coins. */
export const MARKET_DATA_ORDER: BrokerId[] = ['TOSS', 'KIS', 'KIWOOM', 'MERITZ', 'LS', 'DB', 'UPBIT', 'BITHUMB', 'COINONE', 'KORBIT'];

export function createAdapter(broker: BrokerId, cfg: ConnectionConfig, store: TokenStore): BrokerAdapter {
  switch (broker) {
    case 'TOSS':
      return new TossAdapter(cfg, store);
    case 'KIS':
      return new KisAdapter(cfg, store);
    case 'KIWOOM':
      return new KiwoomAdapter(cfg, store);
    case 'LS':
      return new LsAdapter(cfg, store);
    case 'DB':
      return new DbAdapter(cfg, store);
    case 'MERITZ':
      return new MeritzAdapter(cfg, store);
    case 'UPBIT':
      return new UpbitAdapter(cfg, store);
    case 'BITHUMB':
      return new BithumbAdapter(cfg, store);
    case 'COINONE':
      return new CoinoneAdapter(cfg, store);
    case 'KORBIT':
      return new KorbitAdapter(cfg, store);
  }
}

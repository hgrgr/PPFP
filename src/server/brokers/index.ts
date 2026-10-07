import type { BrokerId } from '@/lib/brokers';
import { DbAdapter } from './db';
import { KisAdapter } from './kis';
import { KiwoomAdapter } from './kiwoom';
import { LsAdapter } from './ls';
import { MeritzAdapter } from './meritz';
import { TossAdapter } from './toss';
import type { BrokerAdapter, ConnectionConfig, TokenStore } from './types';

export * from './types';

/** Which linked broker to ask first for quotes, closes and FX: broadest coverage and most generous limits first. */
export const MARKET_DATA_ORDER: BrokerId[] = ['TOSS', 'KIS', 'KIWOOM', 'MERITZ', 'LS', 'DB'];

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
  }
}

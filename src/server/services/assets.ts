import type { AssetType, Prisma } from '@prisma/client';
import { cleanSymbol, isCryptoSymbol } from '@/domain/broker-format';
import { prisma } from '../db';
import { BrokerApiError, type Instrument } from '../brokers';
import { kindOf, marketProviders } from './brokers';
import { audit, UserError } from './portfolios';

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  KR_STOCK: '국내 주식·ETF',
  US_STOCK: '해외 주식·ETF',
  CRYPTO: '가상자산',
  BOND: '채권',
  CASH: '현금·예금',
  REAL_ESTATE: '부동산',
  FUND: '펀드',
  ALTERNATIVE: '대안자산',
  LIABILITY: '부채',
};

export const MANUAL_TYPES: AssetType[] = ['BOND', 'CASH', 'REAL_ESTATE', 'FUND', 'ALTERNATIVE', 'LIABILITY', 'KR_STOCK', 'US_STOCK'];

/** What an account balance or pasted table already tells us about a symbol. */
export interface InstrumentHint {
  name: string;
  currency: 'KRW' | 'USD';
  market: string | null;
}

/**
 * Find or create a listed asset by symbol. A named hint from an account
 * balance is taken as is; otherwise the linked brokers are asked for the name
 * and market, falling back to the hint or to any broker that can price it.
 */
export async function ensureListedAsset(userId: string, rawSymbol: string, hint?: InstrumentHint) {
  const symbol = cleanSymbol(rawSymbol);
  if (!symbol) throw new UserError('종목 코드는 6자리 코드(국내) 또는 티커(해외)로 입력하세요.');
  const existing = await prisma.asset.findUnique({ where: { userId_symbol: { userId, symbol } } });
  if (existing) return existing;

  const providers = await marketProviders(userId, kindOf(symbol));
  // An account balance already names the stock: no lookup needed.
  let info: Instrument | null = hint && hint.name && hint.name !== symbol ? { symbol, ...hint } : null;
  let lastError: string | null = null;
  for (const { adapter } of providers) {
    if (info) break;
    if (!adapter.instrument) continue;
    try {
      info = await adapter.instrument(symbol);
      if (info) break;
    } catch (e) {
      lastError = e instanceof BrokerApiError ? e.message : lastError;
    }
  }
  if (!info && hint) info = { symbol, ...hint };
  if (!info) {
    // Brokers that only quote prices (no instrument lookup): accept the symbol if one of them prices it.
    for (const { adapter } of providers) {
      if (!adapter.quotes) continue;
      try {
        const [q] = await adapter.quotes([{ symbol, market: null }]);
        if (q) {
          info = { symbol, name: symbol, currency: q.currency, market: q.market };
          break;
        }
      } catch (e) {
        lastError = e instanceof BrokerApiError ? e.message : lastError;
      }
    }
  }
  if (!info) {
    if (!providers.length) throw new UserError('상장 종목을 추가하려면 먼저 설정에서 증권사 API를 연결하세요. 연결 없이 쓰려면 수기 자산으로 등록하거나 보유종목 가져오기를 쓰세요.');
    throw new UserError(lastError ? `종목 정보를 가져오지 못했습니다: ${lastError}` : `연결된 증권사에서 '${symbol}' 종목을 찾지 못했습니다.`);
  }
  if (info.delisted) throw new UserError('상장 폐지된 종목입니다. 수기 자산으로 등록하세요.');
  const currency = info.currency;
  const asset = await prisma.asset.create({
    data: {
      userId,
      type: isCryptoSymbol(symbol) ? 'CRYPTO' : currency === 'USD' ? 'US_STOCK' : 'KR_STOCK',
      name: info.name.slice(0, 80) || symbol,
      symbol,
      market: info.market,
      currency,
      priceSource: 'BROKER',
      meta: info.englishName ? { englishName: info.englishName } : undefined,
    },
  });
  await audit(prisma, userId, 'asset', asset.id, 'create', undefined, asset);
  return asset;
}

export async function createManualAsset(
  userId: string,
  input: { type: AssetType; name: string; currency: string; meta?: Prisma.InputJsonObject },
) {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new UserError('자산 이름은 1~80자로 입력하세요.');
  if (!['KRW', 'USD'].includes(input.currency)) throw new UserError('통화는 KRW 또는 USD만 지원합니다.');
  if (!MANUAL_TYPES.includes(input.type)) throw new UserError('자산 유형을 선택하세요.');
  const asset = await prisma.asset.create({
    data: { userId, type: input.type, name, currency: input.currency, priceSource: 'MANUAL', meta: input.meta ?? undefined },
  });
  await audit(prisma, userId, 'asset', asset.id, 'create', undefined, asset);
  return asset;
}

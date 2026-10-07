import type { AssetType } from '@prisma/client';
import { prisma } from '../db';
import { tossClientFor } from '../market';
import { assertSymbol, TossApiError } from '../toss/client';
import { audit, UserError } from './portfolios';

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  KR_STOCK: '국내 주식·ETF',
  US_STOCK: '해외 주식·ETF',
  BOND: '채권',
  CASH: '현금·예금',
  REAL_ESTATE: '부동산',
  FUND: '펀드',
  ALTERNATIVE: '대안자산',
  LIABILITY: '부채',
};

export const MANUAL_TYPES: AssetType[] = ['BOND', 'CASH', 'REAL_ESTATE', 'FUND', 'ALTERNATIVE', 'LIABILITY', 'KR_STOCK', 'US_STOCK'];

/** Find or create a listed asset by symbol, validated against Toss Securities. */
export async function ensureListedAsset(userId: string, rawSymbol: string) {
  let symbol: string;
  try {
    symbol = assertSymbol(rawSymbol.trim());
  } catch {
    throw new UserError('종목 코드는 6자리 숫자(국내) 또는 티커(해외)로 입력하세요.');
  }
  const existing = await prisma.asset.findUnique({ where: { userId_symbol: { userId, symbol } } });
  if (existing) return existing;

  const client = await tossClientFor(userId);
  if (!client) throw new UserError('상장 종목을 추가하려면 먼저 설정에서 토스증권 API를 연결하세요. 연결 없이 쓰려면 수기 자산으로 등록하세요.');
  let info;
  try {
    [info] = await client.stocks([symbol]);
  } catch (e) {
    throw new UserError(e instanceof TossApiError ? e.message : '종목 정보를 가져오지 못했습니다.');
  }
  if (!info) throw new UserError(`토스증권에서 '${symbol}' 종목을 찾지 못했습니다.`);
  if (info.status === 'DELISTED') throw new UserError('상장 폐지된 종목입니다. 수기 자산으로 등록하세요.');
  const asset = await prisma.asset.create({
    data: {
      userId,
      type: info.currency === 'USD' ? 'US_STOCK' : 'KR_STOCK',
      name: info.name,
      symbol,
      market: info.market,
      currency: info.currency,
      priceSource: 'TOSS',
      meta: { englishName: info.englishName, securityType: info.securityType },
    },
  });
  await audit(prisma, userId, 'asset', asset.id, 'create', undefined, asset);
  return asset;
}

export async function createManualAsset(
  userId: string,
  input: { type: AssetType; name: string; currency: string; meta?: Record<string, string> },
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

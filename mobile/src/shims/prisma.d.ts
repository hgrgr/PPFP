// The shared domain code names a few enum types from Prisma; the app has no Prisma client.
export type LotMethod = 'SPECIFIC' | 'FIFO' | 'LIFO' | 'HIFO' | 'LOFO' | 'AVERAGE';
export type TxnType = 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAW' | 'DIVIDEND' | 'INTEREST' | 'FEE' | 'TAX' | 'SPLIT' | 'VALUATION' | 'REPAY';
export type AssetType = 'KR_STOCK' | 'US_STOCK' | 'CRYPTO' | 'BOND' | 'CASH' | 'REAL_ESTATE' | 'FUND' | 'ALTERNATIVE' | 'LIABILITY';

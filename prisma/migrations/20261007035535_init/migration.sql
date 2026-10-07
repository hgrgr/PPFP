-- CreateEnum
CREATE TYPE "LotMethod" AS ENUM ('SPECIFIC', 'FIFO', 'LIFO', 'HIFO', 'LOFO', 'AVERAGE');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('KR_STOCK', 'US_STOCK', 'BOND', 'CASH', 'REAL_ESTATE', 'FUND', 'ALTERNATIVE', 'LIABILITY');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('MANUAL', 'TOSS');

-- CreateEnum
CREATE TYPE "TxnType" AS ENUM ('BUY', 'SELL', 'DEPOSIT', 'WITHDRAW', 'DIVIDEND', 'INTEREST', 'FEE', 'TAX', 'SPLIT', 'VALUATION');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'KRW',
    "redUp" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TossCredential" (
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "accountSeq" BIGINT,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TossCredential_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2F4FC9',
    "baseCurrency" TEXT NOT NULL DEFAULT 'KRW',
    "lotMethod" "LotMethod" NOT NULL DEFAULT 'FIFO',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioEdge" (
    "parentId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "allocation" DECIMAL(20,10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioEdge_pkey" PRIMARY KEY ("parentId","childId")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "market" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "priceSource" "DataSource" NOT NULL DEFAULT 'MANUAL',
    "manualPrice" DECIMAL(24,6),
    "manualPriceAt" TIMESTAMP(3),
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holding" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "qtySource" "DataSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "qtyOriginal" DECIMAL(28,8) NOT NULL,
    "qtyRemaining" DECIMAL(28,8) NOT NULL,
    "unitCost" DECIMAL(24,6) NOT NULL,
    "fxRate" DECIMAL(20,10) NOT NULL,
    "sourceTxnId" TEXT NOT NULL,
    "memo" TEXT,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "holdingId" TEXT,
    "type" "TxnType" NOT NULL,
    "tradeAt" TIMESTAMP(3) NOT NULL,
    "qty" DECIMAL(28,8),
    "price" DECIMAL(24,6),
    "fee" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "tax" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "fxRate" DECIMAL(20,10) NOT NULL DEFAULT 1,
    "splitRatio" DECIMAL(20,10),
    "currency" TEXT NOT NULL,
    "cashDelta" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "flow" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "lotMethod" "LotMethod",
    "memo" TEXT,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotConsumption" (
    "id" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "qty" DECIMAL(28,8) NOT NULL,
    "cost" DECIMAL(24,6) NOT NULL,
    "proceeds" DECIMAL(24,6) NOT NULL,
    "pnl" DECIMAL(24,6) NOT NULL,
    "pnlBase" DECIMAL(24,6) NOT NULL,
    "holdingDays" INTEGER NOT NULL,

    CONSTRAINT "LotConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashBalance" (
    "portfolioId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(24,6) NOT NULL,

    CONSTRAINT "CashBalance_pkey" PRIMARY KEY ("portfolioId","currency")
);

-- CreateTable
CREATE TABLE "PriceDaily" (
    "symbol" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "close" DECIMAL(24,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'TOSS',

    CONSTRAINT "PriceDaily_pkey" PRIMARY KEY ("symbol","date")
);

-- CreateTable
CREATE TABLE "FxDaily" (
    "pair" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,

    CONSTRAINT "FxDaily_pkey" PRIMARY KEY ("pair","date")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "portfolioId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" DECIMAL(24,6) NOT NULL,
    "flow" DECIMAL(24,6) NOT NULL,
    "cash" DECIMAL(24,6) NOT NULL,
    "holdings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("portfolioId","date")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Portfolio_userId_idx" ON "Portfolio"("userId");

-- CreateIndex
CREATE INDEX "PortfolioEdge_childId_idx" ON "PortfolioEdge"("childId");

-- CreateIndex
CREATE INDEX "Asset_userId_idx" ON "Asset"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_userId_symbol_key" ON "Asset"("userId", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Holding_portfolioId_assetId_key" ON "Holding"("portfolioId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "Lot_sourceTxnId_key" ON "Lot"("sourceTxnId");

-- CreateIndex
CREATE INDEX "Lot_holdingId_acquiredAt_idx" ON "Lot"("holdingId", "acquiredAt");

-- CreateIndex
CREATE INDEX "Transaction_portfolioId_tradeAt_idx" ON "Transaction"("portfolioId", "tradeAt");

-- CreateIndex
CREATE INDEX "Transaction_holdingId_idx" ON "Transaction"("holdingId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_portfolioId_externalRef_key" ON "Transaction"("portfolioId", "externalRef");

-- CreateIndex
CREATE INDEX "LotConsumption_lotId_idx" ON "LotConsumption"("lotId");

-- CreateIndex
CREATE INDEX "LotConsumption_txnId_idx" ON "LotConsumption"("txnId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_at_idx" ON "AuditLog"("userId", "at");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TossCredential" ADD CONSTRAINT "TossCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioEdge" ADD CONSTRAINT "PortfolioEdge_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioEdge" ADD CONSTRAINT "PortfolioEdge_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "Holding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_sourceTxnId_fkey" FOREIGN KEY ("sourceTxnId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "Holding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotConsumption" ADD CONSTRAINT "LotConsumption_txnId_fkey" FOREIGN KEY ("txnId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotConsumption" ADD CONSTRAINT "LotConsumption_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashBalance" ADD CONSTRAINT "CashBalance_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

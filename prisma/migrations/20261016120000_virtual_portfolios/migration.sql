-- CreateTable
CREATE TABLE "VirtualPortfolio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "benchmark" TEXT NOT NULL DEFAULT '^KS11',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualPortfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualPosition" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "symbol" TEXT,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "buyDate" DATE NOT NULL,
    "sellDate" DATE,
    "mode" TEXT NOT NULL DEFAULT 'AMOUNT',
    "amount" DECIMAL(20,2),
    "qty" DECIMAL(28,10),
    "rate" DECIMAL(12,8),
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VirtualPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VirtualPortfolio_userId_idx" ON "VirtualPortfolio"("userId");

-- CreateIndex
CREATE INDEX "VirtualPosition_portfolioId_idx" ON "VirtualPosition"("portfolioId");

-- AddForeignKey
ALTER TABLE "VirtualPortfolio" ADD CONSTRAINT "VirtualPortfolio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualPosition" ADD CONSTRAINT "VirtualPosition_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "VirtualPortfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

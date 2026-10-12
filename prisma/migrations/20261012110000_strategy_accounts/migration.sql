-- CreateTable
CREATE TABLE "StrategyAccount" (
    "portfolioId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "share" DECIMAL(20,10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyAccount_pkey" PRIMARY KEY ("portfolioId","accountId")
);

-- CreateIndex
CREATE INDEX "StrategyAccount_accountId_idx" ON "StrategyAccount"("accountId");

-- AddForeignKey
ALTER TABLE "StrategyAccount" ADD CONSTRAINT "StrategyAccount_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyAccount" ADD CONSTRAINT "StrategyAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;


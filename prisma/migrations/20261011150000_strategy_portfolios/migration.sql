-- AlterTable
ALTER TABLE "Portfolio" ADD COLUMN     "allowOverlap" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'ACCOUNT';

-- CreateTable
CREATE TABLE "StrategyMember" (
    "portfolioId" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "share" DECIMAL(20,10) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyMember_pkey" PRIMARY KEY ("portfolioId","holdingId")
);

-- CreateIndex
CREATE INDEX "StrategyMember_holdingId_idx" ON "StrategyMember"("holdingId");

-- AddForeignKey
ALTER TABLE "StrategyMember" ADD CONSTRAINT "StrategyMember_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyMember" ADD CONSTRAINT "StrategyMember_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "Holding"("id") ON DELETE CASCADE ON UPDATE CASCADE;


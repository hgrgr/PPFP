-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'CRYPTO';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Broker" ADD VALUE 'UPBIT';
ALTER TYPE "Broker" ADD VALUE 'BITHUMB';
ALTER TYPE "Broker" ADD VALUE 'COINONE';
ALTER TYPE "Broker" ADD VALUE 'KORBIT';

-- AlterTable
ALTER TABLE "BrokerConnection" ADD COLUMN     "historyPortfolioId" TEXT,
ADD COLUMN     "historySince" TIMESTAMP(3),
ADD COLUMN     "historySyncedTo" TIMESTAMP(3);

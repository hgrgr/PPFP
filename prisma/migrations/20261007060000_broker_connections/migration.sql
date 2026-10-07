-- Multi-broker links: TossCredential becomes one row of BrokerConnection.

-- DataSource: 'TOSS' meant "priced by / imported from the linked broker".
ALTER TYPE "DataSource" RENAME VALUE 'TOSS' TO 'BROKER';
ALTER TYPE "DataSource" ADD VALUE 'IMPORT';

-- CreateEnum
CREATE TYPE "Broker" AS ENUM ('TOSS', 'KIS', 'KIWOOM', 'LS', 'DB', 'MERITZ');

-- CreateTable
CREATE TABLE "BrokerConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "broker" "Broker" NOT NULL,
    "label" TEXT NOT NULL,
    "appKey" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "accountNo" TEXT,
    "paper" BOOLEAN NOT NULL DEFAULT false,
    "tokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrokerConnection_userId_idx" ON "BrokerConnection"("userId");

-- AddForeignKey
ALTER TABLE "BrokerConnection" ADD CONSTRAINT "BrokerConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry existing Toss links over.
INSERT INTO "BrokerConnection" ("id", "userId", "broker", "label", "appKey", "secretEncrypted", "accountNo", "lastSyncAt", "lastError", "updatedAt")
SELECT 'toss_' || "userId", "userId", 'TOSS', '토스증권', "clientId", "secretEncrypted", "accountSeq"::text, "lastSyncAt", "lastError", "updatedAt"
FROM "TossCredential";

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "importSource" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_importSource_idx" ON "Transaction"("importSource");

-- Opening lots already imported from Toss keep counting as imported from that account.
UPDATE "Transaction" t
SET "importSource" = 'TOSS:' || COALESCE(tc."accountSeq"::text, 'main')
FROM "Holding" h
JOIN "Portfolio" p ON p."id" = h."portfolioId"
LEFT JOIN "TossCredential" tc ON tc."userId" = p."userId"
WHERE t."holdingId" = h."id"
  AND h."qtySource" = 'BROKER'
  AND t."type" = 'BUY'
  AND t."memo" LIKE '토스증권 계좌에서 가져온%';

-- DropForeignKey
ALTER TABLE "TossCredential" DROP CONSTRAINT "TossCredential_userId_fkey";

-- DropTable
DROP TABLE "TossCredential";

-- AlterTable
ALTER TABLE "PriceDaily" ALTER COLUMN "source" SET DEFAULT 'BROKER';

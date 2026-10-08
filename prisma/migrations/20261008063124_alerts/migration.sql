-- CreateEnum
CREATE TYPE "AlertDirection" AS ENUM ('ABOVE', 'BELOW');

-- CreateEnum
CREATE TYPE "AlertSource" AS ENUM ('MANUAL', 'JOURNAL_TARGET', 'JOURNAL_STOP');

-- AlterTable
ALTER TABLE "Portfolio" ADD COLUMN     "driftAlert" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "driftBreaches" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "driftTolerance" DECIMAL(20,10) NOT NULL DEFAULT 0.05;

-- CreateTable
CREATE TABLE "PriceAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "source" "AlertSource" NOT NULL DEFAULT 'MANUAL',
    "direction" "AlertDirection" NOT NULL,
    "price" DECIMAL(24,6) NOT NULL,
    "currency" TEXT NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "triggeredAt" TIMESTAMP(3),
    "triggeredPrice" DECIMAL(24,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioTarget" (
    "portfolioId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "weight" DECIMAL(20,10) NOT NULL,

    CONSTRAINT "PortfolioTarget_pkey" PRIMARY KEY ("portfolioId","key")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "PriceAlert_active_idx" ON "PriceAlert"("active");

-- CreateIndex
CREATE INDEX "PriceAlert_userId_idx" ON "PriceAlert"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceAlert_journalEntryId_source_key" ON "PriceAlert"("journalEntryId", "source");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioTarget" ADD CONSTRAINT "PortfolioTarget_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: journal entries written before alerts existed get their target and stop alerts.
-- The target waits in the direction from the base price (or, without one, upward); the stop the other way.
INSERT INTO "PriceAlert" ("id", "userId", "assetId", "journalEntryId", "source", "direction", "price", "currency", "active")
SELECT gen_random_uuid()::text, e."userId", e."assetId", e."id", 'JOURNAL_TARGET',
       (CASE WHEN e."basePrice" IS NULL OR e."targetPrice" >= e."basePrice" THEN 'ABOVE' ELSE 'BELOW' END)::"AlertDirection",
       e."targetPrice", e."currency", e."status" = 'OPEN'
FROM "JournalEntry" e;

INSERT INTO "PriceAlert" ("id", "userId", "assetId", "journalEntryId", "source", "direction", "price", "currency", "active")
SELECT gen_random_uuid()::text, e."userId", e."assetId", e."id", 'JOURNAL_STOP',
       (CASE WHEN e."basePrice" IS NULL OR e."targetPrice" >= e."basePrice" THEN 'BELOW' ELSE 'ABOVE' END)::"AlertDirection",
       e."stopPrice", e."currency", e."status" = 'OPEN'
FROM "JournalEntry" e
WHERE e."stopPrice" IS NOT NULL;

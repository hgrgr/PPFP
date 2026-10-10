-- AlterTable
ALTER TABLE "User" ADD COLUMN     "localCurrency" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ApiUsage" (
    "userId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "limited" INTEGER NOT NULL DEFAULT 0,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiUsage_pkey" PRIMARY KEY ("userId","service","day")
);

-- CreateTable
CREATE TABLE "ApiLimit" (
    "userId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiLimit_pkey" PRIMARY KEY ("userId","service")
);

-- CreateIndex
CREATE INDEX "ApiUsage_userId_day_idx" ON "ApiUsage"("userId", "day");

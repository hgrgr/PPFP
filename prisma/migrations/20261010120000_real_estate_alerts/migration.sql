-- CreateTable
CREATE TABLE "RealEstateAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "events" TEXT[],
    "scope" TEXT NOT NULL DEFAULT 'AREA',
    "minPrice" DECIMAL(18,0),
    "maxPrice" DECIMAL(18,0),
    "newHighOnly" BOOLEAN NOT NULL DEFAULT false,
    "dealing" TEXT NOT NULL DEFAULT 'ANY',
    "buyer" TEXT NOT NULL DEFAULT 'ANY',
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "seen" JSONB,
    "zone" BOOLEAN,
    "checkedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "firedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealEstateAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RealEstateAlert_userId_idx" ON "RealEstateAlert"("userId");

-- CreateIndex
CREATE INDEX "RealEstateAlert_active_idx" ON "RealEstateAlert"("active");

-- AddForeignKey
ALTER TABLE "RealEstateAlert" ADD CONSTRAINT "RealEstateAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RealEstateAlert" ADD CONSTRAINT "RealEstateAlert_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;


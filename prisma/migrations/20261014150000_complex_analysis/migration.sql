-- CreateTable
CREATE TABLE "RtmsMonth" (
    "kind" TEXT NOT NULL,
    "lawdCd" TEXT NOT NULL,
    "ym" TEXT NOT NULL,
    "deals" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RtmsMonth_pkey" PRIMARY KEY ("kind","lawdCd","ym")
);

-- CreateTable
CREATE TABLE "DealSnapshot" (
    "lawdCd" TEXT NOT NULL,
    "ym" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "DealSnapshot_pkey" PRIMARY KEY ("lawdCd","ym","day")
);

-- CreateTable
CREATE TABLE "FavoriteComplex" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lawdCd" TEXT NOT NULL,
    "complexKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "umdNm" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteComplex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteComplex_userId_lawdCd_complexKey_key" ON "FavoriteComplex"("userId", "lawdCd", "complexKey");

-- AddForeignKey
ALTER TABLE "FavoriteComplex" ADD CONSTRAINT "FavoriteComplex_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

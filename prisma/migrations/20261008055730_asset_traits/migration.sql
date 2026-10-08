-- CreateTable
CREATE TABLE "TraitGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "preset" TEXT,
    "cashTraitId" TEXT,
    "base" TEXT NOT NULL DEFAULT 'all',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraitGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trait" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL,
    "targetWeight" DECIMAL(20,10),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Trait_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetTrait" (
    "assetId" TEXT NOT NULL,
    "traitId" TEXT NOT NULL,

    CONSTRAINT "AssetTrait_pkey" PRIMARY KEY ("assetId","traitId")
);

-- CreateIndex
CREATE INDEX "TraitGroup_userId_idx" ON "TraitGroup"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Trait_groupId_name_key" ON "Trait"("groupId", "name");

-- CreateIndex
CREATE INDEX "AssetTrait_traitId_idx" ON "AssetTrait"("traitId");

-- AddForeignKey
ALTER TABLE "TraitGroup" ADD CONSTRAINT "TraitGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trait" ADD CONSTRAINT "Trait_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TraitGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetTrait" ADD CONSTRAINT "AssetTrait_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetTrait" ADD CONSTRAINT "AssetTrait_traitId_fkey" FOREIGN KEY ("traitId") REFERENCES "Trait"("id") ON DELETE CASCADE ON UPDATE CASCADE;

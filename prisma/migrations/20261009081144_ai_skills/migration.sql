-- CreateTable
CREATE TABLE "AiSkill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "resources" JSONB NOT NULL DEFAULT '[]',
    "agents" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'custom',
    "sourceId" TEXT,
    "sourcePath" TEXT,
    "sourceUrl" TEXT,
    "license" TEXT,
    "installs" INTEGER,
    "skipped" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSkill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiSkill_userId_name_key" ON "AiSkill"("userId", "name");

-- AddForeignKey
ALTER TABLE "AiSkill" ADD CONSTRAINT "AiSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

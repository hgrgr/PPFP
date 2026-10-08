-- CreateEnum
CREATE TYPE "BookStatus" AS ENUM ('WANT', 'READING', 'DONE');

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Book" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "publisher" TEXT,
    "publishedYear" INTEGER,
    "status" "BookStatus" NOT NULL DEFAULT 'READING',
    "rating" INTEGER,
    "startedAt" DATE,
    "finishedAt" DATE,
    "oneLine" TEXT,
    "content" JSONB NOT NULL DEFAULT '[]',
    "contentText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "lived" TEXT,
    "affiliation" TEXT,
    "oneLine" TEXT,
    "preset" TEXT,
    "content" JSONB NOT NULL DEFAULT '[]',
    "contentText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#2a78d6',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "aType" TEXT NOT NULL,
    "aId" TEXT NOT NULL,
    "bType" TEXT NOT NULL,
    "bId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Note_userId_updatedAt_idx" ON "Note"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Book_userId_updatedAt_idx" ON "Book"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sage_userId_name_key" ON "Sage"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_userId_name_key" ON "Topic"("userId", "name");

-- CreateIndex
CREATE INDEX "KnowledgeLink_userId_aType_aId_idx" ON "KnowledgeLink"("userId", "aType", "aId");

-- CreateIndex
CREATE INDEX "KnowledgeLink_userId_bType_bId_idx" ON "KnowledgeLink"("userId", "bType", "bId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLink_userId_aType_aId_bType_bId_key" ON "KnowledgeLink"("userId", "aType", "aId", "bType", "bId");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Book" ADD CONSTRAINT "Book_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sage" ADD CONSTRAINT "Sage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLink" ADD CONSTRAINT "KnowledgeLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

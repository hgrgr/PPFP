-- CreateTable
CREATE TABLE "ApiKey" (
    "userId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "keyEnc" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("userId","service")
);

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN     "alertAnalysis" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "briefing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "briefingHour" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "briefingLastDate" TEXT,
ADD COLUMN     "briefingWeekdays" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "aiConversationId" TEXT;

-- 실적·공시 분석가: the user's guideline for a conversation, and the one last used
ALTER TABLE "AiConversation" ADD COLUMN "lens" TEXT;
ALTER TABLE "AiSettings" ADD COLUMN "earningsLens" TEXT;

-- AI keys move to ApiKey (one per AI company); each agent can use its own model.

-- AlterTable
ALTER TABLE "AiConversation" ADD COLUMN     "model" TEXT,
ADD COLUMN     "provider" TEXT;

-- Existing Anthropic keys become the 'anthropic' row
INSERT INTO "ApiKey" ("userId", "service", "keyEnc", "hint", "updatedAt")
SELECT "userId", 'anthropic', "apiKeyEnc", COALESCE("apiKeyHint", ''), "updatedAt"
FROM "AiSettings"
WHERE "apiKeyEnc" IS NOT NULL
ON CONFLICT ("userId", "service") DO NOTHING;

-- AlterTable
ALTER TABLE "AiSettings" DROP COLUMN "apiKeyEnc",
DROP COLUMN "apiKeyHint",
ADD COLUMN     "agentModels" JSONB NOT NULL DEFAULT '{}';

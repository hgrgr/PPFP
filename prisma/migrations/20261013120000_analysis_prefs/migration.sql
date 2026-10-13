-- 분석 지표 preferences
ALTER TABLE "User" ADD COLUMN "analysisPrefs" JSONB NOT NULL DEFAULT '{}';

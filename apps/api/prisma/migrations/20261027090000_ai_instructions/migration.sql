-- The owner's instructions to the salon's AI (ai-brain/instructions.ts).
CREATE TABLE IF NOT EXISTS "ai_instructions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "triggers" JSONB NOT NULL DEFAULT '[]',
  "mode" TEXT NOT NULL DEFAULT 'meaning',
  "channels" JSONB NOT NULL DEFAULT '[]',
  "on" BOOLEAN NOT NULL DEFAULT true,
  "reason" TEXT,
  "sourceKind" TEXT,
  "sourceId" TEXT,
  "sourceQuestion" TEXT,
  "sourceReply" TEXT,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "blockedCount" INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_instructions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_instructions_tenantId_on_idx" ON "ai_instructions"("tenantId", "on");

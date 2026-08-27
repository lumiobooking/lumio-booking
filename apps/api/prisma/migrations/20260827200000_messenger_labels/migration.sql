-- Labels and follow-ups: the two things needed to work a conversation to a
-- conclusion rather than merely answer it.
--
-- WHY THEY ARE TWO SEPARATE THINGS AND NOT ONE
--
-- A LABEL says where a conversation stands: "đã báo giá", "chờ chốt", "không
-- quan tâm". It is a fact about now.
--
-- A FOLLOW-UP says when to come back: Thursday, after they have thought about
-- it. It is a fact about the future, and crucially it can become OVERDUE — it
-- surfaces itself when the day arrives. A label cannot do that. A tag reading
-- "cần gọi lại" is true forever and therefore tells nobody anything on any
-- particular morning.
--
-- Modelling the second as a label is the mistake that turns a follow-up system
-- into a graveyard of stale tags.
--
-- WHY NOTHING IS SEEDED
--
-- The stages of a sale differ in every salon. A default set we invent would be
-- wrong in every shop and would still be sitting there unused in a year. The
-- first label a salon creates is one they actually needed.

ALTER TABLE "messenger_threads" ADD COLUMN "followUpAt" TIMESTAMP(3);
ALTER TABLE "messenger_threads" ADD COLUMN "followUpNote" TEXT;

-- The "what is due today" query.
CREATE INDEX "messenger_threads_tenantId_followUpAt_idx"
  ON "messenger_threads" ("tenantId", "followUpAt");

CREATE TABLE "messenger_labels" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "color"     TEXT NOT NULL DEFAULT '#6366f1',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "messenger_labels_pkey" PRIMARY KEY ("id")
);

-- One name per salon. Two labels called "Đã chốt" would be indistinguishable on
-- screen and would silently split the filter in half.
CREATE UNIQUE INDEX "messenger_labels_tenantId_name_key" ON "messenger_labels" ("tenantId", "name");
CREATE INDEX "messenger_labels_tenantId_idx" ON "messenger_labels" ("tenantId");

CREATE TABLE "messenger_thread_labels" (
  "tenantId"  TEXT NOT NULL,
  "threadId"  TEXT NOT NULL,
  "labelId"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "messenger_thread_labels_pkey" PRIMARY KEY ("threadId", "labelId")
);

CREATE INDEX "messenger_thread_labels_tenantId_idx" ON "messenger_thread_labels" ("tenantId");
CREATE INDEX "messenger_thread_labels_labelId_idx" ON "messenger_thread_labels" ("labelId");

ALTER TABLE "messenger_labels"
  ADD CONSTRAINT "messenger_labels_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE both ways: deleting a label should take its attachments with it
-- rather than leave rows pointing at nothing, and deleting a conversation
-- should not leave its labels behind.
ALTER TABLE "messenger_thread_labels"
  ADD CONSTRAINT "messenger_thread_labels_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "messenger_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "messenger_thread_labels"
  ADD CONSTRAINT "messenger_thread_labels_labelId_fkey"
  FOREIGN KEY ("labelId") REFERENCES "messenger_labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "NotificationIntentKind" AS ENUM ('IMMEDIATE_ITEM', 'DAILY_DIGEST');

-- CreateEnum
CREATE TYPE "NotificationIntentStatus" AS ENUM ('PENDING', 'DEFERRED');

-- CreateTable
CREATE TABLE "NotificationIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationIntentKind" NOT NULL,
    "status" "NotificationIntentStatus" NOT NULL,
    "localDay" VARCHAR(10) NOT NULL,
    "subjectKey" VARCHAR(80) NOT NULL,
    "householdId" TEXT,
    "itemId" TEXT,
    "content" JSONB NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationIntent_status_dueAt_idx" ON "NotificationIntent"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationIntent_userId_kind_localDay_subjectKey_key" ON "NotificationIntent"("userId", "kind", "localDay", "subjectKey");

-- AddForeignKey
ALTER TABLE "NotificationIntent" ADD CONSTRAINT "NotificationIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

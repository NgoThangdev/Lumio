-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "expiryAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lowStockAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "shoppingRemindersEnabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyDigestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "householdEventsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietHoursStart" VARCHAR(5),
    "quietHoursEnd" VARCHAR(5),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "endpoint" VARCHAR(2048) NOT NULL,
    "p256dh" VARCHAR(512) NOT NULL,
    "auth" VARCHAR(128) NOT NULL,
    "sessionTokenHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("endpoint")
);

-- CreateIndex
CREATE INDEX "PushSubscription_sessionTokenHash_idx" ON "PushSubscription"("sessionTokenHash");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_sessionTokenHash_fkey" FOREIGN KEY ("sessionTokenHash") REFERENCES "UserSession"("tokenHash") ON DELETE CASCADE ON UPDATE CASCADE;

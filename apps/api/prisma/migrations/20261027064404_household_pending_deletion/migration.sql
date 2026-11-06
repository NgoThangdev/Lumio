-- AlterTable
ALTER TABLE "Household" ADD COLUMN     "deletionDueAt" TIMESTAMP(3),
ADD COLUMN     "deletionRequestId" TEXT,
ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Household_deletionDueAt_idx" ON "Household"("deletionDueAt");

-- A household is either active or has one complete pending request.
ALTER TABLE "Household" ADD CONSTRAINT "Household_deletion_request_complete"
CHECK (
  ("deletionRequestId" IS NULL AND "deletionRequestedAt" IS NULL AND "deletionDueAt" IS NULL)
  OR
  ("deletionRequestId" IS NOT NULL AND "deletionRequestedAt" IS NOT NULL AND "deletionDueAt" IS NOT NULL)
);

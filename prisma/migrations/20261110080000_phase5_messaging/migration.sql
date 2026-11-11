-- AlterTable
ALTER TABLE "Athlete" ADD COLUMN     "whatsappOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MessageLog" ADD COLUMN     "body" TEXT,
ADD COLUMN     "toPhone" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppUsage" ADD COLUMN     "blocked" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "warned100" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "MessageLog_gymId_purpose_createdAt_idx" ON "MessageLog"("gymId", "purpose", "createdAt");

-- CreateTable
CREATE TABLE "JobRun" (
    "key" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("key")
);

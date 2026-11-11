-- AlterEnum
ALTER TYPE "PrincipalType" ADD VALUE 'SYSTEM';

-- AlterTable
ALTER TABLE "GymSubscription" ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastReminderAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PlatformAnnouncement" ADD COLUMN     "audience" TEXT NOT NULL DEFAULT 'ALL',
ADD COLUMN     "emailsSent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recipients" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "whatsappSent" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PlatformCounter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlatformCounter_pkey" PRIMARY KEY ("key")
);

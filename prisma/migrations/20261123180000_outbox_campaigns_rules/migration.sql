-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'SKIPPED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SendChannel" AS ENUM ('AUTO', 'WHATSAPP', 'PUSH');

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "campaignId" TEXT,
    "ruleId" TEXT,
    "template" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "purpose" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "channel" "SendChannel" NOT NULL DEFAULT 'AUTO',
    "pushTitle" TEXT,
    "pushPath" TEXT,
    "sendAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "outcome" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "preset" TEXT,
    "customText" TEXT,
    "channel" "SendChannel" NOT NULL DEFAULT 'AUTO',
    "total" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoRule" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "preset" TEXT,
    "customText" TEXT,
    "channel" "SendChannel" NOT NULL DEFAULT 'AUTO',
    "cooldownDays" INTEGER NOT NULL DEFAULT 14,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutoRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboundMessage_gymId_status_sendAfter_idx" ON "OutboundMessage"("gymId", "status", "sendAfter");

-- CreateIndex
CREATE INDEX "OutboundMessage_status_sendAfter_idx" ON "OutboundMessage"("status", "sendAfter");

-- CreateIndex
CREATE INDEX "OutboundMessage_campaignId_status_idx" ON "OutboundMessage"("campaignId", "status");

-- CreateIndex
CREATE INDEX "OutboundMessage_gymId_ruleId_athleteId_createdAt_idx" ON "OutboundMessage"("gymId", "ruleId", "athleteId", "createdAt");

-- CreateIndex
CREATE INDEX "Campaign_gymId_createdAt_idx" ON "Campaign"("gymId", "createdAt");

-- CreateIndex
CREATE INDEX "AutoRule_gymId_enabled_idx" ON "AutoRule"("gymId", "enabled");

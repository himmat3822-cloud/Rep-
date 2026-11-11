-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "referrerId" TEXT;

-- CreateTable
CREATE TABLE "MemberPaymentClaim" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dueId" TEXT,
    "planId" TEXT,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "amountPaise" INTEGER NOT NULL,
    "utr" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decision" TEXT,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberPaymentClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberPaymentClaim_gymId_status_idx" ON "MemberPaymentClaim"("gymId", "status");

-- CreateIndex
CREATE INDEX "MemberPaymentClaim_gymId_athleteId_idx" ON "MemberPaymentClaim"("gymId", "athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberPaymentClaim_gymId_utr_key" ON "MemberPaymentClaim"("gymId", "utr");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_gymId_athleteId_idx" ON "PushSubscription"("gymId", "athleteId");

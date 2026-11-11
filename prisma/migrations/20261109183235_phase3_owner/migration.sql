-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "OtpScope" ADD VALUE 'SIGNUP';

-- CreateTable
CREATE TABLE "PlatformPaymentClaim" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "submittedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decision" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformPaymentClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformPaymentClaim_status_createdAt_idx" ON "PlatformPaymentClaim"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformPaymentClaim_gymId_idx" ON "PlatformPaymentClaim"("gymId");

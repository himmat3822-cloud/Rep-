-- AlterTable
ALTER TABLE "GymUser" ADD COLUMN     "ptSessionFeePaise" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PtSession" ADD COLUMN     "athleteDisputedAt" TIMESTAMP(3),
ADD COLUMN     "disputeNote" TEXT;

-- CreateTable
CREATE TABLE "WorkoutTemplate" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "days" JSONB NOT NULL,
    "dietNotes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkoutTemplate_gymId_createdById_idx" ON "WorkoutTemplate"("gymId", "createdById");

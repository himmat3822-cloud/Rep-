-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "pushed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Athlete" ADD COLUMN     "lastAppAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Complaint" ADD COLUMN     "resolutionNote" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "lastContactAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RiskScore" ADD COLUMN     "note" TEXT;

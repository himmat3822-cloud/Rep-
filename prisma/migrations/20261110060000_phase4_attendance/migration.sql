-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CheckInMethod" ADD VALUE 'GEO_SELF';
ALTER TYPE "CheckInMethod" ADD VALUE 'REGISTER';

-- AlterTable
ALTER TABLE "Athlete" ADD COLUMN     "biometricId" TEXT;

-- AlterTable
ALTER TABLE "CheckIn" ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "externalRef" TEXT;

-- CreateTable
CREATE TABLE "AttendanceDevice" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'API',
    "vendor" TEXT NOT NULL DEFAULT '',
    "serialNumber" TEXT,
    "keyPrefix" TEXT,
    "keyHash" TEXT,
    "allowedIps" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "lastPunchAt" TIMESTAMP(3),
    "punches" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDevice_serialNumber_key" ON "AttendanceDevice"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDevice_keyPrefix_key" ON "AttendanceDevice"("keyPrefix");

-- CreateIndex
CREATE INDEX "AttendanceDevice_gymId_idx" ON "AttendanceDevice"("gymId");

-- CreateIndex
CREATE UNIQUE INDEX "Athlete_gymId_biometricId_key" ON "Athlete"("gymId", "biometricId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_gymId_externalRef_key" ON "CheckIn"("gymId", "externalRef");

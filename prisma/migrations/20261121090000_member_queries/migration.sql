-- CreateEnum
CREATE TYPE "QueryTopic" AS ENUM ('DIET', 'WORKOUT', 'PLAN', 'PT', 'OTHER');

-- CreateEnum
CREATE TYPE "QueryStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QueryAuthor" AS ENUM ('ATHLETE', 'STAFF');

-- CreateTable
CREATE TABLE "MemberQuery" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "branchId" TEXT,
    "athleteId" TEXT NOT NULL,
    "trainerId" TEXT,
    "topic" "QueryTopic" NOT NULL,
    "status" "QueryStatus" NOT NULL DEFAULT 'OPEN',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "athleteSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryMessage" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "author" "QueryAuthor" NOT NULL,
    "staffId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueryMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberQuery_gymId_status_idx" ON "MemberQuery"("gymId", "status");

-- CreateIndex
CREATE INDEX "MemberQuery_gymId_trainerId_status_idx" ON "MemberQuery"("gymId", "trainerId", "status");

-- CreateIndex
CREATE INDEX "MemberQuery_gymId_athleteId_idx" ON "MemberQuery"("gymId", "athleteId");

-- CreateIndex
CREATE INDEX "QueryMessage_queryId_createdAt_idx" ON "QueryMessage"("queryId", "createdAt");

-- CreateIndex
CREATE INDEX "QueryMessage_gymId_idx" ON "QueryMessage"("gymId");

-- AddForeignKey
ALTER TABLE "QueryMessage" ADD CONSTRAINT "QueryMessage_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "MemberQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

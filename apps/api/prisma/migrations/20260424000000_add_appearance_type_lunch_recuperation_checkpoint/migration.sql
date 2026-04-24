-- CreateEnum
CREATE TYPE "AppearanceType" AS ENUM ('HOME', 'TURNAROUND');

-- AlterTable
ALTER TABLE "trips" ADD COLUMN "appearanceType" "AppearanceType",
ADD COLUMN "lunchBreakMinutes" INTEGER,
ADD COLUMN "recuperation1Accepted" DOUBLE PRECISION,
ADD COLUMN "recuperation1Delivered" DOUBLE PRECISION,
ADD COLUMN "recuperation2Accepted" DOUBLE PRECISION,
ADD COLUMN "recuperation2Delivered" DOUBLE PRECISION,
ADD COLUMN "recuperation3Accepted" DOUBLE PRECISION,
ADD COLUMN "recuperation3Delivered" DOUBLE PRECISION,
ADD COLUMN "checkpointOut" DOUBLE PRECISION,
ADD COLUMN "checkpointIn" DOUBLE PRECISION;

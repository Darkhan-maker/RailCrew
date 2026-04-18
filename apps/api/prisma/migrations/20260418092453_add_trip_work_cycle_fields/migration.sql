-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "appearanceDate" TEXT,
ADD COLUMN     "appearanceTime" TEXT,
ADD COLUMN     "axleCount" INTEGER,
ADD COLUMN     "endDate" TEXT,
ADD COLUMN     "handoverDate" TEXT,
ADD COLUMN     "handoverTime" TEXT,
ADD COLUMN     "locoModel" TEXT,
ADD COLUMN     "locoNumber" TEXT,
ADD COLUMN     "sectionCount" INTEGER,
ADD COLUMN     "trainNumber" TEXT,
ADD COLUMN     "trainWeight" DOUBLE PRECISION;

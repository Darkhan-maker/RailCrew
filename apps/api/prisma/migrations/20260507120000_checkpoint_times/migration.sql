-- AlterTable: change checkpointOut and checkpointIn from Float to String (HH:mm time)
ALTER TABLE "trips" ALTER COLUMN "checkpointOut" TYPE TEXT USING NULL;
ALTER TABLE "trips" ALTER COLUMN "checkpointIn" TYPE TEXT USING NULL;

CREATE TABLE "trip_segments" (
  "id"              TEXT    NOT NULL,
  "tripId"          TEXT    NOT NULL,
  "order"           INTEGER NOT NULL,
  "segmentType"     TEXT    NOT NULL,
  "startTime"       TEXT    NOT NULL,
  "endTime"         TEXT    NOT NULL,
  "startDate"       TEXT    NOT NULL,
  "endDate"         TEXT,
  "durationMinutes" INTEGER NOT NULL,
  "distanceKm"      DOUBLE PRECISION,
  "trainWeightTons" DOUBLE PRECISION,
  "notes"           TEXT,

  CONSTRAINT "trip_segments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trip_segments_tripId_idx" ON "trip_segments"("tripId");

ALTER TABLE "trip_segments" ADD CONSTRAINT "trip_segments_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

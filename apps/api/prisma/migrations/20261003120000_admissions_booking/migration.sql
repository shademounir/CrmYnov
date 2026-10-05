-- prisma-policy: additive
-- prisma-policy: ephemeral-only
-- prisma-policy: rollback-documented
-- prisma-policy: uniqueness-validated
-- New tables only: no historical appointment, collaborator or Prisma history is rewritten.
CREATE TABLE "admissions_responsibilities" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "campus" VARCHAR(120) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "admissions_responsibilities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "admissions_responsibilities_user_id_campus_key" ON "admissions_responsibilities"("user_id", "campus");
CREATE INDEX "admissions_responsibilities_campus_active_idx" ON "admissions_responsibilities"("campus", "active");
ALTER TABLE "admissions_responsibilities" ADD CONSTRAINT "admissions_responsibilities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "collaborators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "admissions_windows" (
  "id" UUID NOT NULL,
  "responsibility_id" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "starts_at" TIMESTAMPTZ(6) NOT NULL,
  "ends_at" TIMESTAMPTZ(6) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admissions_windows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admissions_windows_kind_check" CHECK ("kind" IN ('AVAILABLE', 'BLOCKED')),
  CONSTRAINT "admissions_windows_interval_check" CHECK ("ends_at" > "starts_at")
);
CREATE INDEX "admissions_windows_responsibility_id_active_starts_at_idx" ON "admissions_windows"("responsibility_id", "active", "starts_at");
ALTER TABLE "admissions_windows" ADD CONSTRAINT "admissions_windows_responsibility_id_fkey" FOREIGN KEY ("responsibility_id") REFERENCES "admissions_responsibilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "admissions_bookings" (
  "appointment_id" UUID NOT NULL,
  "responsibility_id" UUID NOT NULL,
  "state" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  CONSTRAINT "admissions_bookings_pkey" PRIMARY KEY ("appointment_id"),
  CONSTRAINT "admissions_bookings_state_check" CHECK ("state" IN ('PENDING', 'ACCEPTED', 'REFUSED', 'CANCELLED'))
);
CREATE INDEX "admissions_bookings_responsibility_id_state_idx" ON "admissions_bookings"("responsibility_id", "state");
ALTER TABLE "admissions_bookings" ADD CONSTRAINT "admissions_bookings_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admissions_bookings" ADD CONSTRAINT "admissions_bookings_responsibility_id_fkey" FOREIGN KEY ("responsibility_id") REFERENCES "admissions_responsibilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "admissions_mutation_receipts" (
  "id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "operation" VARCHAR(48) NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admissions_mutation_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "admissions_mutation_receipts_actor_id_operation_key_key" ON "admissions_mutation_receipts"("actor_id", "operation", "key");

CREATE TABLE "system_probes" (
  "id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_probes_pkey" PRIMARY KEY ("id")
);
